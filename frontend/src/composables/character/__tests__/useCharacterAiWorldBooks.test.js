import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref } from 'vue';
import { useCharacterAiGeneration } from '../useCharacterAiGeneration.js';
import { streamCharacterDraft } from '../../../api/characters.js';
import { applyWorldBookChanges, fetchWorldBook } from '../../../api/worldBooks.js';

vi.mock('../../../api/characters.js', () => ({ streamCharacterDraft: vi.fn() }));
vi.mock('../../../api/worldBooks.js', () => ({ applyWorldBookChanges: vi.fn(), fetchWorldBook: vi.fn() }));
vi.mock('../../../api/mods.js', () => ({ createMod: vi.fn() }));

let scope;
beforeEach(() => { localStorage.clear(); });
afterEach(() => { scope?.stop(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function fixture({ useCurrent = false, planMode = false } = {}) {
  scope = effectScope();
  const selected = ref(['book-a', 'book-b']);
  const session = ref('character-a');
  const options = reactive({ profile: true, worldBook: true });
  const onWorldBookCreated = vi.fn();
  const onWorldBookUpdated = vi.fn();
  const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const api = scope.run(() => useCharacterAiGeneration({
    canEdit: ref(true), saving: ref(false), form: reactive({ name: '当前角色' }), aiOptions: options,
    aiUseCurrentDraft: ref(useCurrent), assistantPlanMode: ref(planMode),
    getSelectedWorldBookIds: () => selected.value, getSessionId: () => session.value,
    buildPayload: () => ({ name: '当前角色' }), onWorldBookCreated, onWorldBookUpdated,
    notify
  }));
  api.aiRequirement.value = '完善世界书';
  return { api, selected, session, options, onWorldBookCreated, onWorldBookUpdated, notify };
}

function pendingResult() {
  const targets = [
    { ref: 'existing:book-b', bookId: 'book-b', profile: { name: '旧书' }, upserts: [{ entryId: 'entry-b', patch: { content: '新资料' } }], removals: [] },
    { ref: 'new:new-book', bookId: null, profile: { name: '新书' }, entries: [{ name: '航线', triggerKeys: '航线', content: '北方航线' }] }
  ];
  return { character: { worldBookWorkspace: { version: 1, activeRef: targets[1].ref, targets }, worldBookChanges: targets }, summary: '已准备两本书的变更' };
}

describe('character assistant world book context', () => {
  it('uses all current bindings even when form reference is off, and preserves drafts across new conversation turns', async () => {
    const { api, selected } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    expect(streamCharacterDraft.mock.calls[0][0].character).toEqual({});
    expect(streamCharacterDraft.mock.calls[0][0].worldBookContext.selectedBookIds).toEqual(['book-a', 'book-b']);
    selected.value = ['book-b', 'unsaved-book'];
    api.aiRequirement.value = '再补充航线';
    await api.completeWithAi();
    const payload = streamCharacterDraft.mock.calls[1][0];
    expect(payload.worldBookContext.selectedBookIds).toEqual(['book-b', 'unsaved-book']);
    expect(payload.worldBookContext.workspace.targets).toHaveLength(2);
    expect(payload.history).toEqual([{ role: 'user', content: '完善世界书' }, { role: 'assistant', content: '已准备两本书的变更' }]);
  });

  it('keeps manual targets independent from changing character bindings and closes world book scope', async () => {
    const { api, selected, options } = fixture();
    api.setAiWorldBookSelectedIds(['book-b']);
    selected.value = ['book-a'];
    expect(api.aiWorldBookSelectedIds.value).toEqual(['book-b']);
    expect(selected.value).toEqual(['book-a']);
    options.worldBook = false;
    streamCharacterDraft.mockResolvedValue({ character: {}, summary: '仅检查角色' });
    await api.completeWithAi();
    expect(streamCharacterDraft.mock.calls[0][0].worldBookContext).toBeUndefined();
    await api.applyAiWorldBookChanges(pendingResult().character.worldBookChanges);
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
  });

  it.each(['available', 'unavailable'])('retries one transaction with a stable request ID and keeps unselected changes (randomUUID %s)', async availability => {
    if (availability === 'unavailable') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const { api, onWorldBookCreated, onWorldBookUpdated } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    applyWorldBookChanges.mockRejectedValueOnce(new Error('response lost'));
    const selected = [api.aiWorldBookChanges.value[1]];
    await api.applyAiWorldBookChanges(selected);
    const firstRequest = applyWorldBookChanges.mock.calls[0][0];
    expect(firstRequest.requestId).toEqual(expect.any(String));
    expect(firstRequest.requestId.length).toBeGreaterThan(0);
    applyWorldBookChanges.mockResolvedValueOnce({ books: [{ ref: selected[0].ref, book: { id: 'created-book', name: '新书' } }] });
    await api.applyAiWorldBookChanges(selected);
    expect(applyWorldBookChanges.mock.calls[1][0].requestId).toBe(firstRequest.requestId);
    expect(api.aiWorldBookChanges.value.map((change) => change.ref)).toEqual(['existing:book-b']);
    expect(onWorldBookCreated).toHaveBeenCalledWith({ id: 'created-book', name: '新书' });
    expect(onWorldBookUpdated).not.toHaveBeenCalled();
    await api.completeWithAi();
    const continuedWorkspace = streamCharacterDraft.mock.calls[1][0].worldBookContext.workspace;
    expect(continuedWorkspace.targets.map((target) => target.ref)).toEqual(['existing:book-b', 'existing:created-book']);
    expect(continuedWorkspace.activeRef).toBe('existing:created-book');
    expect(continuedWorkspace.targets[1].upserts).toEqual([]);
  });

  it('reports request preparation errors and leaves the pending changes ready to retry', async () => {
    const { api, notify } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    notify.success.mockClear();
    const change = { ...api.aiWorldBookChanges.value[0], upserts: {} };
    await expect(api.applyAiWorldBookChanges([change])).resolves.toBeUndefined();
    expect(notify.error).toHaveBeenCalledOnce();
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
    expect(api.aiWorldBookCreating.value).toBe(false);
    expect(api.aiWorldBookChanges.value).toHaveLength(2);
    applyWorldBookChanges.mockResolvedValueOnce({ books: [{ ref: change.ref, book: { id: 'book-b', name: '旧书' } }] });
    await api.applyAiWorldBookChanges([api.aiWorldBookChanges.value[0]]);
    expect(applyWorldBookChanges).toHaveBeenCalledOnce();
    expect(notify.success).toHaveBeenCalledOnce();
  });

  it('refreshes existing books without changing bindings and honors opting out of linking a new book', async () => {
    const { api, onWorldBookCreated, onWorldBookUpdated } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    applyWorldBookChanges.mockResolvedValue({ books: [{ ref: 'existing:book-b', book: { id: 'book-b' } }, { ref: 'new:new-book', book: { id: 'created-book' } }] });
    await api.applyAiWorldBookChanges(api.aiWorldBookChanges.value.map((change) => ({ ...change, addToCharacter: false })));
    expect(onWorldBookCreated).not.toHaveBeenCalled();
    expect(onWorldBookUpdated).toHaveBeenCalledTimes(2);
    expect(api.aiWorldBookChanges.value).toEqual([]);
    await api.saveAiCheckpoint();
    expect(api.aiWorldBookChanges.value).toEqual([]);
  });

  it('reloads a conflicting existing book while preserving other drafts and continues from the new base', async () => {
    const { api, onWorldBookUpdated } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    applyWorldBookChanges.mockRejectedValueOnce(Object.assign(new Error('世界书已被修改'), { status: 409 }));
    await api.applyAiWorldBookChanges();
    const latest = { id: 'book-b', name: '最新书名', revision: 'new-revision', entries: [{ id: 'entry-b', content: '其他编辑的新资料' }] };
    fetchWorldBook.mockResolvedValueOnce(latest);
    await api.reloadAiWorldBook(api.aiWorldBookChanges.value[0]);
    expect(fetchWorldBook).toHaveBeenCalledWith('book-b');
    expect(onWorldBookUpdated).toHaveBeenCalledWith(latest);
    expect(api.aiWorldBookChanges.value.map((change) => change.ref)).toEqual(['new:new-book']);
    await api.saveAiCheckpoint();
    expect(api.aiWorldBookChanges.value.map((change) => change.ref)).toEqual(['new:new-book']);
    await api.completeWithAi();
    const continued = streamCharacterDraft.mock.calls[1][0].worldBookContext.workspace;
    const target = continued.targets.find((candidate) => candidate.bookId === 'book-b');
    expect(target.baseRevision).toBe('new-revision');
    expect(target.profile.name).toBe('最新书名');
    expect(target.upserts).toEqual([]);
    expect(continued.targets.find((candidate) => !candidate.bookId).profile.name).toBe('新书');
  });

  it('discards a deleted target from this conversation while preserving character bindings and other drafts', async () => {
    const { api, selected } = fixture();
    const result = pendingResult();
    result.character.worldBookWorkspace.activeRef = 'existing:book-b';
    result.character.worldBookWorkspace.selectedBookIds = ['book-a', 'book-b'];
    streamCharacterDraft.mockResolvedValueOnce(result);
    await api.completeWithAi();
    fetchWorldBook.mockRejectedValueOnce(Object.assign(new Error('世界书不存在'), { status: 404 }));
    await api.reloadAiWorldBook(api.aiWorldBookChanges.value[0]);
    api.discardAiWorldBookChange(api.aiWorldBookChanges.value[0]);
    expect(api.aiWorldBookSelectedIds.value).toEqual(['book-a']);
    expect(selected.value).toEqual(['book-a', 'book-b']);
    expect(api.aiWorldBookChanges.value.map((change) => change.ref)).toEqual(['new:new-book']);
    await api.saveAiCheckpoint();
    expect(api.aiWorldBookChanges.value).toHaveLength(1);
    streamCharacterDraft.mockResolvedValueOnce({ character: {}, summary: '继续保留新书' });
    await api.completeWithAi();
    const continued = streamCharacterDraft.mock.calls[1][0].worldBookContext;
    expect(continued.selectedBookIds).toEqual(['book-a']);
    expect(continued.workspace.targets.map((target) => target.ref)).toEqual(['new:new-book']);
    expect(continued.workspace.activeRef).toBeNull();
    api.discardAiWorldBookChange(api.aiWorldBookChanges.value[0]);
    expect(api.aiWorldBookChanges.value).toEqual([]);
  });

  it('isolates and restores world book workspaces when switching character sessions', async () => {
    const { api, session } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    api.setAiWorldBookSelectedIds(['book-b']);
    session.value = 'character-other';
    await nextTick();
    expect(api.aiWorldBookChanges.value).toEqual([]);
    expect(api.aiRequirement.value).toBe('');
    session.value = 'character-a';
    await nextTick();
    expect(api.aiWorldBookChanges.value).toHaveLength(2);
    expect(api.aiWorldBookSelectedIds.value).toEqual(['book-b']);
  });

  it('executes a reviewed plan with the original character and world book targets', async () => {
    const { api, selected } = fixture({ planMode: true, useCurrent: true });
    streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: { steps: [{ id: 'world-book-step', section: 'worldBook', intent: '更新原关联书', selected: true }] } });
    await api.completeWithAi();
    selected.value = ['different-book'];
    api.setAiWorldBookSelectedIds(['different-book']);
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.executeApprovedPlan();
    expect(streamCharacterDraft.mock.calls[1][0].worldBookContext.selectedBookIds).toEqual(['book-a', 'book-b']);
    expect(streamCharacterDraft.mock.calls[1][0].character).toEqual({ name: '当前角色' });
    expect(api.aiPlan.value).toBeNull();
    expect(api.aiPlanPhase.value).toBe('idle');
    expect(api.aiWorldBookChanges.value).toHaveLength(2);
    const runCount = streamCharacterDraft.mock.calls.length;
    await api.executeApprovedPlan();
    expect(streamCharacterDraft.mock.calls).toHaveLength(runCount);
  });

  it('resumes planned execution from its latest checkpoint while keeping the original target selection', async () => {
    const { api, selected } = fixture({ planMode: true, useCurrent: true });
    streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: { steps: [{ id: 'world-book-step', section: 'worldBook', intent: '更新原关联书', selected: true }] } });
    await api.completeWithAi();
    const checkpoint = { ...pendingResult().character, name: '阶段角色名' };
    streamCharacterDraft.mockImplementationOnce(async (_payload, handlers) => {
      handlers.checkpoint({ character: checkpoint });
      return { aborted: true };
    });
    await api.executeApprovedPlan();
    selected.value = ['different-book'];
    api.setAiWorldBookSelectedIds(['different-book']);
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.resumeCharacterAi();
    const resumed = streamCharacterDraft.mock.calls[2][0];
    expect(resumed.character.name).toBe('阶段角色名');
    expect(resumed.worldBookContext.selectedBookIds).toEqual(['book-a', 'book-b']);
    expect(resumed.worldBookContext.workspace.targets).toHaveLength(2);
  });

  it('restores an interrupted approved plan with its latest workspace after reopening the character', async () => {
    const { api } = fixture({ planMode: true, useCurrent: true });
    streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: { steps: [{ id: 'world-book-step', section: 'worldBook', intent: '继续核对关联书', selected: true }] } });
    await api.completeWithAi();
    streamCharacterDraft.mockImplementationOnce(async (_payload, handlers) => {
      handlers.checkpoint({ character: { ...pendingResult().character, name: '已完成的角色阶段' } });
      throw new Error('connection interrupted');
    });
    await api.executeApprovedPlan();
    expect(api.aiStatus.value).toBe('failed');
    scope.stop();
    const { api: restored } = fixture({ planMode: true, useCurrent: true });
    expect(restored.aiPlanPhase.value).toBe('executing');
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await restored.resumeCharacterAi();
    const request = streamCharacterDraft.mock.calls[2][0];
    expect(request.plan.steps[0].intent).toBe('继续核对关联书');
    expect(request.character.name).toBe('已完成的角色阶段');
    expect(request.worldBookContext.workspace.targets).toHaveLength(2);
    expect(restored.aiPlan.value).toBeNull();
  });
});
