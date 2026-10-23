import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref } from 'vue';
import { useCharacterAiGeneration } from '../useCharacterAiGeneration.js';
import { streamCharacterDraft } from '../../../api/characters.js';
import { applyWorldBookChanges, fetchWorldBook } from '../../../api/worldBooks.js';
import { normalizeWorldBookEntryForCreate } from '../../../utils/worldBookDraft.js';
import { scanJsonBoundary } from '../../../../../backend/src/validations/schemas.js';

vi.mock('../../../api/characters.js', () => ({ streamCharacterDraft: vi.fn() }));
vi.mock('../../../api/worldBooks.js', () => ({ applyWorldBookChanges: vi.fn(), fetchWorldBook: vi.fn() }));
vi.mock('../../../api/mods.js', () => ({ createMod: vi.fn() }));
vi.mock('../../../../../backend/src/config.js', () => ({ JSON_BODY_LIMIT_DEFAULT_BYTES: 12 * 1024 * 1024 }));

let scope;
beforeEach(() => { localStorage.clear(); });
afterEach(() => { scope?.stop(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function fixture({ useCurrent = false, planMode = false, conversationMode = false, persistWorldBookDraft } = {}) {
  scope = effectScope();
  const selected = ref(['book-a', 'book-b']);
  const session = ref('character-a');
  const options = reactive({ profile: true, worldBook: true });
  const saving = ref(false);
  const onWorldBookCreated = vi.fn();
  const onWorldBookUpdated = vi.fn();
  const notify = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const api = scope.run(() => useCharacterAiGeneration({
    canEdit: ref(true), saving, form: reactive({ name: '当前角色' }), aiOptions: options,
    aiUseCurrentDraft: ref(useCurrent), assistantPlanMode: ref(planMode),
    getSelectedWorldBookIds: () => selected.value, getSessionId: () => session.value,
    isConversationMode: () => conversationMode,
    buildPayload: () => ({ name: '当前角色' }), onWorldBookCreated, onWorldBookUpdated,
    persistWorldBookDraft,
    notify
  }));
  if (conversationMode) api.selectAiSession({ id: 'assistant-session-a', state: {} });
  api.aiRequirement.value = '完善世界书';
  return { api, selected, session, options, saving, onWorldBookCreated, onWorldBookUpdated, notify };
}

function pendingResult() {
  const targets = [
    { ref: 'existing:book-b', bookId: 'book-b', profile: { name: '旧书' }, upserts: [{ entryId: 'entry-b', patch: { content: '新资料' } }], removals: [] },
    { ref: 'new:new-book', bookId: null, profile: { name: '新书' }, entries: [{ name: '航线', triggerKeys: '航线', content: '北方航线' }] }
  ];
  return { character: { worldBookWorkspace: { version: 1, activeRef: targets[1].ref, targets }, worldBookChanges: targets }, summary: '已准备两本书的变更' };
}

describe('character assistant world book context', () => {
  it('keeps conversation world books in the draft until an explicit character save and preserves linking choices', async () => {
    const { api, saving, onWorldBookCreated, onWorldBookUpdated } = fixture({ conversationMode: true });
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
    await api.applyAiWorldBookChanges();
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
    expect(api.aiWorldBookChanges.value).toHaveLength(2);

    api.setAiWorldBookAddToCharacter(api.aiWorldBookChanges.value[1], false);
    expect(api.exportAiSessionState().worldBookChanges[1].addToCharacter).toBe(false);
    applyWorldBookChanges.mockResolvedValueOnce({ books: [
      { ref: 'existing:book-b', book: { id: 'book-b', name: '旧书' } },
      { ref: 'new:new-book', book: { id: 'created-book', name: '新书' } }
    ] });
    saving.value = true;
    expect(await api.commitAiWorldBookChanges()).toBe(true);
    expect(applyWorldBookChanges).toHaveBeenCalledOnce();
    expect(applyWorldBookChanges.mock.calls[0][0].assistantSessionId).toBe('assistant-session-a');
    expect(onWorldBookCreated).not.toHaveBeenCalled();
    expect(onWorldBookUpdated).toHaveBeenCalledTimes(2);
    expect(api.aiWorldBookChanges.value).toEqual([]);
  });

  it('keeps a failed explicit world book commit retryable with the same request identity', async () => {
    const { api, saving } = fixture({ conversationMode: true });
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    saving.value = true;
    applyWorldBookChanges.mockRejectedValueOnce(new Error('response lost'));
    expect(await api.commitAiWorldBookChanges()).toBe(false);
    const requestId = applyWorldBookChanges.mock.calls[0][0].requestId;
    expect(api.aiWorldBookChanges.value).toHaveLength(2);
    applyWorldBookChanges.mockResolvedValueOnce({ books: [
      { ref: 'existing:book-b', book: { id: 'book-b' } },
      { ref: 'new:new-book', book: { id: 'created-book' } }
    ] });
    expect(await api.commitAiWorldBookChanges()).toBe(true);
    expect(applyWorldBookChanges.mock.calls[1][0].requestId).toBe(requestId);
  });

  it('preserves an explicit new-book linking choice across model checkpoints, more turns, and session restore', async () => {
    const { api } = fixture({ conversationMode: true });
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    api.setAiWorldBookAddToCharacter(api.aiWorldBookChanges.value[1], false);
    streamCharacterDraft.mockImplementationOnce(async (_payload, handlers) => {
      const result = pendingResult();
      result.character.worldBookChanges[1].entries[0].content = '继续完善的航线';
      handlers.checkpoint({ character: result.character });
      expect(api.aiWorldBookChanges.value[1].addToCharacter).toBe(false);
      expect(api.aiCheckpoint.value.character.worldBookChanges[1].addToCharacter).toBe(false);
      return result;
    });
    api.aiRequirement.value = '继续完善航线';
    await api.completeWithAi();
    expect(api.aiWorldBookChanges.value[1].addToCharacter).toBe(false);
    expect(api.aiWorldBookChanges.value[1].entries[0].content).toBe('继续完善的航线');
    const state = api.exportAiSessionState();
    expect(state.worldBookChanges[1].addToCharacter).toBe(false);
    expect(state.checkpoint.character.worldBookChanges[1].addToCharacter).toBe(false);
    api.selectAiSession({ id: 'assistant-session-a', state });
    expect(api.aiWorldBookChanges.value[1].addToCharacter).toBe(false);
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    expect(api.aiWorldBookChanges.value[1].addToCharacter).toBe(false);
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
  });

  it('aborts an explicit world book save when its retry identity cannot be persisted', async () => {
    const persistWorldBookDraft = vi.fn().mockRejectedValueOnce(new Error('session unavailable'));
    const { api, saving } = fixture({ conversationMode: true, persistWorldBookDraft });
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    saving.value = true;
    expect(await api.commitAiWorldBookChanges()).toBe(false);
    expect(applyWorldBookChanges).not.toHaveBeenCalled();
    expect(api.aiWorldBookChanges.value).toHaveLength(2);
    expect(api.exportAiSessionState().worldBookApplyRequest.requestId).toEqual(expect.any(String));
  });

  it('persists retry identity before applying and keeps successful rebasing after a later session save failure', async () => {
    const snapshots = [];
    let api;
    const persistWorldBookDraft = vi.fn(async () => {
      snapshots.push(api.exportAiSessionState());
      if (snapshots.length === 2) throw new Error('session unavailable after commit');
    });
    ({ api } = fixture({ conversationMode: true, persistWorldBookDraft }));
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await api.completeWithAi();
    applyWorldBookChanges.mockImplementationOnce(async () => {
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].worldBookApplyRequest.requestId).toEqual(expect.any(String));
      return { books: [
        { ref: 'existing:book-b', book: { id: 'book-b' } },
        { ref: 'new:new-book', book: { id: 'created-book' } }
      ] };
    });
    expect(await api.commitAiWorldBookChanges()).toBe(false);
    expect(snapshots[1].worldBookChanges).toEqual([]);
    expect(api.aiWorldBookChanges.value).toEqual([]);
    expect(await api.commitAiWorldBookChanges()).toBe(true);
    expect(applyWorldBookChanges).toHaveBeenCalledOnce();
  });

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

  it('isolates world book workspaces and restores only the selected server session', async () => {
    const { api, session } = fixture();
    streamCharacterDraft.mockResolvedValue(pendingResult());
    await api.completeWithAi();
    api.setAiWorldBookSelectedIds(['book-b']);
    const state = api.exportAiSessionState();
    session.value = 'character-other';
    await nextTick();
    expect(api.aiWorldBookChanges.value).toEqual([]);
    expect(api.aiRequirement.value).toBe('');
    session.value = 'character-a';
    await nextTick();
    expect(api.aiWorldBookChanges.value).toEqual([]);
    api.selectAiSession({ id: 'server-session-a', state });
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
    expect(resumed.character).not.toHaveProperty('worldBookWorkspace');
    expect(resumed.character).not.toHaveProperty('worldBookChanges');
    expect(resumed.worldBookContext.selectedBookIds).toEqual(['book-a', 'book-b']);
    expect(resumed.worldBookContext.workspace.targets).toHaveLength(2);
  });

  it('resumes six 30-entry world books using only their dedicated request context', async () => {
    const targets = Array.from({ length: 6 }, (_, bookIndex) => ({
      ref: `new:book-${bookIndex}`, profile: { name: `World ${bookIndex}` },
      entries: Array.from({ length: 30 }, (_, entryIndex) => ({
        id: `entry-${bookIndex}-${entryIndex}`,
        ...normalizeWorldBookEntryForCreate({ name: `Entry ${entryIndex}`, triggerKeys: 'Lore', content: 'Retained lore' }, entryIndex)
      }))
    }));
    const worldBookWorkspace = { version: 1, targets };
    const character = { name: 'Retained character', worldBookWorkspace, worldBookChanges: targets };
    const { api } = fixture({ conversationMode: true });
    api.selectAiSession({
      id: 'assistant-session-a', state: {
        requirement: 'Continue these drafts', status: 'paused',
        checkpoint: { character }, worldBookWorkspace, worldBookChanges: targets
      }
    });
    streamCharacterDraft.mockResolvedValueOnce({ character, summary: 'Continued safely' });

    await api.resumeCharacterAi();

    const request = streamCharacterDraft.mock.calls[0][0];
    expect(request.character).toEqual({ name: 'Retained character' });
    expect(request.worldBookContext.workspace.targets).toHaveLength(6);
    expect(request.worldBookContext.workspace.targets[0].entries).toHaveLength(30);
    expect(scanJsonBoundary({ ...request, character })).toMatch(/字段过多/);
    expect(scanJsonBoundary(request)).toBe('');
    expect(api.aiCheckpoint.value.character.worldBookWorkspace.targets).toHaveLength(6);
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
    const state = api.exportAiSessionState();
    scope.stop();
    const { api: restored } = fixture({ planMode: true, useCurrent: true });
    expect(restored.aiPlanPhase.value).toBe('idle');
    restored.selectAiSession({ id: 'server-session-a', state });
    expect(restored.aiPlanPhase.value).toBe('failed');
    streamCharacterDraft.mockResolvedValueOnce(pendingResult());
    await restored.resumeCharacterAi();
    const request = streamCharacterDraft.mock.calls[2][0];
    expect(request.plan.steps[0].intent).toBe('继续核对关联书');
    expect(request.character.name).toBe('已完成的角色阶段');
    expect(request.worldBookContext.workspace.targets).toHaveLength(2);
    expect(restored.aiPlan.value).toBeNull();
  });
});
