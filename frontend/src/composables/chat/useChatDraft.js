import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'flai-chat-drafts:v1';
const MAX_DRAFTS = 20;
const MAX_STORAGE_CHARS = 512 * 1024;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Drafts are tab-local and scoped to both account and conversation. Persist
// text only: image data URLs can exhaust synchronous browser storage quickly.
export function useChatDraft({ input, conversationId, userId }) {
  const draftStatus = ref('empty');
  const scope = computed(() => (
    userId.value && conversationId.value
      ? JSON.stringify([String(userId.value), String(conversationId.value)])
      : ''
  ));
  let activeScope = '';
  let saveTimer = null;
  let dirty = false;
  let restoring = false;
  let disposed = false;

  function readEntries(storage) {
    const payload = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (payload?.version !== 1 || !Array.isArray(payload.entries)) return [];
    const now = Date.now();
    return payload.entries.filter((entry) => (
      typeof entry?.scope === 'string' && typeof entry?.text === 'string'
      && entry.text.length > 0 && Number.isFinite(entry.savedAt)
      && entry.savedAt <= now && now - entry.savedAt < DRAFT_TTL_MS
    )).slice(-MAX_DRAFTS);
  }

  function cancelSave() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
  }

  function flushDraft() {
    cancelSave();
    if (disposed || !dirty || !activeScope) return;
    try {
      const storage = window.sessionStorage;
      let entries;
      try { entries = readEntries(storage); } catch { entries = []; }
      entries = entries.filter((entry) => entry.scope !== activeScope);
      const activeEntry = { scope: activeScope, text: input.value, savedAt: Date.now() };
      if (JSON.stringify({ version: 1, entries: [activeEntry] }).length > MAX_STORAGE_CHARS) {
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
        draftStatus.value = 'unavailable';
        return;
      }
      if (input.value) entries.push(activeEntry);
      entries = entries.slice(-MAX_DRAFTS);
      let serialized = JSON.stringify({ version: 1, entries });
      // Evict old drafts, never truncate the active prompt. An oversized active
      // draft stays in the composer and is explicitly marked as not cached.
      while (entries.length > 1 && serialized.length > MAX_STORAGE_CHARS) {
        entries.shift();
        serialized = JSON.stringify({ version: 1, entries });
      }
      storage.setItem(STORAGE_KEY, serialized);
      dirty = false;
      draftStatus.value = input.value ? 'saved' : 'empty';
    } catch {
      // Storage denial must not prevent typing or sending a message.
      draftStatus.value = input.value ? 'unavailable' : 'empty';
    }
  }

  function scheduleSave() {
    if (disposed || restoring) return;
    dirty = true;
    cancelSave();
    draftStatus.value = input.value ? 'pending' : 'empty';
    // Clear submitted/erased text immediately so a reload cannot revive it.
    if (!input.value) flushDraft();
    else saveTimer = setTimeout(flushDraft, 250);
  }

  const stopScopeWatch = watch(scope, (nextScope, previousScope) => {
    flushDraft();
    activeScope = nextScope;
    dirty = false;
    restoring = true;
    try {
      if (previousScope !== undefined) input.value = '';
      if (!input.value && nextScope) {
        const entries = readEntries(window.sessionStorage);
        input.value = entries.find((entry) => entry.scope === nextScope)?.text || '';
      }
      draftStatus.value = input.value ? 'saved' : 'empty';
    } catch {
      draftStatus.value = input.value ? 'unavailable' : 'empty';
    } finally {
      restoring = false;
    }
  }, { immediate: true, flush: 'sync' });
  const stopInputWatch = watch(input, scheduleSave, { flush: 'sync' });
  if (input.value) scheduleSave();

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') flushDraft();
  }

  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushDraft);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange);

  function cleanup() {
    flushDraft();
    disposed = true;
    cancelSave();
    stopScopeWatch();
    stopInputWatch();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushDraft);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
  }

  return { draftStatus, flushDraft, cleanup };
}
