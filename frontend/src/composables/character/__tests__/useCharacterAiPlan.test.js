import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, effectScope, h, nextTick, reactive, ref } from 'vue';
import AiPlanReview from '../../../components/AiPlanReview.vue';
import { useCharacterAiGeneration } from '../useCharacterAiGeneration.js';
import { streamCharacterDraft } from '../../../api/characters.js';

vi.mock('../../../api/characters.js', () => ({ streamCharacterDraft: vi.fn() }));
vi.mock('../../../api/worldBooks.js', () => ({ applyWorldBookChanges: vi.fn(), fetchWorldBook: vi.fn() }));
vi.mock('../../../api/mods.js', () => ({ createMod: vi.fn() }));
vi.mock('../../../api/assets.js', () => ({ createAsset: vi.fn() }));

const scopes = [];
let wrapper;
beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.resetAllMocks();
});

const plan = () => ({
  steps: [{ id: 'book-step', section: 'worldBook', intent: 'Update the original book', selected: true }]
});
const workspace = (content = 'Initial draft') => ({
  version: 1, activeRef: 'existing:book-a',
  targets: [{ ref: 'existing:book-a', bookId: 'book-a', profile: { name: 'Original book' }, upserts: [{ entryId: 'entry-a', patch: { content } }], removals: [] }]
});

function fixture({ conversation = false } = {}) {
  const scope = effectScope();
  scopes.push(scope);
  const selected = ref(['book-a']);
  const form = reactive({ name: 'Original character' });
  const options = reactive({ profile: true, worldBook: true });
  const notify = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const api = scope.run(() => useCharacterAiGeneration({
    canEdit: ref(true), saving: ref(false), form, aiOptions: options,
    aiUseCurrentDraft: ref(true), assistantPlanMode: ref(true),
    getSelectedWorldBookIds: () => selected.value, getSessionId: () => 'character-a',
    isConversationMode: () => conversation, buildPayload: () => ({ ...form }), notify
  }));
  if (conversation) api.selectAiSession({ id: 'assistant-session', messages: [], state: {} });
  api.aiRequirement.value = 'Improve the original character and book';
  return { api, form, selected, notify };
}

async function preparePlan(api) {
  streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: plan(), worldBookWorkspace: workspace() });
  await api.completeWithAi();
  expect(api.aiPlanPhase.value).toBe('review');
}

function mountPlanReview(api) {
  wrapper = mount(defineComponent({
    setup: () => () => h(AiPlanReview, {
      busy: api.aiLoading.value, disabled: api.characterAiActionBusy.value,
      phase: api.aiPlanPhase.value, plan: api.aiPlan.value,
      stepStatus: api.aiPlanStepStatus, onExecute: api.executeApprovedPlan
    })
  }));
  return wrapper;
}

