import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, nextTick, reactive } from 'vue';
import VirtualMessageList from '../VirtualMessageList.vue';
import MarkdownContent from '../MarkdownContent.vue';
import { md } from '../../utils/markdownRenderer.js';

const virtual = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  measureElement: vi.fn(),
  measure: vi.fn(),
  getTotalSize: () => 16000,
  getVirtualItems: () => []
}));
vi.mock('@tanstack/vue-virtual', async () => {
  const { shallowRef } = await import('vue');
  return { useVirtualizer: () => shallowRef(virtual) };
});

const wrappers = [];
function render(component, options) {
  const wrapper = mount(component, options);
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});

describe('chat rendering lifecycle', () => {
  it('keeps row DOM and disclosures across ID finalization, refresh and reorder', async () => {
    const draft = reactive({ id: 'local-assistant-1', content: 'Draft' });
    const wrapper = render(VirtualMessageList, {
      props: { messages: [draft, { id: 'other', content: 'Other' }] },
      slots: { default: ({ message }) => h('details', [h('summary', message.content)]) }
    });
    const row = wrapper.find('.virtual-scroll-static-item').element;
    row.querySelector('details').open = true;
    draft.id = 'server-1';
    await nextTick();
    expect(wrapper.find('.virtual-scroll-static-item').element).toBe(row);
    await wrapper.setProps({ messages: [{ id: 'other', content: 'Other' }, { id: 'server-1', content: 'Final' }] });
    const refreshed = wrapper.findAll('.virtual-scroll-static-item')[1].element;
    expect(refreshed).toBe(row);
    expect(refreshed.querySelector('details').open).toBe(true);
    expect(refreshed.textContent).toBe('Final');
  });

  it('cancels deferred bottom correction when the user scrolls', async () => {
    const wrapper = render(VirtualMessageList, {
      props: { virtualize: true, messages: [{ id: 'one' }] }
    });
    const element = wrapper.vm.getScrollElement();
    Object.defineProperties(element, { scrollHeight: { value: 16000 }, clientHeight: { value: 600 } });
    element.scrollTop = 200;
    wrapper.vm.scrollToBottom(false);
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    await nextTick();
    await nextTick();
    expect(element.scrollTop).toBe(200);
    expect(virtual.measure).not.toHaveBeenCalled();
    wrapper.vm.scrollToBottom(false);
    await nextTick();
    await nextTick();
    expect(element.scrollTop).toBe(15400);
  });

  it('does not cache streaming prefixes and caches the settled result', async () => {
    vi.useFakeTimers();
    const renderSpy = vi.spyOn(md, 'render');
    const wrapper = render(MarkdownContent, { props: { text: 'prefix cache test', deferUpdates: true } });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ text: 'prefix cache test final' });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(32);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ deferUpdates: false });
    expect(renderSpy).toHaveBeenCalledTimes(3);
    render(MarkdownContent, { props: { text: 'prefix cache test final' } });
    expect(renderSpy).toHaveBeenCalledTimes(3);
    render(MarkdownContent, { props: { text: 'prefix cache test' } });
    expect(renderSpy).toHaveBeenCalledTimes(4);
  });

  it('coalesces text and plugin updates and preserves sanitized rich rendering', async () => {
    const wrapper = render(MarkdownContent, { props: { text: 'initial render test' } });
    const renderSpy = vi.spyOn(md, 'render');
    await wrapper.setProps({
      text: '# Section\n\n**Safe** <script>alert(1)</script> $x^2$',
      renderPlugins: [{ type: 'fold', pattern: '^# (.+)$', titleTemplate: '$1' }]
    });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('strong').text()).toBe('Safe');
    expect(wrapper.find('details').exists()).toBe(true);
    expect(wrapper.find('.katex').exists()).toBe(true);
  });

  it('normalizes line endings and renders one soft break plus separate paragraphs', async () => {
    const wrapper = render(MarkdownContent, { props: { text: '第一行\r\n第二行\r\n\r\n第二段\r第三段' } });
    await nextTick();

    const paragraphs = wrapper.findAll('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].findAll('br')).toHaveLength(1);
    expect(paragraphs[0].text().replace(/\s+/g, '')).toBe('第一行第二行');
    expect(paragraphs[1].findAll('br')).toHaveLength(1);
    expect(paragraphs[1].text().replace(/\s+/g, '')).toBe('第二段第三段');

    await wrapper.setProps({ renderPlugins: [{ pattern: '^never-matches$' }] });
    await nextTick();
    expect(wrapper.findAll('.markdown-content > p')).toHaveLength(2);
    expect(wrapper.findAll('br')).toHaveLength(2);
  });

  it('renders escaped provider newlines outside inline and fenced code', async () => {
    const wrapper = render(MarkdownContent, {
      props: {
        text: [
          '第一行\\n第二行\\\\n\\\\n第三段',
          '',
          '内联代码：`code\\nline`',
          '',
          '```text',
          '代码\\n内容',
          '```'
        ].join('\n')
      }
    });
    await nextTick();

    const paragraphs = wrapper.findAll('.markdown-content > p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].findAll('br')).toHaveLength(1);
    expect(paragraphs[0].text().replace(/\s+/g, '')).toBe('第一行第二行');
    expect(paragraphs[1].text()).toBe('第三段');
    expect(paragraphs[2].find('code').text()).toBe(String.raw`code\nline`);
    expect(wrapper.find('pre code').text()).toContain(String.raw`代码\n内容`);
  });

  it('normalizes escaped newlines before render-plugin line matching', async () => {
    const wrapper = render(MarkdownContent, {
      props: {
        text: String.raw`前文\n# 折叠标题\n折叠正文`,
        renderPlugins: [{ pattern: '^# (.+)$', titleTemplate: '$1' }]
      }
    });
    await nextTick();

    expect(wrapper.find('.markdown-content > p').text()).toBe('前文');
    expect(wrapper.find('.markdown-fold-summary').text()).toContain('折叠标题');
    expect(wrapper.find('.markdown-fold-body').text()).toContain('折叠正文');
  });
});
