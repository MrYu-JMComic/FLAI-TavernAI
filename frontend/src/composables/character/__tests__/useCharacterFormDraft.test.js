import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref, watch } from 'vue';
import { useCharacterFormDraft } from '../useCharacterFormDraft.js';

const fixtures = [];
const clone = (value) => JSON.parse(JSON.stringify(value));

async function fixture({ stored = null, write, read } = {}) {
  const scope = effectScope();
  const baseline = { name: 'Saved character', persona: '', settings: { notes: ['saved note'] } };
  const form = reactive(clone(baseline));
  const books = ref(['saved-book']);
  const canEdit = ref(true);
  const busy = ref(false);
  const disposed = ref(false);
  const server = { draft: stored };
  const writeDraft = vi.fn(write || (async (snapshot) => {
    server.draft = { ...clone(snapshot), updatedAt: '2026-10-21T01:00:00Z' };
    return server.draft;
  }));
  let draft;
  scope.run(() => {
    draft = useCharacterFormDraft({
      canEdit, isBusy: () => busy.value, isDisposed: () => disposed.value,
      buildPayload: () => clone(form), getSelectedWorldBookIds: () => books.value,
      applyPayload: (payload) => Object.assign(form, clone(payload)),
      setSelectedWorldBookIds: (ids) => { books.value = [...ids]; },
      readDraft: read || (async () => server.draft), writeDraft
    });
    watch(() => [clone(form), books.value], () => draft.scheduleCharacterDraftSave(), { deep: true });
  });
  const ready = draft.initializeCharacterDraftState();
  const result = { draft, form, books, baseline, canEdit, busy, disposed, scope, server, writeDraft, ready };
  fixtures.push(result);
  await ready;
  return result;
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); });
afterEach(async () => {
  for (const { draft, scope, disposed } of fixtures.splice(0)) {
    disposed.value = true;
    await draft.flushCharacterDraftBeforeDispose();
    scope.stop();
  }
  vi.useRealTimers();
});

describe('server character form drafts', () => {
  it('restores a complete server draft without writing browser payloads', async () => {
    const stored = { payload: { name: 'Draft', persona: 'Story', settings: { notes: ['draft'] } }, selectedWorldBookIds: ['draft-book'] };
    const { draft, form, books, writeDraft } = await fixture({ stored });
    expect(form.name).toBe('Saved character');
    expect(draft.pendingCharacterDraft.value).toEqual(stored);
    expect(draft.restoreCharacterDraft()).toBe(true);
    expect(form).toEqual(stored.payload);
    expect(books.value).toEqual(['draft-book']);
    expect(draft.hasUnsavedChanges.value).toBe(true);
    await draft.saveCharacterDraftNow();
    expect(writeDraft).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('compares server snapshots independent of nested object key order', async () => {
    const stored = { payload: { settings: { notes: ['saved note'] }, persona: '', name: 'Saved character' }, selectedWorldBookIds: ['saved-book'] };
    const { draft } = await fixture({ stored });
    expect(draft.pendingCharacterDraft.value).toBeNull();
    expect(draft.canDiscardCharacterDraft.value).toBe(false);
  });

  it('serializes writes and keeps the latest manual edit', async () => {
    const { draft, form, server, writeDraft } = await fixture();
    form.persona = 'First';
    const first = draft.saveCharacterDraftNow();
    form.persona = 'Latest';
    const latest = draft.saveCharacterDraftNow();
    expect(await first).toBe(true);
    expect(await latest).toBe(true);
    expect(writeDraft).toHaveBeenCalledTimes(2);
    expect(server.draft.payload.persona).toBe('Latest');
    expect(draft.characterDraftStatus.value).toBe('saved');
  });

  it('persists a return to the saved baseline after a previous autosave', async () => {
    const { draft, form, server } = await fixture();
    form.persona = 'Changed';
    await draft.saveCharacterDraftNow();
    form.persona = '';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1200);
    expect(server.draft.payload.persona).toBe('');
    expect(draft.hasUnsavedChanges.value).toBe(false);
  });

  it('waits for in-flight writes before discarding and accepts the latest database snapshot', async () => {
    let finish;
    let writes = 0;
    const latest = { payload: { name: 'External database update', persona: 'Latest', settings: { notes: [] } }, selectedWorldBookIds: ['latest-book'] };
    const { draft, form, books, writeDraft } = await fixture({ write: async (snapshot, options) => {
      writes += 1;
      if (!options?.reset) return new Promise((resolve) => { finish = resolve; });
      return { snapshot: latest };
    } });
    form.persona = 'Unsaved';
    const saving = draft.saveCharacterDraftNow();
    await Promise.resolve();
    await Promise.resolve();
    const discarding = draft.discardCharacterDraft();
    expect(writes).toBe(1);
    finish({});
    await saving;
    expect(await discarding).toBe(true);
    expect(writeDraft).toHaveBeenCalledTimes(2);
    expect(form).toEqual(latest.payload);
    expect(books.value).toEqual(['latest-book']);
    expect(draft.hasUnsavedChanges.value).toBe(false);
    await draft.saveCharacterDraftNow();
    expect(writeDraft).toHaveBeenCalledTimes(2);
  });

  it('does not let the periodic save recreate a draft while a server reset is pending', async () => {
    const stored = { payload: { name: 'Old draft', persona: 'Old text', settings: { notes: [] } }, selectedWorldBookIds: [] };
    const resetSnapshot = { payload: { name: 'Saved character', persona: 'Latest saved text', settings: { notes: [] } }, selectedWorldBookIds: ['latest-book'] };
    let finishReset;
    const { draft, form, books, writeDraft } = await fixture({ stored, write: async (_snapshot, options) => {
      if (!options?.reset) return null;
      return new Promise(resolve => { finishReset = () => resolve({ snapshot: resetSnapshot }); });
    } });
    draft.startCharacterDraftInterval();
    const discarding = draft.discardCharacterDraft();
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeDraft).toHaveBeenCalledTimes(1);

    finishReset();
    expect(await discarding).toBe(true);
    expect(form).toEqual(resetSnapshot.payload);
    expect(books.value).toEqual(['latest-book']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeDraft).toHaveBeenCalledTimes(1);
  });

  it('retains edits on save or discard failure and supports retry', async () => {
    const { draft, form, writeDraft } = await fixture();
    writeDraft.mockRejectedValueOnce(new Error('Unavailable'));
    form.persona = 'Keep this';
    expect(await draft.saveCharacterDraftNow()).toBe(false);
    expect(draft.characterDraftStatus.value).toBe('error');
    expect(form.persona).toBe('Keep this');
    expect(await draft.saveCharacterDraftNow()).toBe(true);
    writeDraft.mockRejectedValueOnce(new Error('Unavailable'));
    expect(await draft.discardCharacterDraft()).toBe(false);
    expect(form.persona).toBe('Keep this');
    expect(await draft.discardCharacterDraft()).toBe(true);
    expect(form.persona).toBe('');
  });

  it('guards discard while busy, read-only or disposed', async () => {
    const { draft, form, busy, canEdit, disposed, writeDraft } = await fixture();
    form.name = 'Unsaved';
    await nextTick();
    busy.value = true;
    expect(await draft.discardCharacterDraft()).toBe(false);
    busy.value = false;
    canEdit.value = false;
    expect(await draft.discardCharacterDraft()).toBe(false);
    canEdit.value = true;
    disposed.value = true;
    expect(await draft.discardCharacterDraft()).toBe(false);
    expect(writeDraft).not.toHaveBeenCalled();
    expect(form.name).toBe('Unsaved');
  });
});
