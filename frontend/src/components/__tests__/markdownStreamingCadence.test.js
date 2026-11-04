import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import MarkdownContent from '../MarkdownContent.vue';
import { md } from '../../utils/markdownRenderer.js';

const wrappers = [];

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('streamed Markdown updates', () => {
  it('coalesces rapid source updates and places the caret in the final text block', async () => {
    vi.useFakeTimers();
    const renderSpy = vi.spyOn(md, 'render');
    const wrapper = mount(MarkdownContent, {
      props: { text: '', deferUpdates: true, showCaret: true }
    });
    wrappers.push(wrapper);

    await wrapper.setProps({ text: '第一段' });
    await wrapper.setProps({ text: '第一段\n\n第二段末尾' });
    expect(renderSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(32);
    await nextTick();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toBe('第一段\n第二段末尾');
    expect(wrapper.find('.typing-caret').element.parentElement.tagName).toBe('P');

    await wrapper.setProps({ text: '第一段\n\n第二段末尾\n' });
    await vi.advanceTimersByTimeAsync(32);
    await nextTick();
    const caret = wrapper.find('.typing-caret').element;
    expect(caret.parentElement.tagName).toBe('P');
    expect(caret.previousElementSibling.tagName).toBe('BR');
  });
});
