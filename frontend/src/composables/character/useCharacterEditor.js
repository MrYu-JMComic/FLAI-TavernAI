import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import {
  createCharacter,
  deleteCharacter,
  fetchCharacter,
  fetchCharacterWorldBooks,
  linkCharacterWorldBook,
  unlinkCharacterWorldBook,
  updateCharacter
} from '../../api/characters.js';
import { exportEnvelope } from '../../api/envelopes.js';
import { createAssistantSession, fetchAssistantSession, fetchAssistantSessions, resetCharacterAssistantDraftFromSavedCharacter, updateAssistantSession } from '../../api/characterAssistant.js';
import { useNotify } from '../useNotify';
import { useProviderModels } from '../useProviderModels';
import { useCharacterAiGeneration } from './useCharacterAiGeneration';
import { useCharacterAiPreferences } from './useCharacterAiPreferences';
import { useCharacterCreationWizard } from './useCharacterCreationWizard';
import { useCharacterFormDraft } from './useCharacterFormDraft';
import { useCharacterFormOptions } from './useCharacterFormOptions';
import {
  emptyCharacter,
  hasNonDefaultAccessorySkills,
  normalizeAccessorySkillsForPayload,
  normalizeAdvancedSettingsForForm,
  normalizeCharacterDraftPayload,
  normalizeForForm,
  parseTagsTextForPayload
} from './useCharacterFormPayload';
import { useCharacterImageUploads } from './useCharacterImageUploads';
import { useCharacterRegexRules } from './useCharacterRegexRules';
import { useCharacterRenderPlugins } from './useCharacterRenderPlugins';
import { configuredSectionStatus, countedSectionStatus, useCharacterSections } from './useCharacterSections';
import {
  hasStatusBarBlueprintContent,
  normalizeStatusBarBlueprintForPayload,
  useCharacterStatusBlueprint
} from './useCharacterStatusBlueprint';
import { useCharacterWorldBookDialog } from './useCharacterWorldBookDialog';
import { downloadJsonFile, todayStamp } from '../../utils/downloadJson.js';
import { recordFrontendDiagnostic } from '../../diagnostics.js';

export const CHARACTER_EDITOR_KEY = Symbol('characterEditor');

export const CHARACTER_SECTION_GROUPS = [
  { id: 'core', label: '角色内容' },
  { id: 'assets', label: '角色资产' },
  { id: 'advanced', label: '高级能力' }
];

