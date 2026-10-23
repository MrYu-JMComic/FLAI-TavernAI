import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatComposer from '../chat/ChatComposer.vue';

describe('DeepSeek online search composer control', () => {
  it('groups independent streaming and DeepSeek search toggles in a compact popover', async () => {
    const wrapper = mount(ChatComposer, {
      props: { canToggleWebSearch: false, webSearchEnabled: true }
    });
    const trigger = wrapper.get('[aria-label="响应模式设置"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(trigger.attributes('title')).toContain('DeepSeek 联网搜索');
    expect(trigger.classes()).not.toContain('active');
    expect(wrapper.find('[aria-label="DeepSeek 联网搜索"]').exists()).toBe(false);

    await trigger.trigger('click');
    expect(wrapper.get('[role="dialog"][aria-label="响应模式"]').exists()).toBe(true);
    expect(wrapper.get('[aria-label="流式输出"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[aria-label="DeepSeek 联网搜索"]').exists()).toBe(false);

    await wrapper.setProps({ canToggleWebSearch: true, webSearchEnabled: true });
    const searchToggle = wrapper.get('[aria-label="DeepSeek 联网搜索"]');
    const streamToggle = wrapper.get('[aria-label="流式输出"]');
    expect(trigger.classes()).toContain('active');
    expect(searchToggle.attributes('aria-pressed')).toBe('true');
    expect(searchToggle.attributes('title')).toContain('2026-11-01');
    expect(wrapper.get('.response-mode-cost-hint').text()).toContain('¥5/千次');

    await searchToggle.trigger('click');
    expect(wrapper.emitted('toggle-web-search')).toHaveLength(1);
    expect(streamToggle.attributes('aria-pressed')).toBe('true');

    await streamToggle.trigger('click');
    expect(wrapper.emitted('toggle-stream')).toHaveLength(1);
    expect(searchToggle.attributes('aria-pressed')).toBe('true');
  });

  it('disables both mode controls while a response is generating', async () => {
    const wrapper = mount(ChatComposer, {
      props: { canToggleWebSearch: true }
    });
    await wrapper.get('[aria-label="响应模式设置"]').trigger('click');
    await wrapper.setProps({ sending: true });

    expect(wrapper.get('[aria-label="DeepSeek 联网搜索"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="流式输出"]').attributes('disabled')).toBeDefined();
  });
});
