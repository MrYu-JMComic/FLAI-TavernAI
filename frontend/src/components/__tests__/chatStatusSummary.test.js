import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatStatusSummary from '../chat/ChatStatusSummary.vue';

function mountSummary(props = {}) {
  return mount(ChatStatusSummary, {
    props: {
      statusBar: {
        name: 'TRPG 面板',
        variables: [{ name: '场景', value: '大神殿·祈祷厅' }]
      },
      ...props
    }
  });
}

describe('chat status summary fixed header', () => {
  it('uses the character avatar when it is available', () => {
    const wrapper = mountSummary({ characterAvatarUrl: '/api/assets/character-avatar' });

    expect(wrapper.get('.chat-status-summary-icon img').attributes('src')).toBe('/api/assets/character-avatar');
    expect(wrapper.find('.chat-status-summary-icon svg').exists()).toBe(false);
  });

  it('falls back to the activity icon when the avatar cannot load', async () => {
    const wrapper = mountSummary({ characterAvatarUrl: '/api/assets/missing-avatar' });

    await wrapper.get('.chat-status-summary-icon img').trigger('error');
    await nextTick();

    expect(wrapper.find('.chat-status-summary-icon img').exists()).toBe(false);
    expect(wrapper.find('.chat-status-summary-icon svg').exists()).toBe(true);
  });

  it('distinguishes a completed no-change check from waiting for another reply', () => {
    const wrapper = mountSummary({ updateStatus: 'checked' });

    expect(wrapper.get('.chat-status-summary-title small.is-checked').text()).toBe('本轮无变化');
  });

  it('shows when background processing failed', () => {
    const wrapper = mountSummary({ updateStatus: 'failed' });

    expect(wrapper.get('.chat-status-summary-title small.is-failed').text()).toBe('后台未完成');
  });

});
