import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ChatProcessingStatus from '../chat/ChatProcessingStatus.vue';

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock('../../api/core.js', () => ({ apiRequest }));

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  apiRequest.mockReset();
});

describe('chat processing status polling', () => {
  it('stops polling after the conversation is idle', async () => {
    vi.useFakeTimers();
    apiRequest.mockResolvedValue({
      conversationId: 'conversation-1',
      stateStatus: 'ready',
      timelineRevision: 1,
      job: null
    });

    wrapper = mount(ChatProcessingStatus, {
      props: { conversationId: 'conversation-1' }
    });
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('polls active work and stops once it settles', async () => {
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({
        conversationId: 'conversation-1',
        stateStatus: 'pending',
        timelineRevision: 1,
        job: { id: 'job-1', status: 'running', progress: 25, pendingCount: 1 }
      })
      .mockResolvedValueOnce({
        conversationId: 'conversation-1',
        stateStatus: 'ready',
        timelineRevision: 1,
        job: { id: 'job-1', status: 'succeeded', progress: 100, pendingCount: 0 }
      });

    wrapper = mount(ChatProcessingStatus, {
      props: { conversationId: 'conversation-1' }
    });
    await flushPromises();

    expect(apiRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
