import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import MarkdownContent from '../MarkdownContent.vue';
import ChatMessageItem from '../chat/ChatMessageItem.vue';
import { md } from '../../utils/markdownRenderer.js';

const wrappers = [];
function render(component, props) {
  const wrapper = mount(component, { props });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('stream rendering lifecycle after removing the character queue', () => {
  it('shows history immediately and preserves complete Unicode in streamed DOM commits', async () => {
    vi.useFakeTimers();
    const wrapper = render(MarkdownContent, { text: '历史消息', deferUpdates: true });
    expect(wrapper.text()).toBe('历史消息');
    await wrapper.setProps({ text: '历史消息👩‍💻e\u0301' });
    expect(wrapper.text()).toBe('历史消息');
    await vi.advanceTimersByTimeAsync(32);
    expect(wrapper.text()).toBe('历史消息👩‍💻e\u0301');
  });

  it('flushes the final server result immediately and cancels an outstanding stream render', async () => {
    vi.useFakeTimers();
    const wrapper = render(MarkdownContent, { text: 'draft', deferUpdates: true, showCaret: true });
    await wrapper.setProps({ text: 'draft pending' });
    expect(wrapper.text()).toBe('draft');
    const renderSpy = vi.spyOn(md, 'render');
    await wrapper.setProps({ text: '最终校正版👩‍💻', deferUpdates: false, showCaret: false });
    expect(wrapper.text()).toBe('最终校正版👩‍💻');
    expect(wrapper.find('.typing-caret').exists()).toBe(false);
    const committed = renderSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(renderSpy).toHaveBeenCalledTimes(committed);
    await wrapper.setProps({ text: '手工编辑后的历史' });
    expect(wrapper.text()).toBe('手工编辑后的历史');
  });

  it('applies non-prefix corrections at the next stream commit', async () => {
    vi.useFakeTimers();
    const wrapper = render(MarkdownContent, { text: 'draft correction', deferUpdates: true });
    await wrapper.setProps({ text: 'corrected complete response' });
    expect(wrapper.text()).toBe('draft correction');
    await vi.advanceTimersByTimeAsync(32);
    expect(wrapper.text()).toBe('corrected complete response');
  });

  it('cancels queued parsing and DOM notification when a message unmounts', async () => {
    vi.useFakeTimers();
    const onRendered = vi.fn();
    const wrapper = render(MarkdownContent, { text: 'before dispose', deferUpdates: true, onRendered });
    const renderSpy = vi.spyOn(md, 'render');
    await wrapper.setProps({ text: 'must never render after dispose' });
    const commits = onRendered.mock.calls.length;
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(renderSpy).not.toHaveBeenCalled();
    expect(onRendered).toHaveBeenCalledTimes(commits);
  });

  it('emits scroll progress after Markdown commits only while the message is streaming', async () => {
    vi.useFakeTimers();
    const message = { id: 'assistant-1', role: 'assistant', content: 'stream start', contentStreaming: true };
    const wrapper = render(ChatMessageItem, { message });
    const initial = wrapper.emitted('typing-progress')?.length || 0;
    await wrapper.setProps({ message: { ...message, content: 'stream start\n\nnext paragraph' } });
    expect(wrapper.emitted('typing-progress')?.length || 0).toBe(initial);
    await vi.advanceTimersByTimeAsync(32);
    expect(wrapper.emitted('typing-progress').length).toBeGreaterThan(initial);
    const streamed = wrapper.emitted('typing-progress').length;
    await wrapper.setProps({ message: { ...message, content: 'final server text', contentStreaming: false } });
    expect(wrapper.text()).toContain('final server text');
    expect(wrapper.emitted('typing-progress').length).toBe(streamed);
  });
});