describe('character AI plan execution recovery', () => {
  it('clears the running presentation and enables retry after an execution request rejects', async () => {
    const { api, notify } = fixture();
    await preparePlan(api);
    let rejectExecution;
    streamCharacterDraft.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectExecution = reject; }));
    mountPlanReview(api);

    const executing = api.executeApprovedPlan();
    await nextTick();
    expect(wrapper.get('.ai-plan-review').classes()).toContain('is-executing');
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.primary-button').attributes('aria-busy')).toBe('true');

    rejectExecution(new Error('Execution connection lost'));
    await executing;
    await nextTick();

    expect(api.aiLoading.value).toBe(false);
    expect(api.aiStatus.value).toBe('failed');
    expect(api.aiPlanPhase.value).toBe('failed');
    expect(api.aiLastError.value).toBe('Execution connection lost');
    expect(api.aiProcess.value.some((step) => step.state === 'running')).toBe(false);
    expect(api.aiPlan.value.steps[0].id).toBe('book-step');
    expect(notify.error).toHaveBeenCalledWith('Execution connection lost');
    expect(wrapper.get('.ai-plan-title strong').text()).toContain('失败');
    expect(wrapper.get('.ai-plan-review').classes()).not.toContain('is-executing');
    expect(wrapper.find('.lucide-loader-circle').exists()).toBe(false);
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.primary-button').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('.primary-button').text()).toContain('重试');
    expect(wrapper.findAll('input, textarea').every((input) => !input.element.disabled)).toBe(true);

    streamCharacterDraft.mockResolvedValueOnce({ character: {}, summary: 'Retry completed' });
    await wrapper.get('.primary-button').trigger('click');
    await flushPromises();
    expect(streamCharacterDraft.mock.calls[2][0].plan.approved).toBe(true);
    expect(api.aiStatus.value).toBe('completed');
    expect(wrapper.find('.ai-plan-review').exists()).toBe(false);
  });

  it.each(['aborted-result', 'abort-error'])('pauses plan execution and clears its spinners after %s', async (interruption) => {
    const { api } = fixture();
    await preparePlan(api);
    if (interruption === 'aborted-result') streamCharacterDraft.mockResolvedValueOnce({ aborted: true });
    else streamCharacterDraft.mockRejectedValueOnce(new DOMException('Stopped', 'AbortError'));
    mountPlanReview(api);

    await api.executeApprovedPlan();
    await nextTick();

    expect(api.aiStatus.value).toBe('paused');
    expect(api.aiLoading.value).toBe(false);
    expect(api.aiPlanPhase.value).toBe('paused');
    expect(api.aiProcess.value.some((step) => step.state === 'running')).toBe(false);
    expect(api.aiPlan.value.steps[0].id).toBe('book-step');
    expect(wrapper.get('.ai-plan-review').classes()).not.toContain('is-executing');
    expect(wrapper.find('.lucide-loader-circle').exists()).toBe(false);
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeUndefined();
  });

  it.each([false, true])('keeps a failed planning request unapproved (emitted plan: %s)', async (emittedPlan) => {
    const { api } = fixture();
    streamCharacterDraft.mockImplementationOnce(async (_request, handlers) => {
      if (emittedPlan) handlers.plan(plan());
      throw new Error('Planning connection lost');
    });

    await api.completeWithAi();

    expect(api.aiLoading.value).toBe(false);
    expect(api.aiStatus.value).toBe('failed');
    expect(api.aiPlanPhase.value).toBe(emittedPlan ? 'review' : 'idle');
    expect(api.aiProcess.value.some((step) => step.state === 'running')).toBe(false);
    expect(Boolean(api.aiPlan.value)).toBe(emittedPlan);
    streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: plan() });
    await api.retryCharacterAi();
    expect(streamCharacterDraft.mock.calls[1][0]).not.toHaveProperty('plan');
    expect(api.aiPlanPhase.value).toBe('review');
  });

  it.each([
    ['failed', 'executeApprovedPlan'], ['failed', 'retryCharacterAi'],
    ['paused', 'executeApprovedPlan'], ['paused', 'retryCharacterAi']
  ])('reruns the approved plan without a checkpoint after %s via %s', async (terminalStatus, action) => {
    const { api, form, selected } = fixture();
    await preparePlan(api);
    if (terminalStatus === 'failed') streamCharacterDraft.mockRejectedValueOnce(new Error('Execution failed'));
    else streamCharacterDraft.mockResolvedValueOnce({ aborted: true });
    await api.executeApprovedPlan();
    const approvedPlan = streamCharacterDraft.mock.calls[1][0].plan;
    expect(api.aiHasCheckpoint.value).toBe(false);
    expect(api.aiPlanPhase.value).toBe(terminalStatus);
    form.name = 'Unrelated new draft';
    selected.value = ['different-book'];
    api.setAiWorldBookSelectedIds(['different-book']);
    streamCharacterDraft.mockResolvedValueOnce({ character: {}, summary: 'Completed' });

    await api[action]();

    const retry = streamCharacterDraft.mock.calls[2][0];
    expect(retry.plan).toEqual(approvedPlan);
    expect(retry.plan.approved).toBe(true);
    expect(retry.character).toEqual({ name: 'Original character' });
    expect(retry.worldBookContext.selectedBookIds).toEqual(['book-a']);
    expect(retry.worldBookContext.workspace).toEqual(workspace());
    expect(retry.continuation).toBeUndefined();
    expect(api.aiStatus.value).toBe('completed');
    expect(api.aiPlan.value).toBeNull();
    expect(api.aiPlanPhase.value).toBe('idle');
  });

  it.each(['resumeCharacterAi', 'retryCharacterAi', 'executeApprovedPlan'])('continues the approved plan and latest checkpoint via %s', async (action) => {
    const { api, selected } = fixture();
    await preparePlan(api);
    const latestWorkspace = workspace('Checkpoint draft');
    streamCharacterDraft.mockImplementationOnce(async (_request, handlers) => {
      handlers.checkpoint({ character: { name: 'Checkpoint character', worldBookWorkspace: latestWorkspace }, completedSections: ['profile'] });
      throw new Error('Execution interrupted');
    });
    await api.executeApprovedPlan();
    const approvedPlan = streamCharacterDraft.mock.calls[1][0].plan;
    selected.value = ['different-book'];
    api.setAiWorldBookSelectedIds(['different-book']);
    streamCharacterDraft.mockResolvedValueOnce({ character: {}, summary: 'Completed' });

    await api[action]();

    const resumed = streamCharacterDraft.mock.calls[2][0];
    expect(resumed.plan).toEqual(approvedPlan);
    expect(resumed.character.name).toBe('Checkpoint character');
    expect(resumed.worldBookContext.selectedBookIds).toEqual(['book-a']);
    expect(resumed.worldBookContext.workspace).toEqual(latestWorkspace);
    expect(resumed.continuation).toMatchObject({ enabled: true, completedSections: ['profile'] });
    expect(api.aiStatus.value).toBe('completed');
    expect(api.aiPlan.value).toBeNull();
  });

  it.each([
    ['failed', 'failed'], ['paused', 'paused'], ['running', 'paused']
  ])('restores server execution with status %s as %s', async (storedStatus, expectedStatus) => {
    const stored = {
      version: 4, requirement: 'Continue the original task', plan: plan(), planPhase: 'executing', status: storedStatus,
      process: [{ round: 1, state: 'running', tools: [] }],
      planContext: { character: { name: 'Original character' }, worldBookContext: { selectedBookIds: ['book-a'], workspace: workspace() } }
    };
    const { api } = fixture({ conversation: true });
    api.selectAiSession({ id: 'assistant-session', messages: [], state: stored });
    mountPlanReview(api);

    expect(api.aiLoading.value).toBe(false);
    expect(api.aiStatus.value).toBe(expectedStatus);
    expect(api.aiPlanPhase.value).toBe(expectedStatus);
    expect(api.aiProcess.value.some((step) => step.state === 'running')).toBe(false);
    expect(wrapper.get('.ai-plan-review').classes()).not.toContain('is-executing');
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeUndefined();
    expect(api.exportAiSessionState().planPhase).toBe(expectedStatus);
    streamCharacterDraft.mockResolvedValueOnce({ character: {}, summary: 'Completed' });
    await api.retryCharacterAi();
    expect(streamCharacterDraft.mock.calls[0][0].plan.approved).toBe(true);
    expect(streamCharacterDraft.mock.calls[0][0].worldBookContext.selectedBookIds).toEqual(['book-a']);
  });

  it('ignores legacy browser draft content even outside the assistant conversation page', async () => {
    localStorage.setItem('flai-character-ai-session:character-a', JSON.stringify({
      version: 4, requirement: 'Obsolete local task', plan: plan(), planPhase: 'executing', status: 'failed'
    }));
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { api } = fixture({ conversation: false });
    expect(api.aiRequirement.value).toBe('Improve the original character and book');
    expect(api.aiPlan.value).toBeNull();
    api.setAiOptionValue('profile', false);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    read.mockRestore();
    write.mockRestore();
  });

  it.each(['failed', 'paused', 'running'])('unlocks an interrupted legacy plan without a saved target context: %s', (storedStatus) => {
    const { api } = fixture({ conversation: true });
    api.selectAiSession({
      id: 'legacy-session', messages: [],
      state: { plan: plan(), planPhase: 'executing', status: storedStatus }
    });
    mountPlanReview(api);

    expect(api.aiLoading.value).toBe(false);
    expect(api.aiPlanPhase.value).toBe(storedStatus === 'failed' ? 'failed' : 'paused');
    expect(wrapper.get('.primary-button').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('.primary-button').attributes('aria-busy')).toBe('false');
  });
});
