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
    const renderSpy = vi.spyOn(md, 'render');
    const wrapper = render(MarkdownContent, { props: { text: 'prefix cache test', deferUpdates: true } });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ text: 'prefix cache test final' });
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
});