export const ACCESSORY_SKILL_ITEMS = [
  { key: 'sceneAgent', label: '场景构建助手', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
  { key: 'memoryAgent', label: '记忆 Agent', auto: true },
  { key: 'economyAgent', label: '经济识别', auto: false },
  { key: 'talentPrompt', label: '天赋提示', auto: false },
  { key: 'cgScene', label: 'CG 场景', auto: false }
];

/**
 * Owns every piece of character editor state. The view provides the returned
 * object so the desktop and mobile shells render the same data without
 * threading dozens of props through each layer.
 */
export function useCharacterEditor({ props, emit }) {
  const notify = useNotify();

  const isEditing = computed(() => ['characterEdit', 'characterAssistant'].includes(props.route.name));
  const isAssistantPage = computed(() => ['characterAssistant', 'characterAssistantNew'].includes(props.route.name));
  const editingCharacterId = computed(() => props.route.params.id || '');
  const loading = ref(false);
  const loadError = ref('');
  const saving = ref(false);
  const deleting = ref(false);
  const exporting = ref(false);
  const showStatusPreviewDialog = ref(false);
  const nameError = ref('');
  const previewInput = ref('');
  const form = reactive(emptyCharacter());
  const savedCharacter = shallowRef(null);
  const savedAvatarUrl = ref('');
  const savedWorldBookIds = ref([]);
  const canEdit = computed(() => !isEditing.value || form.canEdit !== false);

  let characterFormDisposed = false;
  let editingCharacterLoadToken = 0;
  let formSubmitToken = 0;
  let characterDeleteToken = 0;
  let characterExportToken = 0;
  let assistantHandoffPending = false;
  let createdAssistantCharacterId = '';
  let manualDraftSession = null;
  let manualDraftScope = 0;

  const aiOptions = reactive({
    profile: true,
    background: true,
    worldview: true,
    persona: true,
    openingMessage: true,
    tags: true,
    regexRules: true,
    renderPlugins: true,
    worldBook: true,
    advancedSettings: true,
    modSuggestions: true
  });

  const {
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    assistantProviderProfileId,
    assistantProviderProfiles,
    assistantProviderSettings,
    assistantModelsLoading,
    assistantModelsError,
    loadAssistantProviderProfiles,
    refreshAssistantModels,
    selectAssistantProviderProfile,
    assistantPlanMode,
    assistantStreamingEnabled,
    assistantThinkingLevel,
    assistantThinkingOptions,
    assistantThinkingSupported
  } = useCharacterAiPreferences(computed(() => props.provider), computed(() => props.user));
  const { providerModelOptionsFor } = useProviderModels(computed(() => props.provider));

  const {
    addWorldBookOption,
    canCreateSearchedTag,
    cancelCharacterFormOptions,
    createAndSelectTag,
    filteredTags,
    loadFormOptions,
    normalizeWorldBookIds,
    optionsLoadError,
    optionsLoading,
    selectedWorldBookIds,
    setSelectedWorldBookIdsFromBooksIfChanged,
    setSelectedWorldBookIdsIfChanged,
    tagCreating,
    tagSearch,
    toggleTagSelection,
    toggleWorldBook,
    worldBooks
  } = useCharacterFormOptions({
    canEdit,
    isDisposed: () => characterFormDisposed,
    notify,
    selectedTags: computed(() => form.selectedTags)
  });

  const {
    aiSessionId,
    aiConversationHistory,
    aiContext,
    selectAiSession: restoreAssistantRuntime,
    exportAiSessionState: exportAssistantRuntimeState,
    aiLoading,
    aiCheckpoint,
    aiCheckpointUpdatedAt,
    aiHasCheckpoint,
    aiLastError,
    aiRequirement,
    aiAttachments,
    aiStatus,
    aiStatusMessage,
    aiFinalContent,
    aiToolCalls,
    aiWarnings,
    aiProcess,
    aiReasoning,
    aiModSuggestions,
    aiWorldBookChanges,
    aiWorldBookSelectedIds,
    aiWorldBookAutomatic,
    aiWorldBookSourceLabel,
    aiWorldBookCreating,
    aiPlan,
    aiPlanExtraRequirement,
    aiPlanPhase,
    aiPlanStepStatus,
    suggestedModsCreating,
    advancedAiLoading,
    advancedAiRequirement,
    characterAiActionBusy,
    cancelCharacterAiGeneration,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    applyAiWorldBookChanges,
    commitAiWorldBookChanges,
    setAiWorldBookAddToCharacter,
    reloadAiWorldBook,
    discardAiWorldBookChange,
    setAiWorldBookSelectedIds,
    setAiWorldBookAutomatic,
    requestAiNewWorldBook,
    discardAiSession,
    discardCharacterPlan,
    executeApprovedPlan,
    replanCharacterAi,
    resumeCharacterAi,
    retryCharacterAi,
    saveAiCheckpoint,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi,
    toggleAiPlanStep,
    updateAiPlanStep
  } = useCharacterAiGeneration({
    canEdit,
    saving,
    form,
    aiOptions,
    aiUseCurrentDraft,
    assistantModel,
    assistantProviderProfileId,
    assistantPlanMode,
    assistantStreamingEnabled,
    assistantThinkingLevel,
    buildPayload: toPayload,
    applyAdvancedSettingsDraft,
    onWorldBookCreated: handleAiWorldBookCreated,
    onWorldBookUpdated: (book) => addWorldBookOption(book),
    persistWorldBookDraft: persistAssistantWorldBookDraft,
    getSelectedWorldBookIds: () => selectedWorldBookIds.value,
    getSessionId: () => editingCharacterId.value || 'new',
    isConversationMode: () => isAssistantPage.value,
    isDisposed: () => characterFormDisposed,
    notify
  });

  function handleAiWorldBookCreated(book) {
    const bookId = String(book?.id || '').trim();
    if (!bookId) return;
    addWorldBookOption(book);
    if (!selectedWorldBookIds.value.includes(bookId)) {
      setSelectedWorldBookIdsIfChanged([...selectedWorldBookIds.value, bookId]);
    }
  }

  async function persistAssistantWorldBookDraft() {
    if (!aiSessionId.value) return;
    // Keep both the retry identity and any saved new-book IDs durable before
    // proceeding to the next save step, including the editor handoff path.
    const state = exportAiSessionState();
    const statePatch = {};
    // Checkpoint and plan copies of the workspace are synchronized server-side.
    for (const key of ['worldBookWorkspace', 'worldBookChanges', 'worldBookApplyRequest']) {
      statePatch[key] = state[key];
    }
    await updateAssistantSession(aiSessionId.value, {
      character: toPayload(),
      statePatch: {
        ...statePatch,
        selectedWorldBookIds: [...selectedWorldBookIds.value],
        worldBookLinkDraft: state.worldBookLinkDraft
      }
    });
  }

  const {
    backgroundUploading,
    cancelCharacterImageUploads,
    clearAdvancedBackground,
    clearAvatar,
    handleAdvancedBackground,
    handleAvatar
  } = useCharacterImageUploads({
    canEdit,
    form,
    isDisposed: () => characterFormDisposed,
    notify
  });

  const {
    addStatusBlueprintVariable,
    applyStatusBlueprintSampleTemplate,
    clearStatusBlueprintTemplate,
    refreshStatusBlueprintVariables,
    removeStatusBlueprintVariable,
    setColorValueFromEvent,
    setStatusBlueprintVariableModeFromEvent,
    setStatusBlueprintVariableValueFromEvent,
    statusBarBlueprintPreview,
    statusBarBlueprintPreviewConfig,
    statusBarBlueprintTemplateStats,
    statusBlueprintEditorRows
  } = useCharacterStatusBlueprint({ canEdit, form, notify });

  const {
    addRule,
    regexPreview,
    removeRule
  } = useCharacterRegexRules({ canEdit, form, previewInput });

  const {
    addRenderPlugin,
    enabledRenderPlugins,
    removeRenderPlugin,
    renderPluginPreviewText
  } = useCharacterRenderPlugins({ canEdit, form });

  const formSections = [
    {
      id: 'basic',
      label: '基础信息',
      hint: '身份、头像、标签与世界书',
      group: 'core',
      status: () => countedSectionStatus([
        hasText(form.name),
        hasText(form.avatarUrl),
        form.selectedTags.length > 0 || hasText(form.tagsText)
      ])
    },
    {
      id: 'settings',
      label: '角色设定',
      hint: '背景、世界观、人设、开场白',
      group: 'core',
      status: () => countedSectionStatus([
        hasText(form.background),
        hasText(form.worldview),
        hasText(form.persona),
        hasText(form.openingMessage)
      ])
    },
    {
      id: 'ai',
      label: 'AI 完善',
      hint: '让助手补全角色内容',
      group: 'core',
      visible: () => canEdit.value
    },
    {
      id: 'images',
      label: '角色图片',
      hint: '立绘与场景图管理',
      group: 'assets',
      visible: () => isEditing.value && Boolean(editingCharacterId.value)
    },
    {
      id: 'talents',
      label: '角色天赋',
      hint: '天赋抽取与配置',
      group: 'assets',
      visible: () => isEditing.value && Boolean(editingCharacterId.value)
    },
    {
      id: 'advanced-settings',
      label: '外观与 AI',
      hint: '角色背景图与作者侧 AI',
      group: 'advanced',
      status: () => configuredSectionStatus(
        hasText(form.authorAdvancedSettings.desktopBackgroundUrl)
        || hasText(form.authorAdvancedSettings.mobileBackgroundUrl)
        || hasText(advancedAiRequirement.value)
      )
    },
    {
      id: 'status-blueprint',
      label: '状态栏',
      hint: '提示词、变量与初始模板',
      group: 'advanced',
      status: () => configuredSectionStatus(
        hasText(form.authorAdvancedSettings.statusBarPrompt)
        || statusBlueprintEditorRows.value.length > 0
      )
    },
    {
      id: 'accessories',
      label: '附属技能',
      hint: '新会话默认启用项',
      group: 'advanced',
      status: () => configuredSectionStatus(hasEnabledAccessorySkill())
    },
    {
      id: 'custom-code',
      label: '扩展代码',
      hint: '角色自定义 CSS 与 JS',
      group: 'advanced',
      status: () => configuredSectionStatus(
        hasText(form.authorAdvancedSettings.customCss)
        || hasText(form.authorAdvancedSettings.customJs)
        || form.authorAdvancedSettings.customCssEnabled
        || form.authorAdvancedSettings.customJsEnabled
      )
    },
    {
      id: 'render-plugins',
      label: '渲染插件',
      hint: '把回复片段渲染成卡片',
      group: 'advanced',
      status: () => configuredSectionStatus(form.renderPlugins.length > 0)
    },
    {
      id: 'regex',
      label: '正则规则',
      hint: '对收发文本做替换',
      group: 'advanced',
      status: () => configuredSectionStatus(form.regexRules.length > 0)
    }
  ];

  // The wizard gates section visibility, so it is created first. It reaches the
  // section state through the hoisted `forceActiveSection` declaration below.
  const {
    CHARACTER_CREATION_WIZARD_STEPS,
    characterWizardProgressText,
    characterWizardStepId,
    characterWizardStepIndex,
    currentCharacterWizardStep,
    goToNextCharacterWizardStep,
    goToPreviousCharacterWizardStep,
    isCharacterCreationFullForm,
    isCharacterCreationWizardActive,
    isCharacterCreationWizardAvailable,
    isCharacterSectionVisibleInCurrentMode,
    setCharacterCreationMode,
    setCharacterWizardStep
  } = useCharacterCreationWizard({
    isEditing,
    canEdit,
    setActiveSection: forceActiveSection
  });

  const {
    activeSection,
    activeSectionDefinition,
    goToNextSection,
    goToPreviousSection,
    hasNextSection,
    hasPreviousSection,
    sectionGroups,
    sectionStatus,
    setActiveSection,
    visibleSections
  } = useCharacterSections({
    sections: formSections,
    groups: CHARACTER_SECTION_GROUPS,
    isSectionVisible: (section) => isCharacterSectionVisibleInCurrentMode(section.id)
  });

  function forceActiveSection(sectionId) {
    activeSection.value = sectionId;
  }

  const {
    canDiscardCharacterDraft,
    characterDraftStatus,
    characterDraftStatusText,
    clearCurrentCharacterDraft,
    discardCharacterDraft: discardPersistedCharacterDraft,
    establishCharacterDraftBaseline,
    flushCharacterDraftBeforeDispose,
    hasUnsavedChanges,
    initializeCharacterDraftState,
    pendingCharacterDraft,
    restoreCharacterDraft: restorePersistedCharacterDraft,
    saveCharacterDraftNow,
    scheduleCharacterDraftSave,
    startCharacterDraftInterval
  } = useCharacterFormDraft({
    canEdit,
    persistenceEnabled: () => !isAssistantPage.value,
    isDisposed: () => characterFormDisposed,
    isBusy: () => saving.value || deleting.value || exporting.value || aiLoading.value || advancedAiLoading.value || aiWorldBookCreating.value,
    buildPayload: toPayload,
    getSelectedWorldBookIds: () => selectedWorldBookIds.value,
    normalizePayload: normalizeCharacterDraftPayload,
    normalizeWorldBookIds,
    applyPayload: applyCharacterDraftPayload,
    setSelectedWorldBookIds: setSelectedWorldBookIdsIfChanged,
    readDraft: readManualCharacterDraft,
    writeDraft: writeManualCharacterDraft
  });

  function restoreCharacterDraft() {
    if (!restorePersistedCharacterDraft()) return false;
    if (manualDraftSession) selectAiSession(manualDraftSession);
    return true;
  }

  async function discardCharacterDraft() {
    if (saving.value || loading.value || loadError.value) return false;
    const discard = discardPersistedCharacterDraft();
    saving.value = true;
    try {
      if (!await discard) return false;
      cancelCharacterImageUploads();
      clearAssistantEditorHandoff();
      assistantHandoffPending = false;
      if (!isAssistantPage.value) restoreAssistantRuntime(manualDraftSession);
      nameError.value = '';
      return true;
    } finally { if (!characterFormDisposed) saving.value = false; }
  }

  const {
    clearWorldBookSearch,
    closeWorldBookDialog,
    filteredWorldBooks,
    hiddenSelectedWorldBookCount,
    openWorldBookDialog,
    pagedWorldBooks,
    selectedWorldBookPreview,
    setWorldBookPage,
    showWorldBookDialog,
    worldBookPage,
    worldBookPageCount,
    worldBookPageEnd,
    worldBookPageStart,
    worldBookSearch,
    worldBookSort
  } = useCharacterWorldBookDialog({ worldBooks, selectedWorldBookIds });

  const characterFooterActionBusy = computed(() => saving.value || deleting.value || exporting.value);
  const userVariableValue = computed(() => (
    props.user?.displayName || props.user?.accountName || props.user?.username || '用户'
  ));
  const permissionText = computed(() => {
    if (!isEditing.value) {
      return '你将成为这个角色的拥有者';
    }
    return form.canEdit ? '你是角色拥有者，可编辑全部设置' : '你是角色使用者，只能查看和发起对话';
  });
  const completionItems = computed(() => [
    { key: 'name', label: '名称', complete: hasText(form.name) },
    { key: 'avatar', label: '头像', complete: hasText(form.avatarUrl) },
    { key: 'background', label: '背景', complete: hasText(form.background) },
    { key: 'worldview', label: '世界观', complete: hasText(form.worldview) },
    { key: 'persona', label: '人设', complete: hasText(form.persona) },
    { key: 'opening', label: '开场白', complete: hasText(form.openingMessage) }
  ]);
  const completedCount = computed(() => {
    let completed = 0;
    for (const item of completionItems.value) {
      if (item.complete) {
        completed += 1;
      }
    }
    return completed;
  });

  watch(
    () => ({
      payload: toPayload(),
      selectedWorldBookIds: [...selectedWorldBookIds.value]
    }),
    () => {
      scheduleCharacterDraftSave();
    },
    { deep: true }
  );

  onMounted(async () => {
    clearLegacyCharacterDraftStorage();
    window.addEventListener('beforeunload', handleCharacterBeforeUnload);
    startCharacterDraftInterval();
    const optionsLoad = loadFormOptions();
    if (isEditing.value) {
      await Promise.all([optionsLoad, loadEditingCharacter()]);
      return;
    }
    await Promise.all([optionsLoad, loadNewCharacterDraft()]);
  });

  onBeforeUnmount(() => {
    // Vite replaces this component during HMR. Keep an active assistant
    // request alive so a source update does not look like a user cancellation.
    const preserveAssistantStream = Boolean(import.meta.hot && isAssistantPage.value && aiLoading.value);
    window.removeEventListener('beforeunload', handleCharacterBeforeUnload);
    flushCharacterDraftBeforeDispose();
    characterFormDisposed = true;
    cancelCharacterFormOptions();
    editingCharacterLoadToken += 1;
    formSubmitToken += 1;
    characterDeleteToken += 1;
    characterExportToken += 1;
    showWorldBookDialog.value = false;
    cancelCharacterImageUploads();
    if (!preserveAssistantStream) cancelCharacterAiGeneration();
  });

  onBeforeRouteLeave(async () => {
    if (assistantHandoffPending) return true;
    if (!hasUnsavedChanges.value || characterFormDisposed) {
      return true;
    }
    if (!window.confirm('角色还有未保存的更改，确定离开吗？')) return false;
    if (!isAssistantPage.value && !await saveCharacterDraftNow()) {
      notify.error('服务器草稿保存失败，已保留当前输入，请重试后离开');
      return false;
    }
    return true;
  });

  function hasText(value) {
    return Boolean(String(value || '').trim());
  }

  function hasEnabledAccessorySkill() {
    for (const item of ACCESSORY_SKILL_ITEMS) {
      if (form.authorAdvancedSettings.accessorySkills?.[item.key]?.enabled) {
        return true;
      }
    }
    return false;
  }

  function handleCharacterBeforeUnload(event) {
    if (!hasUnsavedChanges.value) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  async function loadEditingCharacter() {
    if (characterFormDisposed) {
      return;
    }
    if (!isEditing.value) {
      await loadNewCharacterDraft();
      return;
    }

    const characterId = editingCharacterId.value;
    const loadToken = ++editingCharacterLoadToken;
    manualDraftScope += 1;
    manualDraftSession = null;
    loading.value = true;
    loadError.value = '';
    try {
      const [character, linkedBooks] = await Promise.all([
        fetchCharacter(characterId),
        fetchCharacterWorldBooks(characterId)
      ]);
      if (!isCurrentEditingCharacterLoad(loadToken, characterId)) return;
      acceptSyncedCharacter(character);
      Object.assign(form, normalizeForForm(character));
      savedAvatarUrl.value = form.avatarUrl;
      setSelectedWorldBookIdsFromBooksIfChanged(linkedBooks);
      savedWorldBookIds.value = normalizeWorldBookIds((linkedBooks || []).map((book) => book?.id));
      await initializeCharacterDraftState();
      if (!isCurrentEditingCharacterLoad(loadToken, characterId)) return;
      await restoreAssistantEditorHandoff();
    } catch (err) {
      if (!isCurrentEditingCharacterLoad(loadToken, characterId)) return;
      const message = err?.message || '加载角色失败';
      loadError.value = message;
      notify.error(message);
    } finally {
      if (isCurrentEditingCharacterLoad(loadToken, characterId)) {
        loading.value = false;
      }
    }
  }

  async function loadNewCharacterDraft() {
    if (characterFormDisposed || isEditing.value) return;
    const loadToken = ++editingCharacterLoadToken;
    manualDraftScope += 1;
    manualDraftSession = null;
    loading.value = true;
    loadError.value = '';
    try {
      await initializeCharacterDraftState();
      if (isCurrentEditingCharacterLoad(loadToken, '')) await restoreAssistantEditorHandoff();
    } catch (error) {
      if (isCurrentEditingCharacterLoad(loadToken, '')) {
        loadError.value = error?.message || '读取服务器草稿失败，请重新加载';
        notify.error(loadError.value);
      }
    } finally {
      if (isCurrentEditingCharacterLoad(loadToken, '')) loading.value = false;
    }
  }

  function isCurrentEditingCharacterLoad(loadToken, characterId) {
    return !characterFormDisposed
      && loadToken === editingCharacterLoadToken
      && characterId === editingCharacterId.value;
  }

  function acceptSyncedCharacter(character) {
    if (characterFormDisposed || !character || typeof character !== 'object') return false;
    if (isEditing.value && String(character.id || '') !== editingCharacterId.value) return false;
    // The persisted card must never share objects with an assistant draft.
    savedCharacter.value = JSON.parse(JSON.stringify(character));
    return true;
  }

  function replaceAssistantDraftFromSavedCharacter(character, session) {
    if (characterFormDisposed || !isAssistantPage.value || !isEditing.value || !canEdit.value || loading.value
      || characterFooterActionBusy.value || aiLoading.value || advancedAiLoading.value || aiWorldBookCreating.value) return false;
    const characterId = editingCharacterId.value;
    if (!character || typeof character !== 'object' || Array.isArray(character) || character.canEdit === false
      || String(character.id || '') !== characterId
      || !session?.id || String(session.id) !== aiSessionId.value || String(session.characterId || '') !== characterId
      || !Array.isArray(session.state?.selectedWorldBookIds)) return false;
    const authoritativeCharacter = JSON.parse(JSON.stringify(character));
    const restoredSession = JSON.parse(JSON.stringify(session));
    const worldBookIds = normalizeWorldBookIds(restoredSession.state.selectedWorldBookIds);
    cancelCharacterImageUploads();
    Object.assign(form, normalizeForForm(authoritativeCharacter));
    savedAvatarUrl.value = form.avatarUrl;
    savedWorldBookIds.value = worldBookIds;
    setSelectedWorldBookIdsIfChanged(worldBookIds);
    restoreAssistantRuntime(restoredSession);
    advancedAiRequirement.value = '';
    acceptSyncedCharacter(authoritativeCharacter);
    nameError.value = '';
    establishCharacterDraftBaseline();
    clearCurrentCharacterDraft();
    return true;
  }

  async function submit() {
    if (characterFormDisposed || characterFooterActionBusy.value || !canEdit.value
      || loading.value || loadError.value
      || ((isAssistantPage.value || aiSessionId.value) && (aiLoading.value || advancedAiLoading.value || aiWorldBookCreating.value))) {
      return;
    }
    if (!validateCharacterName({ focus: true })) {
      return;
    }
    if (!isAssistantPage.value && pendingCharacterDraft.value) {
      notify.warning('请先恢复或丢弃服务器草稿，再保存角色');
      return;
    }
    const submitToken = ++formSubmitToken;
    const editing = isEditing.value;
    const characterId = editingCharacterId.value;
    saving.value = true;
    try {
      if (!isAssistantPage.value && !await saveCharacterDraftNow()) {
        notify.error('服务器草稿保存失败，当前输入仍保留，请重试');
        return;
      }
      if ((isAssistantPage.value || aiSessionId.value) && aiWorldBookChanges.value.length && !await commitAiWorldBookChanges()) return;
      if (!isCurrentFormSubmit(submitToken, { editing, characterId })) return;
      // New books receive their saved IDs during the explicit commit above.
      const worldBookIds = [...selectedWorldBookIds.value];
      const payload = toPayload();
      const saved = editing || createdAssistantCharacterId
        ? await updateCharacter(characterId || createdAssistantCharacterId, payload)
        : await createCharacter({ ...payload, ...(aiSessionId.value ? { assistantSessionId: aiSessionId.value } : {}) });
      if (!isCurrentFormSubmit(submitToken, { editing, characterId })) return;
      acceptSyncedCharacter(saved);
      const canonicalAvatarUrl = String(saved.avatarUrl ?? payload.avatarUrl ?? '');
      savedAvatarUrl.value = canonicalAvatarUrl;
      if (form.avatarUrl === payload.avatarUrl) form.avatarUrl = canonicalAvatarUrl;
      if (!editing && aiSessionId.value) createdAssistantCharacterId = saved.id;
      if (aiSessionId.value) {
        try {
          const updatedSession = await updateAssistantSession(aiSessionId.value, {
            characterId: saved.id,
            title: `${form.name || '角色'} · 完善角色`,
            character: { ...payload, avatarUrl: canonicalAvatarUrl },
            statePatch: {
              avatarDraft: null,
              selectedWorldBookIds: worldBookIds,
              worldBookLinkDraft: currentWorldBookLinkDraft()
            }
          });
          if (!isAssistantPage.value) manualDraftSession = updatedSession;
          rememberAssistantSession(saved.id, aiSessionId.value);
        } catch (error) {
          notify.warning(`角色已保存，但助手会话绑定失败：${error.message}。请在当前页面重试保存。`);
          // Stay in the current editor after a partial save so its session is recoverable.
          if (!editing) rememberAssistantSession('new', aiSessionId.value);
          return;
        }
      }
      await syncCharacterWorldBooks(saved.id, { editing, selectedIds: worldBookIds });
      if (!isCurrentFormSubmit(submitToken, { editing, characterId })) return;
      savedWorldBookIds.value = normalizeWorldBookIds(worldBookIds);
      if (!editing && !isAssistantPage.value) {
        cancelCharacterAiGeneration();
      }
      establishCharacterDraftBaseline();
      clearCurrentCharacterDraft();
      clearAssistantEditorHandoff();
      notify.success(editing ? '角色已保存' : '角色已创建');
      if (isAssistantPage.value) {
        navigateFromCharacterSubmit('characterAssistant', { id: saved.id });
      } else if (editing) {
        emit('navigate', 'characterEdit', { id: saved.id });
      } else {
        navigateFromCharacterSubmit('characterEdit', { id: saved.id });
      }
    } catch (err) {
      if (!isCurrentFormSubmit(submitToken, { editing, characterId })) return;
      notify.error(err.message);
    } finally {
      if (isActiveFormSubmit(submitToken)) {
        saving.value = false;
      }
    }
  }

  async function syncCharacterWorldBooks(characterId, { editing = isEditing.value, selectedIds = selectedWorldBookIds.value } = {}) {
    if (!characterId) {
      return;
    }

    const targetIds = Array.isArray(selectedIds) ? selectedIds : [];
    const currentLinked = editing
      ? await fetchCharacterWorldBooks(characterId)
      : [];
    const currentIds = [];
    for (const book of currentLinked) {
      currentIds.push(book?.id);
    }
    const currentIdSet = new Set(currentIds);
    const targetIdSet = new Set();
    for (const id of targetIds) {
      targetIdSet.add(id);
    }

    for (const bookId of targetIds) {
      if (!currentIdSet.has(bookId)) {
        await linkCharacterWorldBook(characterId, bookId);
      }
    }
    for (const bookId of currentIds) {
      if (!targetIdSet.has(bookId)) {
        await unlinkCharacterWorldBook(characterId, bookId);
      }
    }
  }

  function isCurrentFormSubmit(submitToken, { editing, characterId } = {}) {
    return isActiveFormSubmit(submitToken)
      && editing === isEditing.value
      && (!editing || characterId === editingCharacterId.value);
  }

  function isActiveFormSubmit(submitToken) {
    return !characterFormDisposed && submitToken === formSubmitToken;
  }

  function navigateFromCharacterSubmit(page, params) {
    // Navigation may keep this editor mounted, so finish before retiring its token.
    saving.value = false;
    formSubmitToken += 1;
    emit('navigate', page, params);
  }

  async function removeCharacter() {
    if (characterFormDisposed || characterFooterActionBusy.value || !isEditing.value || !canEdit.value) {
      return;
    }
    const characterId = editingCharacterId.value;
    if (!window.confirm('确定删除这个角色和相关对话吗？')) {
      return;
    }

    const deleteToken = ++characterDeleteToken;
    deleting.value = true;
    try {
      await deleteCharacter(characterId);
      if (!isCurrentCharacterDelete(deleteToken, characterId)) return;
      clearCurrentCharacterDraft();
      notify.success('角色已删除');
      navigateFromCharacterDelete('home');
    } catch (err) {
      if (!isCurrentCharacterDelete(deleteToken, characterId)) return;
      notify.error(err.message);
    } finally {
      if (isActiveCharacterDelete(deleteToken)) {
        deleting.value = false;
      }
    }
  }

  function isCurrentCharacterDelete(deleteToken, characterId) {
    return isActiveCharacterDelete(deleteToken)
      && isEditing.value
      && characterId === editingCharacterId.value;
  }

  function isActiveCharacterDelete(deleteToken) {
    return !characterFormDisposed && deleteToken === characterDeleteToken;
  }

  function navigateFromCharacterDelete(page, params) {
    characterDeleteToken += 1;
    emit('navigate', page, params);
  }

  function insertUserVariable(field) {
    if (!canEdit.value || typeof form[field] !== 'string') {
      return;
    }
    form[field] = form[field] ? `${form[field]}{user}` : '{user}';
  }

  function toPayload() {
    return {
      name: form.name,
      avatarUrl: form.avatarUrl,
      gender: form.gender,
      age: form.age,
      background: form.background,
      worldview: form.worldview,
      persona: form.persona,
      openingMessage: form.openingMessage,
      visibility: form.visibility,
      authorAdvancedSettings: {
        desktopBackgroundUrl: form.authorAdvancedSettings.desktopBackgroundUrl,
        mobileBackgroundUrl: form.authorAdvancedSettings.mobileBackgroundUrl,
        customCss: form.authorAdvancedSettings.customCss,
        customCssEnabled: form.authorAdvancedSettings.customCssEnabled,
        customCssRiskAccepted: form.authorAdvancedSettings.customCssRiskAccepted,
        customJs: form.authorAdvancedSettings.customJs,
        customJsEnabled: form.authorAdvancedSettings.customJsEnabled,
        customJsRiskAccepted: form.authorAdvancedSettings.customJsRiskAccepted,
        showWorldBookMatches: form.authorAdvancedSettings.showWorldBookMatches,
        highlightDialogue: form.authorAdvancedSettings.highlightDialogue,
        statusBarPrompt: form.authorAdvancedSettings.statusBarPrompt,
        statusBarBlueprint: normalizeStatusBarBlueprintForPayload(form.authorAdvancedSettings.statusBarBlueprint),
        accessorySkills: normalizeAccessorySkillsForPayload(form.authorAdvancedSettings.accessorySkills)
      },
      renderPlugins: form.renderPlugins,
      regexRules: form.regexRules,
      worldBookId: form.worldBookId || '',
      tags: form.selectedTags.length ? form.selectedTags : parseTagsTextForPayload(form.tagsText)
    };
  }

  function applyCharacterDraftPayload(payload = {}) {
    const normalized = normalizeCharacterDraftPayload(payload);
    form.name = normalized.name;
    form.avatarUrl = normalized.avatarUrl;
    form.gender = normalized.gender;
    form.age = normalized.age;
    form.background = normalized.background;
    form.worldview = normalized.worldview;
    form.persona = normalized.persona;
    form.openingMessage = normalized.openingMessage;
    form.visibility = normalized.visibility;
    form.authorAdvancedSettings = normalized.authorAdvancedSettings;
    form.renderPlugins = normalized.renderPlugins;
    form.regexRules = normalized.regexRules;
    form.worldBookId = normalized.worldBookId;
    form.tagsText = normalized.tags.join(', ');
    form.selectedTags = [...normalized.tags];
  }

  function updateCharacterFormField(key, value) {
    if (Object.prototype.hasOwnProperty.call(form, key)) {
      form[key] = value;
    }
    if (key === 'name' && hasText(value)) {
      nameError.value = '';
    }
  }

  function validateCharacterName({ focus = false } = {}) {
    if (hasText(form.name)) {
      nameError.value = '';
      return true;
    }
    nameError.value = '请输入角色名';
    if (focus) {
      focusCharacterNameField();
    }
    return false;
  }

  async function focusCharacterNameField() {
    if (isCharacterCreationWizardActive.value) {
      setCharacterWizardStep('basic');
    }
    setActiveSection('basic');
    await nextTick();
    document.getElementById('character-name')?.focus();
  }

  function applyAdvancedSettingsDraft(input = {}, { applyEmptyValues = true } = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const normalized = normalizeAdvancedSettingsForForm(source);
    for (const key of ['desktopBackgroundUrl', 'mobileBackgroundUrl', 'customCss', 'customCssEnabled', 'customJs', 'customJsEnabled', 'statusBarPrompt']) {
      if (applyEmptyValues || hasText(normalized[key])) {
        form.authorAdvancedSettings[key] = normalized[key];
      }
    }
    for (const key of ['customCssRiskAccepted', 'customJsRiskAccepted']) {
      if (Object.prototype.hasOwnProperty.call(source, key) || Object.prototype.hasOwnProperty.call(source, snakeCaseRiskKey(key))) {
        form.authorAdvancedSettings[key] = normalized[key];
      }
    }
    if (applyEmptyValues || hasStatusBarBlueprintContent(normalized.statusBarBlueprint)) {
      form.authorAdvancedSettings.statusBarBlueprint = normalized.statusBarBlueprint;
    }
    if (applyEmptyValues || hasNonDefaultAccessorySkills(normalized.accessorySkills)) {
      form.authorAdvancedSettings.accessorySkills = normalized.accessorySkills;
    }
  }

  function snakeCaseRiskKey(key) {
    return key === 'customCssRiskAccepted' ? 'custom_css_risk_accepted' : 'custom_js_risk_accepted';
  }

  async function handleExport() {
    if (characterFormDisposed || characterFooterActionBusy.value || !isEditing.value) {
      return;
    }

    const exportToken = ++characterExportToken;
    const characterId = editingCharacterId.value;
    exporting.value = true;
    try {
      const envelope = await exportEnvelope('characters', { ids: [characterId] });
      if (!isCurrentCharacterExport(exportToken, characterId)) return;
      if (!Array.isArray(envelope?.items) || envelope.items.length !== 1) {
        throw new Error('角色不存在或无法导出');
      }
      downloadJsonFile(envelope, characterEnvelopeFileName(envelope.items[0]));
      notify.success('角色卡已导出');
    } catch (err) {
      if (!isCurrentCharacterExport(exportToken, characterId)) return;
      notify.error(err.message);
    } finally {
      if (isActiveCharacterExport(exportToken)) {
        exporting.value = false;
      }
    }
  }

  function isCurrentCharacterExport(exportToken, characterId) {
    return isActiveCharacterExport(exportToken)
      && isEditing.value
      && characterId === editingCharacterId.value;
  }

  function isActiveCharacterExport(exportToken) {
    return !characterFormDisposed && exportToken === characterExportToken;
  }

  function characterEnvelopeFileName(item = {}) {
    const name = String(item.name || form.name || 'character')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .slice(0, 80) || 'character';
    return `flai-character-${name}-${todayStamp()}.json`;
  }

  function modelOverrideOptions(value = '') {
    return providerModelOptionsFor(value, '使用当前模型');
  }

  function navigateHome() {
    emit('navigate', 'home');
  }

  function rememberAssistantSession(characterId, sessionId) {
    try {
      sessionStorage.setItem(`flai-character-assistant-active:${props.user?.id || 'anonymous'}:${characterId || 'new'}`, sessionId);
    } catch {
      // Server sessions remain available when browser storage is disabled.
    }
  }

  function assistantEditorHandoffKey() {
    return `flai-character-editor-handoff:${props.user?.id || 'anonymous'}:${editingCharacterId.value || 'new'}`;
  }

  function readAssistantHandoffId() {
    try {
      const raw = sessionStorage.getItem(assistantEditorHandoffKey()) || '';
      if (!raw.startsWith('{')) return raw;
      return String(JSON.parse(raw)?.sessionId || '');
    } catch { return ''; }
  }

  function clearLegacyCharacterDraftStorage() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('flai-character-form-draft:') || key.startsWith('flai-character-ai-session:')) localStorage.removeItem(key);
      }
    } catch (error) { recordFrontendDiagnostic('characterDraft.legacy.clear', error); }
  }

  function matchesManualDraftSession(session, characterId = editingCharacterId.value) {
    return Boolean(session?.id && String(session.characterId || '') === characterId
      && session.character && typeof session.character === 'object' && !Array.isArray(session.character));
  }

  async function readManualCharacterDraft() {
    const scope = manualDraftScope;
    const characterId = editingCharacterId.value;
    const handoffId = readAssistantHandoffId();
    let session = null;
    if (handoffId) {
      try {
        session = await fetchAssistantSession(handoffId);
      } catch (error) {
        if (error?.status !== 404) throw error;
        recordFrontendDiagnostic('characterDraft.handoff.stale', error);
        session = null;
      }
      if (session && !matchesManualDraftSession(session, characterId)) {
        throw new Error('服务器草稿与当前角色不匹配，请重新加载');
      }
      if (!session) clearAssistantEditorHandoff();
    }
    if (!session) {
      let activeId = '';
      try {
        activeId = sessionStorage.getItem(`flai-character-assistant-active:${props.user?.id || 'anonymous'}:${characterId || 'new'}`) || '';
      } catch (error) {
        recordFrontendDiagnostic('characterDraft.activeSession.read', error);
      }
      const sessions = await fetchAssistantSessions({ characterId });
      session = sessions.find((item) => item.id === activeId) || sessions[0] || null;
    }
    if (!session) return null;
    if (characterFormDisposed || scope !== manualDraftScope || characterId !== editingCharacterId.value) return null;
    if (!matchesManualDraftSession(session, characterId)) throw new Error('服务器草稿与当前角色不匹配，请重新加载');
    if (session.state?.status === 'running') throw new Error('助手正在处理此会话，请完成后重新加载');
    manualDraftSession = JSON.parse(JSON.stringify(session));
    rememberAssistantSession(characterId, session.id);
    return {
      payload: normalizeCharacterDraftPayload(session.character),
      selectedWorldBookIds: getAssistantWorldBookSelection(session.state) || [...selectedWorldBookIds.value],
      updatedAt: session.updatedAt || ''
    };
  }

  async function writeManualCharacterDraft(snapshot, { reset = false } = {}) {
    const scope = manualDraftScope;
    const characterId = editingCharacterId.value || createdAssistantCharacterId;
    const current = manualDraftSession || (aiSessionId.value ? await fetchAssistantSession(aiSessionId.value) : null);
    if (current && !matchesManualDraftSession(current, characterId)) throw new Error('服务器草稿与当前角色不匹配，请重新加载');
    let session;
    if (reset && current && characterId) {
      const result = await resetCharacterAssistantDraftFromSavedCharacter(current.id);
      if (!matchesManualDraftSession(result?.session, characterId) || result.character?.id !== characterId) {
        throw new Error('服务器草稿与当前角色不匹配，请重新加载');
      }
      session = result.session;
      if (!characterFormDisposed && scope === manualDraftScope && characterId === (editingCharacterId.value || createdAssistantCharacterId)) {
        acceptSyncedCharacter(result.character);
        savedAvatarUrl.value = String(result.character.avatarUrl || '');
        savedWorldBookIds.value = normalizeWorldBookIds(session.state?.selectedWorldBookIds);
      }
      snapshot = { payload: normalizeCharacterDraftPayload(session.character), selectedWorldBookIds: session.state.selectedWorldBookIds };
    } else {
      const state = reset
        ? Object.fromEntries(Object.entries(current?.state || {}).filter(([key]) => ['version', 'options', 'providerProfileId', 'modelOverride'].includes(key)))
        : aiSessionId.value && aiSessionId.value === current?.id ? exportAiSessionState() : current?.state || {};
      const nextState = { ...state, avatarDraft: reset ? null : currentAvatarDraft(), worldBookLinkDraft: reset ? null : currentWorldBookLinkDraft(), selectedWorldBookIds: snapshot.selectedWorldBookIds };
      const statePatch = Object.fromEntries(Object.entries(nextState).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(current?.state?.[key])));
      const payload = {
        character: snapshot.payload,
        ...(characterId ? { characterId } : {}),
        ...(reset || !current ? { state: nextState } : { statePatch })
      };
      session = current ? await updateAssistantSession(current.id, payload) : await createAssistantSession({ title: '角色编辑草稿', ...payload });
    }
    if (!matchesManualDraftSession(session, characterId)) throw new Error('保存服务器草稿失败，请重试');
    if (scope === manualDraftScope && characterId === (editingCharacterId.value || createdAssistantCharacterId)) {
      manualDraftSession = JSON.parse(JSON.stringify(session));
      rememberAssistantSession(characterId, session.id);
      if (!aiSessionId.value) aiSessionId.value = String(session.id);
    }
    return { updatedAt: session.updatedAt, ...(reset ? { snapshot } : {}) };
  }

  function prepareAssistantEditorHandoff() {
    try { sessionStorage.setItem(assistantEditorHandoffKey(), aiSessionId.value); } catch (error) {
      recordFrontendDiagnostic('characterAssistant.handoff.save', error);
    }
    assistantHandoffPending = true;
  }

  function clearAssistantEditorHandoff() {
    try { sessionStorage.removeItem(assistantEditorHandoffKey()); } catch (error) {
      recordFrontendDiagnostic('characterAssistant.handoff.clear', error);
    }
  }

  async function restoreAssistantEditorHandoff() {
    if (isAssistantPage.value) return;
    if (!manualDraftSession) return;
    if (readAssistantHandoffId() === manualDraftSession.id) {
      restoreCharacterDraft();
      selectAiSession(manualDraftSession);
      clearAssistantEditorHandoff();
    } else if (!pendingCharacterDraft.value) selectAiSession(manualDraftSession);
    else if (!isEditing.value && !manualDraftSession.characterId) restoreCharacterDraft();
  }

  function selectAiSession(session, { restoreVersion = false } = {}) {
    restoreAssistantRuntime(session);
    const selectedIds = getAssistantWorldBookSelection(session?.state, { restoreVersion });
    if (selectedIds) {
      setSelectedWorldBookIdsIfChanged(selectedIds);
    }
    const pending = pendingCharacterDraft.value;
    if (pending
      && JSON.stringify(normalizeCharacterDraftPayload(pending.payload)) === JSON.stringify(normalizeCharacterDraftPayload(toPayload()))
      && JSON.stringify(normalizeWorldBookIds(pending.selectedWorldBookIds).sort()) === JSON.stringify([...selectedWorldBookIds.value].sort())) {
      pendingCharacterDraft.value = null;
      scheduleCharacterDraftSave();
    }
  }

  function currentAvatarDraft() {
    const avatarUrl = String(form.avatarUrl || '');
    return avatarUrl === savedAvatarUrl.value
      ? null
      : { version: 1, baselineUrl: savedAvatarUrl.value };
  }

  function exportAiSessionState() {
    return {
      ...exportAssistantRuntimeState(),
      avatarDraft: currentAvatarDraft(),
      worldBookLinkDraft: currentWorldBookLinkDraft()
    };
  }

  function currentWorldBookLinkDraft() {
    return sameWorldBookIdSet(selectedWorldBookIds.value, savedWorldBookIds.value)
      ? null
      : { version: 1, baselineIds: normalizeWorldBookIds(savedWorldBookIds.value) };
  }

  function getAssistantWorldBookSelection(state, { restoreVersion = false } = {}) {
    if (!Array.isArray(state?.selectedWorldBookIds)) return null;
    const sessionIds = normalizeWorldBookIds(state.selectedWorldBookIds);
    if (restoreVersion || !isEditing.value) return sessionIds;

    const currentDraft = currentWorldBookLinkDraft();
    if (currentDraft) return normalizeWorldBookIds(selectedWorldBookIds.value);

    const marker = state.worldBookLinkDraft;
    if (marker?.version === 1 && Array.isArray(marker.baselineIds)) {
      return rebaseWorldBookSelection(savedWorldBookIds.value, marker.baselineIds, sessionIds);
    }
    // Old snapshots cannot express removal of links saved since that session.
    // Retain pending additions while protecting the current saved links.
    return mergeWorldBookIds(savedWorldBookIds.value, sessionIds);
  }

  function sameWorldBookIdSet(first, second) {
    const firstIds = new Set(normalizeWorldBookIds(first));
    const secondIds = new Set(normalizeWorldBookIds(second));
    if (firstIds.size !== secondIds.size) return false;
    for (const id of firstIds) {
      if (!secondIds.has(id)) return false;
    }
    return true;
  }

  function mergeWorldBookIds(first, second) {
    return [...new Set([...normalizeWorldBookIds(first), ...normalizeWorldBookIds(second)])];
  }

  function rebaseWorldBookSelection(currentIds, baselineIds, selectedIds) {
    const baseline = new Set(normalizeWorldBookIds(baselineIds));
    const selected = new Set(normalizeWorldBookIds(selectedIds));
    const rebased = normalizeWorldBookIds(currentIds).filter((id) => !baseline.has(id) || selected.has(id));
    for (const id of selected) {
      if (!baseline.has(id) && !rebased.includes(id)) rebased.push(id);
    }
    return rebased;
  }

  function applyAssistantCharacter(character, { avatarDraft, restoreVersion = false } = {}) {
    if (!canEdit.value || !character || typeof character !== 'object') return;
    // Conversation snapshots may predate a manual avatar change or store an old
    // empty value. Only an explicit draft against the saved avatar may replace it.
    let avatarUrl = form.avatarUrl;
    if (restoreVersion || !isEditing.value) {
      avatarUrl = character.avatarUrl ?? avatarUrl;
    } else if (!currentAvatarDraft()
      && avatarDraft?.version === 1
      && avatarDraft.baselineUrl === savedAvatarUrl.value
      && typeof character.avatarUrl === 'string') {
      avatarUrl = character.avatarUrl;
    }
    applyCharacterDraftPayload({ ...character, avatarUrl });
  }

  async function openAssistant() {
    if (characterAiActionBusy.value || loading.value || loadError.value || !canEdit.value || assistantHandoffPending) return;
    assistantHandoffPending = true;
    saving.value = true;
    try {
      clearLegacyCharacterDraftStorage();
      if (!pendingCharacterDraft.value && !await saveCharacterDraftNow()) throw new Error('服务器草稿保存失败，当前输入仍保留，请重试');
      const existing = isEditing.value ? await fetchAssistantSessions({ characterId: editingCharacterId.value }) : [];
      const sessions = Array.isArray(existing) ? existing : existing.sessions || [];
      let activeId = '';
      try {
        activeId = sessionStorage.getItem(`flai-character-assistant-active:${props.user?.id || 'anonymous'}:${editingCharacterId.value}`) || '';
      } catch (error) {
        recordFrontendDiagnostic('characterAssistant.active.read', error);
      }
      const target = sessions.find((session) => session.id === activeId) || sessions[0];
      const targetId = target?.id || (!isEditing.value ? aiSessionId.value : '');
      const current = targetId ? await fetchAssistantSession(targetId) : null;
      const preserveSessionDraft = Boolean(current) && !hasUnsavedChanges.value;
      const selectedIds = preserveSessionDraft
        ? (getAssistantWorldBookSelection(current.state) || normalizeWorldBookIds(selectedWorldBookIds.value))
        : normalizeWorldBookIds(selectedWorldBookIds.value);
      const statePatch = {
        avatarDraft: currentAvatarDraft(),
        selectedWorldBookIds: selectedIds,
        worldBookLinkDraft: sameWorldBookIdSet(selectedIds, savedWorldBookIds.value)
          ? null
          : { version: 1, baselineIds: normalizeWorldBookIds(savedWorldBookIds.value) }
      };
      const payload = {
        ...(editingCharacterId.value ? { characterId: editingCharacterId.value } : {}),
        title: current?.title || (form.name ? `${form.name} · 完善角色` : '新角色创作'),
        // The server already owns the generated draft and execution history.
        // Reopening a session must not upload another copy of that large JSON.
        ...(preserveSessionDraft
          ? { characterPatch: { avatarUrl: form.avatarUrl } }
          : { character: toPayload() }),
        ...(current
          ? { statePatch }
          : { state: { ...exportAiSessionState(), ...statePatch } })
      };
      const session = current
        ? await updateAssistantSession(current.id, payload)
        : await createAssistantSession(payload);
      rememberAssistantSession(editingCharacterId.value, session.id);
      clearAssistantEditorHandoff();
      emit('navigate', isEditing.value ? 'characterAssistant' : 'characterAssistantNew', isEditing.value ? { id: editingCharacterId.value } : {});
    } catch (error) {
      assistantHandoffPending = false;
      notify.error(error.message || '无法打开 AI 完善助手');
    } finally { if (!characterFormDisposed) saving.value = false; }
  }

  return {
    isAssistantPage,
    aiSessionId,
    aiConversationHistory,
    aiContext,
    selectAiSession,
    exportAiSessionState,
    applyAssistantCharacter,
    acceptSyncedCharacter,
    replaceAssistantDraftFromSavedCharacter,
    openAssistant,
    toPayload,
    prepareAssistantEditorHandoff,
    // identity & lifecycle
    accessorySkillItems: ACCESSORY_SKILL_ITEMS,
    canEdit,
    deleting,
    editingCharacterId,
    exporting,
    form,
    isEditing,
    loadEditingCharacter,
    loadError,
    loading,
    permissionText,
    saving,
    savedCharacter,
    // sections
    activeSection,
    activeSectionDefinition,
    goToNextSection,
    goToPreviousSection,
    hasNextSection,
    hasPreviousSection,
    sectionGroups,
    sectionStatus,
    setActiveSection,
    visibleSections,
    // wizard
    CHARACTER_CREATION_WIZARD_STEPS,
    characterWizardProgressText,
    characterWizardStepId,
    characterWizardStepIndex,
    currentCharacterWizardStep,
    goToNextCharacterWizardStep,
    goToPreviousCharacterWizardStep,
    isCharacterCreationFullForm,
    isCharacterCreationWizardActive,
    isCharacterCreationWizardAvailable,
    setCharacterCreationMode,
    setCharacterWizardStep,
    // summary
    completedCount,
    completionItems,
    // draft
    canDiscardCharacterDraft,
    characterDraftStatus,
    characterDraftStatusText,
    discardCharacterDraft,
    hasUnsavedChanges,
    pendingCharacterDraft,
    restoreCharacterDraft,
    // form options
    canCreateSearchedTag,
    createAndSelectTag,
    filteredTags,
    loadFormOptions,
    optionsLoadError,
    optionsLoading,
    selectedWorldBookIds,
    tagCreating,
    tagSearch,
    toggleTagSelection,
    toggleWorldBook,
    worldBooks,
    // world book dialog
    clearWorldBookSearch,
    closeWorldBookDialog,
    filteredWorldBooks,
    hiddenSelectedWorldBookCount,
    openWorldBookDialog,
    pagedWorldBooks,
    selectedWorldBookPreview,
    setWorldBookPage,
    showWorldBookDialog,
    worldBookPage,
    worldBookPageCount,
    worldBookPageEnd,
    worldBookPageStart,
    worldBookSearch,
    worldBookSort,
    // images
    backgroundUploading,
    clearAdvancedBackground,
    clearAvatar,
    handleAdvancedBackground,
    handleAvatar,
    // ai
    advancedAiLoading,
    advancedAiRequirement,
    aiLoading,
    aiCheckpoint,
    aiCheckpointUpdatedAt,
    aiHasCheckpoint,
    aiLastError,
    aiModSuggestions,
    aiWorldBookChanges,
    aiWorldBookSelectedIds,
    aiWorldBookAutomatic,
    aiWorldBookSourceLabel,
    aiWorldBookCreating,
    aiOptions,
    aiProcess,
    aiReasoning,
    aiRequirement,
    aiAttachments,
    aiStatus,
    aiStatusMessage,
    aiFinalContent,
    aiToolCalls,
    aiWarnings,
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    assistantProviderProfileId,
    assistantProviderProfiles,
    assistantProviderSettings,
    assistantModelsLoading,
    assistantModelsError,
    loadAssistantProviderProfiles,
    refreshAssistantModels,
    selectAssistantProviderProfile,
    assistantPlanMode,
    assistantStreamingEnabled,
    assistantThinkingLevel,
    assistantThinkingOptions,
    assistantThinkingSupported,
    characterAiActionBusy,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    applyAiWorldBookChanges,
    setAiWorldBookAddToCharacter,
    reloadAiWorldBook,
    discardAiWorldBookChange,
    setAiWorldBookSelectedIds,
    setAiWorldBookAutomatic,
    requestAiNewWorldBook,
    discardAiSession,
    discardCharacterPlan,
    executeApprovedPlan,
    modelOverrideOptions,
    replanCharacterAi,
    resumeCharacterAi,
    retryCharacterAi,
    saveAiCheckpoint,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi,
    suggestedModsCreating,
    aiPlan,
    aiPlanExtraRequirement,
    aiPlanPhase,
    aiPlanStepStatus,
    toggleAiPlanStep,
    updateAiPlanStep,
    // status blueprint
    addStatusBlueprintVariable,
    applyStatusBlueprintSampleTemplate,
    clearStatusBlueprintTemplate,
    refreshStatusBlueprintVariables,
    removeStatusBlueprintVariable,
    setColorValueFromEvent,
    setStatusBlueprintVariableModeFromEvent,
    setStatusBlueprintVariableValueFromEvent,
    showStatusPreviewDialog,
    statusBarBlueprintPreview,
    statusBarBlueprintPreviewConfig,
    statusBarBlueprintTemplateStats,
    statusBlueprintEditorRows,
    // regex & render plugins
    addRenderPlugin,
    addRule,
    enabledRenderPlugins,
    previewInput,
    regexPreview,
    removeRenderPlugin,
    removeRule,
    renderPluginPreviewText,
    // actions
    handleExport,
    insertUserVariable,
    nameError,
    navigateHome,
    removeCharacter,
    submit,
    updateCharacterFormField,
    userVariableValue,
    validateCharacterName
  };
}
