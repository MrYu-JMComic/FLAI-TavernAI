import { computed, ref } from 'vue';
const CHARACTER_FORM_DRAFT_AUTOSAVE_MS = 30000;
const CHARACTER_FORM_DRAFT_DEBOUNCE_MS = 1200;

export function useCharacterFormDraft({
  canEdit,
  persistenceEnabled = () => true,
  isDisposed = () => false,
  isBusy = () => false,
  buildPayload = () => ({}),
  getSelectedWorldBookIds = () => [],
  normalizePayload = (payload) => payload || {},
  normalizeWorldBookIds = (ids) => (Array.isArray(ids) ? ids : []),
  applyPayload = () => {},
  setSelectedWorldBookIds = () => {},
  readDraft = async () => null,
  writeDraft = async () => ({})
} = {}) {
  const pendingCharacterDraft = ref(null);
  const characterDraftStatus = ref('idle');
  const characterDraftSavedAt = ref('');
  const hasUnsavedChanges = ref(false);
  let characterDraftBaselineSerialized = '';
  let characterDraftSaveTimer = null;
  let characterDraftInterval = null;
  let characterDraftHydrating = false;
  let lastPersistedSnapshot = '';
  let saveQueue = Promise.resolve();
  let draftEpoch = 0;
  let draftReady = false;
  let draftResetting = false;

  const canDiscardCharacterDraft = computed(() => (
    Boolean(pendingCharacterDraft.value || hasUnsavedChanges.value || characterDraftSavedAt.value)
    && Boolean(canEdit?.value)
    && !isDisposed()
    && Boolean(characterDraftBaselineSerialized)
  ));

  const characterDraftStatusText = computed(() => {
    if (pendingCharacterDraft.value) {
      return '发现未提交的服务器草稿';
    }
    if (characterDraftStatus.value === 'saving') {
      return '正在保存服务器草稿...';
    }
    if (characterDraftStatus.value === 'saved') {
      return characterDraftSavedAt.value
        ? `服务器草稿已保存 ${formatCharacterDraftTime(characterDraftSavedAt.value)}`
        : '服务器草稿已保存';
    }
    if (characterDraftStatus.value === 'restored') {
      return '服务器草稿已恢复，保存角色后正式生效';
    }
    if (characterDraftStatus.value === 'error') {
      return '服务器草稿保存失败，当前输入仍保留，请重试';
    }
    return '';
  });

  async function initializeCharacterDraftState() {
    const epoch = ++draftEpoch;
    establishCharacterDraftBaseline();
    draftReady = false;
    lastPersistedSnapshot = characterDraftBaselineSerialized;
    await loadPendingCharacterDraft(epoch);
    if (!isDisposed() && epoch === draftEpoch) draftReady = true;
  }

  function establishCharacterDraftBaseline() {
    characterDraftBaselineSerialized = serializeCharacterDraftSnapshot(buildCharacterDraftSnapshot());
    characterDraftStatus.value = 'idle';
    characterDraftSavedAt.value = '';
    hasUnsavedChanges.value = false;
    draftReady = true;
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
    return stableSerialize({
      payload: normalizePayload(snapshot.payload),
      selectedWorldBookIds: normalizeWorldBookIds(snapshot.selectedWorldBookIds)
    });
  }

  async function loadPendingCharacterDraft(epoch) {
    pendingCharacterDraft.value = null;
    if (!canEdit?.value || !persistenceEnabled()) return;
    const draft = await readDraft();
    if (isDisposed() || epoch !== draftEpoch) return;
    if (!draft) {
      return;
    }
    const serialized = serializeCharacterDraftSnapshot(draft);
    lastPersistedSnapshot = serialized;
    if (!serialized || serialized === characterDraftBaselineSerialized) {
      return;
    }
    pendingCharacterDraft.value = draft;
    characterDraftSavedAt.value = draft.updatedAt || '';
    characterDraftStatus.value = 'idle';
  }

  function clearCurrentCharacterDraft() {
    clearCharacterDraftSaveTimer();
    draftEpoch += 1;
    lastPersistedSnapshot = serializeCharacterDraftSnapshot();
    pendingCharacterDraft.value = null;
    characterDraftStatus.value = 'idle';
    characterDraftSavedAt.value = '';
    hasUnsavedChanges.value = false;
  }

  function restoreCharacterDraft() {
    const draft = pendingCharacterDraft.value;
    if (!draft || isDisposed() || isBusy() || !canEdit?.value) {
      return false;
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
    return true;
  }

  async function discardCharacterDraft() {
    if (isBusy() || draftResetting || !canDiscardCharacterDraft.value) return false;
    draftResetting = true;
    const baseline = JSON.parse(characterDraftBaselineSerialized);
    clearCharacterDraftSaveTimer();
    const epoch = ++draftEpoch;
    await saveQueue;
    let resetSnapshot = baseline;
    try {
      const saved = persistenceEnabled() ? await writeDraft(baseline, { reset: true }) : null;
      resetSnapshot = saved?.snapshot || baseline;
    } catch {
      draftResetting = false;
      characterDraftStatus.value = 'error';
      return false;
    }
    if (isDisposed() || epoch !== draftEpoch) {
      draftResetting = false;
      return false;
    }
    characterDraftHydrating = true;
    try {
      applyPayload(resetSnapshot.payload);
      setSelectedWorldBookIds(resetSnapshot.selectedWorldBookIds);
    } finally {
      characterDraftHydrating = false;
    }
    establishCharacterDraftBaseline();
    clearCurrentCharacterDraft();
    draftResetting = false;
    return true;
  }

  function scheduleCharacterDraftSave() {
    const serialized = refreshCharacterDraftDirtyState();
    clearCharacterDraftSaveTimer();
    if (!canPersistCharacterDraft() || serialized === lastPersistedSnapshot) {
      return;
    }
    characterDraftSaveTimer = setTimeout(() => {
      characterDraftSaveTimer = null;
      saveCharacterDraftNow();
    }, CHARACTER_FORM_DRAFT_DEBOUNCE_MS);
  }

  function saveCharacterDraftNow() {
    clearCharacterDraftSaveTimer();
    if (!canPersistCharacterDraft()) {
      return saveQueue.then(() => !persistenceEnabled() || (draftReady && !draftResetting && !pendingCharacterDraft.value));
    }
    const snapshot = buildCharacterDraftSnapshot();
    const serialized = refreshCharacterDraftDirtyState();
    if (!pendingCharacterDraft.value
      && serialized === characterDraftBaselineSerialized
      && serialized === lastPersistedSnapshot) {
      return saveQueue.then(() => true);
    }
    const epoch = draftEpoch;
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (epoch !== draftEpoch || serialized === lastPersistedSnapshot) return true;
      characterDraftStatus.value = 'saving';
      try {
        const saved = await writeDraft(snapshot);
        if (isDisposed() || epoch !== draftEpoch) return true;
        lastPersistedSnapshot = serialized;
        characterDraftSavedAt.value = saved?.updatedAt || new Date().toISOString();
        characterDraftStatus.value = 'saved';
        return true;
      } catch {
        if (!isDisposed() && epoch === draftEpoch) characterDraftStatus.value = 'error';
        return false;
      }
    });
    return saveQueue;
  }

  function canPersistCharacterDraft() {
    return !isDisposed()
      && !characterDraftHydrating
      && !draftResetting
      && Boolean(canEdit?.value)
      && !pendingCharacterDraft.value
      && draftReady
      && Boolean(characterDraftBaselineSerialized)
      && persistenceEnabled();
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
    const saved = saveCharacterDraftNow();
    clearCharacterDraftSaveTimer();
    stopCharacterDraftInterval();
    return saved;
  }

  return {
    canDiscardCharacterDraft,
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
    saveCharacterDraftNow,
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

function stableSerialize(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
