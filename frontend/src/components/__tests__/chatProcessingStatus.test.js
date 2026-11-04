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

  it('uses the active required core after an older success and keeps every derived task visible', async () => {
    const running = { id: 'core-running', stage: 'core', status: 'running', progress: 65 };
    apiRequest.mockResolvedValue({ stateStatus: 'pending', coreReady: false, corePendingCount: 2, coreFailedCount: 1,
      stages: { core: [{ id: 'old-success', status: 'succeeded' }, running],
        summary: [{ id: 'summary-old', status: 'succeeded' }, { id: 'summary-running', status: 'running' }],
        index: [{ id: 'index-failed-a', status: 'failed', error: { message: '索引供应商超时' } }, { id: 'index-failed-b', status: 'failed' }] },
      job: { ...running, corePendingCount: 2, coreFailedCount: 1 } });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    expect(wrapper.text()).toContain('65% · 待处理 2 轮 · 1 轮待恢复');
    expect(wrapper.get('[aria-label="后台派生任务"]').text()).toContain('分层摘要 · 处理中');
    expect(wrapper.text()).toContain('索引供应商超时');
    const retries = wrapper.findAll('button').filter((button) => button.text() === '重试索引');
    expect(retries).toHaveLength(2);
    await retries[1].trigger('click');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/jobs/index-failed-b/retry', { method: 'POST' });
  });

  it('reads the nested HTTP compatibility summary and displays actionable core failure', async () => {
    const failed = { id: 'core-failed', stage: 'core', status: 'failed', error: { code: 'ERR_SQLITE_ERROR', message: 'table conversation_memories has no column named visibility' } };
    apiRequest.mockResolvedValue({ stateStatus: 'needs_review', job: { ...failed, coreReady: false, canRetry: true,
      stages: { core: [{ id: 'old-success', status: 'succeeded' }, failed], summary: [], index: [] } } });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('请重启后端完成升级');
    await wrapper.get('[aria-label="重试同步"]').trigger('click');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/jobs/core-failed/retry', { method: 'POST' });
  });

  it('does not mark optional raw work as a required core failure', async () => {
    const optional = { id: 'optional', stage: 'core', status: 'failed', payload: { requiredStages: [] } };
    apiRequest.mockResolvedValue({ stateStatus: 'ready', coreReady: true, stages: { core: [optional], summary: [], index: [] }, job: optional });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    expect(wrapper.find('[aria-label="剧情同步状态"]').exists()).toBe(false);
  });

  it.each([{}, { turnCount: 0 }, { confirmationRequired: false, turnCount: 0 }, { confirmationRequired: true, turnCount: -1 },
    { confirmationRequired: true, turnCount: 1.5 }, { confirmationRequired: true, turnCount: '2' }])('rejects an invalid rebuild preview without inventing zero turns: %j', async preview => {
    apiRequest.mockImplementation(async path => path.endsWith('/rebuild') ? preview : { stateStatus: 'needs_rebuild', coreReady: false, job: null });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '重建状态').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('无法获取有效的重建范围');
    expect(wrapper.find('[aria-label="确认剧情状态操作"]').exists()).toBe(false);
    expect(apiRequest.mock.calls.filter(([path]) => path.endsWith('/rebuild'))).toHaveLength(1);
  });

  it('describes a genuine zero-turn checkpoint restore without a model-fee warning', async () => {
    apiRequest.mockImplementation(async (path, request) => {
      if (!path.endsWith('/rebuild')) return { stateStatus: 'needs_rebuild', coreReady: false, job: null };
      return JSON.parse(request.body).confirmed ? { stateStatus: 'ready', jobs: [] } : { confirmationRequired: true, turnCount: 0 };
    });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '重建状态').trigger('click');
    await flushPromises();
    const confirmation = wrapper.get('[aria-label="确认剧情状态操作"]');
    expect(confirmation.text()).toContain('本次不发起剧情重建模型调用');
    expect(confirmation.text()).not.toContain('可能产生模型调用费用');
    expect(apiRequest.mock.calls.filter(([path]) => path.endsWith('/rebuild'))).toHaveLength(1);
    await confirmation.findAll('button').find((button) => button.text() === '确认').trigger('click');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/conversations/story-1/processing/rebuild', { method: 'POST', body: JSON.stringify({ confirmed: true, acceptCurrent: false, expectedTurnCount: 0 }) });
  });

  it('keeps accepting the current baseline separate from the previewed replay count', async () => {
    apiRequest.mockImplementation(async path => path.endsWith('/rebuild') ? { confirmationRequired: true, turnCount: 5 } : { stateStatus: 'needs_rebuild', coreReady: false, job: null });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '重建状态').trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="确认剧情状态操作"]').findAll('button').find((button) => button.text() === '取消').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '保留当前状态').trigger('click');
    await wrapper.get('[aria-label="确认剧情状态操作"]').findAll('button').find((button) => button.text() === '确认').trigger('click');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/conversations/story-1/processing/rebuild', { method: 'POST', body: JSON.stringify({ confirmed: true, acceptCurrent: true }) });
  });

  it('retains a failed recovery reason and the confirmation so it can be retried', async () => {
    apiRequest.mockImplementation(async (path, request) => {
      if (!path.endsWith('/rebuild')) return { stateStatus: 'needs_review', coreReady: false, job: null };
      if (JSON.parse(request.body).confirmed) throw new Error('状态基线已变化，请刷新后重新重建');
      return { confirmationRequired: true, turnCount: 1 };
    });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '重建状态').trigger('click');
    await flushPromises();
    const confirmation = wrapper.get('[aria-label="确认剧情状态操作"]');
    expect(confirmation.text()).toContain('重建 1 轮剧情状态');
    await confirmation.findAll('button').find((button) => button.text() === '确认').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('状态基线已变化');
    expect(wrapper.find('[aria-label="确认剧情状态操作"]').exists()).toBe(true);
  });
});
