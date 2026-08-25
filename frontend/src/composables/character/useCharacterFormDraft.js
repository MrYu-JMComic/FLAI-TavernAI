import { computed, ref } from 'vue';
import { recordFrontendDiagnostic } from '../../diagnostics.js';

const CHARACTER_FORM_DRAFT_STORAGE_PREFIX = 'flai-character-form-draft';
const CHARACTER_FORM_DRAFT_AUTOSAVE_MS = 30000;
const CHARACTER_FORM_DRAFT_DEBOUNCE_MS = 1200;
const CHARACTER_FORM_DRAFT_MAX_CHARS = 200000;

export function useCharacterFormDraft({
  isEditing,
  editingCharacterId,
  canEdit,
  isDisposed = () => false,
  buildPayload = () => ({}),
  getSelectedWorldBookIds = () => [],
  normalizePayload = (payload) => payload || {},
  normalizeWorldBookIds = (ids) => (Array.isArray(ids) ? ids : []),
  applyPayload = () => {},
  setSelectedWorldBookIds = () => {}
} = {}) {
  const pendingCharacterDraft = ref(null);
  const characterDraftStatus = ref('idle');
  const characterDraftSavedAt = ref('');
  const hasUnsavedChanges = ref(false);
  let characterDraftBaselineSerialized = '';
  let characterDraftSaveTimer = null;
  let characterDraftInterval = null;
  let characterDraftHydrating = false;

  const characterDraftStatusText = computed(() => {
    if (pendingCharacterDraft.value) {
      return '发现未提交的本地草稿';
    }
    if (characterDraftStatus.value === 'saving') {
      return '草稿保存中...';
    }
    if (characterDraftStatus.value === 'saved') {
      return characterDraftSavedAt.value
        ? `草稿已自动保存 ${formatCharacterDraftTime(characterDraftSavedAt.value)}`
        : '草稿已自动保存';
    }
    if (characterDraftStatus.value === 'restored') {
      return '草稿已恢复，保存角色后会清理本地草稿';
    }
    if (characterDraftStatus.value === 'too-large') {
      return '草稿内容过大，已暂停自动保存';
    }
    if (characterDraftStatus.value === 'error') {
      return '草稿暂时无法保存';
    }
    return '';
  });

  function initializeCharacterDraftState() {
    establishCharacterDraftBaseline();
    loadPendingCharacterDraft();
  }

  function establishCharacterDraftBaseline() {
    characterDraftBaselineSerialized = serializeCharacterDraftSnapshot(buildCharacterDraftSnapshot());
    characterDraftStatus.value = 'idle';
    characterDraftSavedAt.value = '';
    hasUnsavedChanges.value = false;
  }

  function refreshCharacterDraftDirtyState() {
    const serialized = serializeCharacterDraftSnapshot(buildCharacterDraftSnapshot());
    hasUnsavedChanges.value = Boolean(
      characterDraftBaselineSerialized
      && serialized
      && serialized !== characterDraftBaselineSerialized
    );
    return serialized;
  }

  function buildCharacterDraftSnapshot() {
    return {
      payload: normalizePayload(buildPayload()),
      selectedWorldBookIds: normalizeWorldBookIds(getSelectedWorldBookIds())
    };
  }

  function serializeCharacterDraftSnapshot(snapshot = buildCharacterDraftSnapshot()) {
    return JSON.stringify({
      payload: normalizePayload(snapshot.payload),
      selectedWorldBookIds: normalizeWorldBookIds(snapshot.selectedWorldBookIds)
    });
  }

  function getCharacterDraftStorageKey() {
    if (isEditing?.value) {
      const characterId = String(editingCharacterId?.value || '').trim();
      return characterId ? `${CHARACTER_FORM_DRAFT_STORAGE_PREFIX}:edit:${characterId}` : '';
    }
    return `${CHARACTER_FORM_DRAFT_STORAGE_PREFIX}:new`;
  }

  function loadPendingCharacterDraft() {
    pendingCharacterDraft.value = null;
    if (!canEdit?.value) {
      return;
    }
    const draft = readCharacterDraftFromStorage();
    if (!draft) {
      return;
    }
    const serialized = serializeCharacterDraftSnapshot(draft);
    if (!serialized || serialized === characterDraftBaselineSerialized) {
      removeCharacterDraftFromStorage();
      return;
    }
    pendingCharacterDraft.value = draft;
    characterDraftSavedAt.value = draft.updatedAt || '';
    characterDraftStatus.value = 'idle';
  }

  function readCharacterDraftFromStorage() {
    const key = getCharacterDraftStorageKey();
    if (!key) {
      return null;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return normalizeCharacterDraftRecord(parsed);
    } catch {
      removeCharacterDraftFromStorage();
      return null;
    }
  }

  function normalizeCharacterDraftRecord(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }
    const payload = normalizePayload(input.payload || input.character || {});
    return {
      payload,
      selectedWorldBookIds: normalizeWorldBookIds(input.selectedWorldBookIds || input.worldBookIds),
      updatedAt: String(input.updatedAt || '')
    };
  }

  function removeCharacterDraftFromStorage() {
    const key = getCharacterDraftStorageKey();
    if (!key) {
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch (error) {
      recordFrontendDiagnostic('characterForm.draft.remove', error, { key });
    }
  }

  function clearCurrentCharacterDraft() {
    clearCharacterDraftSaveTimer();
    removeCharacterDraftFromStorage();
    pendingCharacterDraft.value = null;
    characterDraftStatus.value = 'idle';
    characterDraftSavedAt.value = '';
    hasUnsavedChanges.value = false;
  }

  function restoreCharacterDraft() {
    const draft = pendingCharacterDraft.value;
    if (!draft || !canEdit?.value) {
      return;
    }
    characterDraftHydrating = true;
    try {
      applyPayload(draft.payload);
      setSelectedWorldBookIds(draft.selectedWorldBookIds);
    } finally {
      characterDraftHydrating = false;
    }
    pendingCharacterDraft.value = null;
    characterDraftStatus.value = 'restored';
    characterDraftSavedAt.value = draft.updatedAt || '';
    refreshCharacterDraftDirtyState();
    scheduleCharacterDraftSave();
  }

  function discardCharacterDraft() {
    clearCurrentCharacterDraft();
    scheduleCharacterDraftSave();
  }

  function scheduleCharacterDraftSave() {
    refreshCharacterDraftDirtyState();
    if (!canPersistCharacterDraft()) {
      return;
    }
    clearCharacterDraftSaveTimer();
    characterDraftSaveTimer = setTimeout(() => {
      characterDraftSaveTimer = null;
      saveCharacterDraftNow();
    }, CHARACTER_FORM_DRAFT_DEBOUNCE_MS);
  }

  function saveCharacterDraftNow() {
    clearCharacterDraftSaveTimer();
    if (!canPersistCharacterDraft()) {
      return false;
    }
    const snapshot = buildCharacterDraftSnapshot();
    const serialized = refreshCharacterDraftDirtyState();
    if (!serialized || serialized === characterDraftBaselineSerialized) {
      removeCharacterDraftFromStorage();
      characterDraftStatus.value = 'idle';
      characterDraftSavedAt.value = '';
      return false;
    }
    const updatedAt = new Date().toISOString();
    const raw = JSON.stringify({
      version: 1,
      mode: isEditing?.value ? 'edit' : 'new',
      characterId: isEditing?.value ? editingCharacterId?.value : '',
      updatedAt,
      ...snapshot
    });
    if (raw.length > CHARACTER_FORM_DRAFT_MAX_CHARS) {
      characterDraftStatus.value = 'too-large';
      return false;
    }
    characterDraftStatus.value = 'saving';
    try {
      localStorage.setItem(getCharacterDraftStorageKey(), raw);
      characterDraftSavedAt.value = updatedAt;
      characterDraftStatus.value = 'saved';
      return true;
    } catch {
      characterDraftStatus.value = 'error';
      return false;
    }
  }

  function canPersistCharacterDraft() {
    return !isDisposed()
      && !characterDraftHydrating
      && Boolean(canEdit?.value)
      && !pendingCharacterDraft.value
      && Boolean(characterDraftBaselineSerialized)
      && Boolean(getCharacterDraftStorageKey());
  }

  function startCharacterDraftInterval() {
    if (characterDraftInterval !== null) {
      return;
    }
    characterDraftInterval = setInterval(saveCharacterDraftNow, CHARACTER_FORM_DRAFT_AUTOSAVE_MS);
  }

  function clearCharacterDraftSaveTimer() {
    if (characterDraftSaveTimer !== null) {
      clearTimeout(characterDraftSaveTimer);
    }
    characterDraftSaveTimer = null;
  }

  function stopCharacterDraftInterval() {
    if (characterDraftInterval !== null) {
      clearInterval(characterDraftInterval);
    }
    characterDraftInterval = null;
  }

  function flushCharacterDraftBeforeDispose() {
    saveCharacterDraftNow();
    clearCharacterDraftSaveTimer();
    stopCharacterDraftInterval();
  }

  return {
    characterDraftSavedAt,
    characterDraftStatus,
    characterDraftStatusText,
    clearCurrentCharacterDraft,
    discardCharacterDraft,
    establishCharacterDraftBaseline,
    flushCharacterDraftBeforeDispose,
    hasUnsavedChanges,
    initializeCharacterDraftState,
    pendingCharacterDraft,
    restoreCharacterDraft,
    scheduleCharacterDraftSave,
    startCharacterDraftInterval
  };
}

function formatCharacterDraftTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
