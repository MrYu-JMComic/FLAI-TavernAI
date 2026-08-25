import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
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
import { useNotify } from '../useNotify';
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

export const CHARACTER_EDITOR_KEY = Symbol('characterEditor');

export const CHARACTER_SECTION_GROUPS = [
  { id: 'core', label: '角色内容' },
  { id: 'assets', label: '角色资产' },
  { id: 'advanced', label: '高级能力' }
];

export const ACCESSORY_SKILL_ITEMS = [
  { key: 'sceneAgent', label: '场景构建助手', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
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

  const isEditing = computed(() => props.route.name === 'characterEdit');
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
  const canEdit = computed(() => !isEditing.value || form.canEdit !== false);

  let characterFormDisposed = false;
  let editingCharacterLoadToken = 0;
  let formSubmitToken = 0;
  let characterDeleteToken = 0;
  let characterExportToken = 0;

  const aiOptions = reactive({
    profile: true,
    background: true,
    worldview: true,
    persona: true,
    openingMessage: true,
    tags: true,
    regexRules: true,
    renderPlugins: true,
    worldBookSuggestion: true,
    advancedSettings: true,
    modSuggestions: true
  });

  const {
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    providerModelOptionsFor
  } = useCharacterAiPreferences(computed(() => props.provider));

  const {
    aiLoading,
    aiRequirement,
    aiToolCalls,
    aiProcess,
    aiReasoning,
    aiModSuggestions,
    suggestedModsCreating,
    advancedAiLoading,
    advancedAiRequirement,
    characterAiActionBusy,
    cancelCharacterAiGeneration,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi
  } = useCharacterAiGeneration({
    canEdit,
    saving,
    form,
    aiOptions,
    aiUseCurrentDraft,
    assistantModel,
    buildPayload: toPayload,
    applyAdvancedSettingsDraft,
    isDisposed: () => characterFormDisposed,
    notify
  });

  const {
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
  } = useCharacterFormDraft({
    isEditing,
    editingCharacterId,
    canEdit,
    isDisposed: () => characterFormDisposed,
    buildPayload: toPayload,
    getSelectedWorldBookIds: () => selectedWorldBookIds.value,
    normalizePayload: normalizeCharacterDraftPayload,
    normalizeWorldBookIds,
    applyPayload: applyCharacterDraftPayload,
    setSelectedWorldBookIds: setSelectedWorldBookIdsIfChanged
  });

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
    window.addEventListener('beforeunload', handleCharacterBeforeUnload);
    startCharacterDraftInterval();
    const optionsLoad = loadFormOptions();
    if (isEditing.value) {
      await Promise.all([optionsLoad, loadEditingCharacter()]);
      return;
    }
    initializeCharacterDraftState();
    await optionsLoad;
  });

  onBeforeUnmount(() => {
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
    cancelCharacterAiGeneration();
  });

  onBeforeRouteLeave(() => {
    if (!hasUnsavedChanges.value || characterFormDisposed) {
      return true;
    }
    return window.confirm('角色还有未保存的更改，确定离开吗？');
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
    if (characterFormDisposed || !isEditing.value) {
      return;
    }

    const characterId = editingCharacterId.value;
    const loadToken = ++editingCharacterLoadToken;
    loading.value = true;
    loadError.value = '';
    try {
      const [character, linkedBooks] = await Promise.all([
        fetchCharacter(characterId),
        fetchCharacterWorldBooks(characterId)
      ]);
      if (!isCurrentEditingCharacterLoad(loadToken, characterId)) return;
      Object.assign(form, normalizeForForm(character));
      setSelectedWorldBookIdsFromBooksIfChanged(linkedBooks);
      initializeCharacterDraftState();
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

  function isCurrentEditingCharacterLoad(loadToken, characterId) {
    return !characterFormDisposed
      && loadToken === editingCharacterLoadToken
      && characterId === editingCharacterId.value;
  }

  async function submit() {
    if (characterFormDisposed || characterFooterActionBusy.value || !canEdit.value) {
      return;
    }
    if (!validateCharacterName({ focus: true })) {
      return;
    }

    const submitToken = ++formSubmitToken;
    const editing = isEditing.value;
    const characterId = editingCharacterId.value;
    const worldBookIds = [...selectedWorldBookIds.value];
    saving.value = true;
    try {
      const payload = toPayload();
      const saved = editing
        ? await updateCharacter(characterId, payload)
        : await createCharacter(payload);
      await syncCharacterWorldBooks(saved.id, { editing, selectedIds: worldBookIds });
      if (!isCurrentFormSubmit(submitToken, { editing, characterId })) return;
      establishCharacterDraftBaseline();
      clearCurrentCharacterDraft();
      notify.success(editing ? '角色已保存' : '角色已创建');
      if (editing) {
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

  return {
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
    isCharacterCreationWizardActive,
    isCharacterCreationWizardAvailable,
    setCharacterCreationMode,
    setCharacterWizardStep,
    // summary
    completedCount,
    completionItems,
    // draft
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
    aiModSuggestions,
    aiOptions,
    aiProcess,
    aiReasoning,
    aiRequirement,
    aiToolCalls,
    aiUseCurrentDraft,
    assistantModel,
    assistantModelOptions,
    characterAiActionBusy,
    completeAdvancedSettingsWithAi,
    completeWithAi,
    createSuggestedMods,
    modelOverrideOptions,
    setAiOptionValue,
    stopAdvancedAi,
    stopCharacterAi,
    suggestedModsCreating,
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
