<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ArrowLeft, Download, Plus, RotateCcw, Save, Trash2, X } from '@lucide/vue';
import { createCharacter, deleteCharacter, fetchCharacter, fetchCharacterWorldBooks, linkCharacterWorldBook, unlinkCharacterWorldBook, updateCharacter } from '../api/characters.js';
import { exportEnvelope } from '../api/envelopes.js';
import CharacterImagePanel from '../components/CharacterImagePanel.vue';
import CharacterAdvancedSettingsPanel from '../components/character/CharacterAdvancedSettingsPanel.vue';
import CharacterAiDraftPanel from '../components/character/CharacterAiDraftPanel.vue';
import CharacterBasicInfoPanel from '../components/character/CharacterBasicInfoPanel.vue';
import CharacterCreationWizardPanel from '../components/character/CharacterCreationWizardPanel.vue';
import CharacterRegexPanel from '../components/character/CharacterRegexPanel.vue';
import CharacterRenderPluginPanel from '../components/character/CharacterRenderPluginPanel.vue';
import CharacterSettingsPanel from '../components/character/CharacterSettingsPanel.vue';
import CharacterStatusPreviewDialog from '../components/character/CharacterStatusPreviewDialog.vue';
import CharacterTalentPanel from '../components/character/CharacterTalentPanel.vue';
import CharacterWorldBookDialog from '../components/character/CharacterWorldBookDialog.vue';
import { useNotify } from '../composables/useNotify';
import { useCharacterAiGeneration } from '../composables/character/useCharacterAiGeneration';
import { useCharacterAiPreferences } from '../composables/character/useCharacterAiPreferences';
import { useCharacterAiPanelLayout } from '../composables/character/useCharacterAiPanelLayout';
import { useCharacterCreationWizard } from '../composables/character/useCharacterCreationWizard';
import { useCharacterFormDraft } from '../composables/character/useCharacterFormDraft';
import { useCharacterFormOptions } from '../composables/character/useCharacterFormOptions';
import {
  emptyCharacter,
  hasNonDefaultAccessorySkills,
  normalizeAccessorySkillsForPayload,
  normalizeAdvancedSettingsForForm,
  normalizeCharacterDraftPayload,
  normalizeForForm,
  parseTagsTextForPayload
} from '../composables/character/useCharacterFormPayload';
import { useCharacterImageUploads } from '../composables/character/useCharacterImageUploads';
import { useCharacterRegexRules } from '../composables/character/useCharacterRegexRules';
import { useCharacterRenderPlugins } from '../composables/character/useCharacterRenderPlugins';
import { useCharacterSectionNavigation } from '../composables/character/useCharacterSectionNavigation';
import { hasStatusBarBlueprintContent, normalizeStatusBarBlueprintForPayload, useCharacterStatusBlueprint } from '../composables/character/useCharacterStatusBlueprint';
import { useCharacterWorldBookDialog } from '../composables/character/useCharacterWorldBookDialog';
import { downloadJsonFile, todayStamp } from '../utils/downloadJson.js';

const props = defineProps({
  route: {
    type: Object,
    required: true
  },
  user: {
    type: Object,
    default: null
  },
  provider: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);
const notify = useNotify();

const isEditing = computed(() => props.route.name === 'characterEdit');
const editingCharacterId = computed(() => props.route.params.id || '');
const loading = ref(false);
const loadError = ref('');
const saving = ref(false);
const deleting = ref(false);
const exporting = ref(false);
const showStatusPreviewDialog = ref(false);
let characterFormDisposed = false;
let editingCharacterLoadToken = 0;
let formSubmitToken = 0;
let characterDeleteToken = 0;
let characterExportToken = 0;
const {
  aiUseCurrentDraft,
  assistantModel,
  assistantModelOptions,
  providerModelOptionsFor
} = useCharacterAiPreferences(computed(() => props.provider));
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
const previewInput = ref('');
const form = reactive(emptyCharacter());
const canEdit = computed(() => !isEditing.value || form.canEdit !== false);
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

onBeforeUnmount(() => {
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
  cancelCharacterSectionNavSync();
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
} = useCharacterStatusBlueprint({
  canEdit,
  form,
  notify
});
const {
  CHARACTER_CREATION_WIZARD_STEPS,
  characterCreationMode,
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
  setCharacterWizardStep,
  skipCharacterWizardStep
} = useCharacterCreationWizard({
  isEditing,
  canEdit,
  setActiveSection: (sectionId) => {
    activeSection.value = sectionId;
  },
  setVisibleActiveSection: (sectionId) => setActiveCharacterSection(sectionId),
  scheduleSectionNavSync: () => scheduleCharacterSectionNavSync(),
  scrollToSection: (sectionId, options) => scrollToSection(sectionId, options)
});
const {
  characterDraftStatus,
  characterDraftStatusText,
  clearCurrentCharacterDraft,
  discardCharacterDraft,
  establishCharacterDraftBaseline,
  flushCharacterDraftBeforeDispose,
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
const formSections = [
  { id: 'basic', label: '基础信息' },
  { id: 'settings', label: '角色设定' },
  { id: 'ai', label: 'AI 完善', visible: () => canEdit.value },
  { id: 'images', label: '角色图片', visible: () => isEditing.value && Boolean(editingCharacterId.value) },
  { id: 'talents', label: '角色天赋', visible: () => isEditing.value && Boolean(editingCharacterId.value) },
  { id: 'advanced-settings', label: '作者高级' },
  { id: 'status-blueprint', label: '状态栏' },
  { id: 'accessories', label: '附属技能' },
  { id: 'render-plugins', label: '渲染插件' },
  { id: 'regex', label: '正则规则' }
];
const {
  activeSection,
  cancelCharacterSectionNavSync,
  getCharacterScrollContainer,
  scheduleCharacterSectionNavSync,
  scrollToSection,
  sectionNavRef,
  setActiveCharacterSection,
  visibleFormSections
} = useCharacterSectionNavigation({
  sections: formSections,
  isSectionVisible
});
// ---- AI draft panel drag / resize state ----
const {
  aiPanelDragging,
  aiPanelPos,
  aiPanelRef,
  aiPanelSize,
  onAiPanelDragStart,
  onAiPanelResizeStart,
  resetAiPanel
} = useCharacterAiPanelLayout({
  getScrollContainer: getCharacterScrollContainer,
  scheduleSectionNavSync: scheduleCharacterSectionNavSync
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

function isSectionVisible(section) {
  return isCharacterSectionVisibleInCurrentMode(section.id)
    && (typeof section.visible !== 'function' || section.visible());
}

const accessorySkillItems = [
  { key: 'npcAgent', label: 'NPC Agent', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
  { key: 'economyAgent', label: '经济识别', auto: false },
  { key: 'talentPrompt', label: '天赋提示', auto: false },
  { key: 'cgScene', label: 'CG 场景', auto: false }
];
const characterFooterActionBusy = computed(() => saving.value || deleting.value || exporting.value);
const permissionText = computed(() => {
  if (!isEditing.value) {
    return '你将成为这个角色的拥有者';
  }
  return form.canEdit ? '你是角色拥有者，可编辑全部设置' : '你是角色使用者，只能查看和发起对话';
});

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
const userVariableValue = computed(() => {
  return props.user?.displayName || props.user?.accountName || props.user?.username || '用户';
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
} = useCharacterWorldBookDialog({
  worldBooks,
  selectedWorldBookIds
});

function modelOverrideOptions(value = '') {
  return providerModelOptionsFor(value, '使用当前模型');
}

onMounted(async () => {
  startCharacterDraftInterval();
  const optionsLoad = loadFormOptions();
  if (isEditing.value) {
    await Promise.all([optionsLoad, loadEditingCharacter()]);
    return;
  }
  initializeCharacterDraftState();
  await optionsLoad;
});

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
}

function applyAdvancedSettingsDraft(input = {}, { applyEmptyValues = true } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = normalizeAdvancedSettingsForForm(source);
  for (const key of ['desktopBackgroundUrl', 'mobileBackgroundUrl', 'customCss', 'customCssEnabled', 'customJs', 'customJsEnabled', 'statusBarPrompt']) {
    if (applyEmptyValues || String(normalized[key] || '').trim()) {
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

</script>

<template>
  <section class="page-stack">
    <div class="section-heading">
      <div>
        <p>{{ isEditing && !canEdit ? '查看角色' : isEditing ? '编辑角色' : '创建角色' }}</p>
        <h1>{{ isEditing ? form.name || '角色编辑' : '创建新的 AI 角色' }}</h1>
      </div>
      <button class="ghost-button" type="button" @click="emit('navigate', 'home')">
        <ArrowLeft :size="18" />
        <span>返回</span>
      </button>
    </div>

    <p v-if="loading" class="muted-text" aria-live="polite">正在加载角色...</p>
    <section v-else-if="loadError" class="form-panel empty-state error-state" role="alert">
      <h2>角色加载失败</h2>
      <p>{{ loadError }}</p>
      <div class="empty-state-actions">
        <button class="ghost-button" type="button" :disabled="loading" @click="loadEditingCharacter">
          <RotateCcw :size="18" />
          <span>{{ loading ? '重试中...' : '重试' }}</span>
        </button>
        <button class="primary-button" type="button" @click="emit('navigate', 'characterNew')">
          <Plus :size="18" />
          <span>创建新角色</span>
        </button>
        <button class="ghost-button" type="button" @click="emit('navigate', 'home')">
          <ArrowLeft :size="18" />
          <span>返回首页</span>
        </button>
      </div>
    </section>
    <p v-if="!loading && !loadError" class="permission-note" :class="{ readonly: !canEdit }">{{ permissionText }}</p>
    <section
      v-if="!loading && !loadError && canEdit && characterDraftStatusText"
      class="character-draft-note"
      :class="{ pending: pendingCharacterDraft, warning: characterDraftStatus === 'too-large' || characterDraftStatus === 'error' }"
      aria-live="polite"
    >
      <div class="character-draft-copy">
        <strong>{{ pendingCharacterDraft ? '本地草稿' : '自动保存' }}</strong>
        <span>{{ characterDraftStatusText }}</span>
      </div>
      <div v-if="pendingCharacterDraft" class="character-draft-actions">
        <button class="ghost-button" type="button" @click="restoreCharacterDraft">
          <RotateCcw :size="17" />
          <span>恢复</span>
        </button>
        <button class="ghost-button" type="button" @click="discardCharacterDraft">
          <X :size="17" />
          <span>丢弃</span>
        </button>
      </div>
    </section>

    <CharacterCreationWizardPanel
      v-if="!loading && !loadError && isCharacterCreationWizardAvailable"
      :active="isCharacterCreationWizardActive"
      :current-step="currentCharacterWizardStep"
      :progress-text="characterWizardProgressText"
      :step-id="characterWizardStepId"
      :step-index="characterWizardStepIndex"
      :steps="CHARACTER_CREATION_WIZARD_STEPS"
      @next="goToNextCharacterWizardStep"
      @previous="goToPreviousCharacterWizardStep"
      @set-mode="setCharacterCreationMode"
      @set-step="setCharacterWizardStep"
      @skip="skipCharacterWizardStep"
    />

    <div class="character-editor-workbench">
    <nav v-if="!loading && !loadError" ref="sectionNavRef" class="form-section-nav character-section-nav">
      <button
        v-for="section in visibleFormSections"
        :key="section.id"
        class="form-section-tab"
        :class="{ active: activeSection === section.id }"
        :data-section-id="section.id"
        :aria-current="activeSection === section.id ? 'true' : undefined"
        type="button"
        @click="scrollToSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <form v-if="!loading && !loadError" class="editor-layout" @submit.prevent="submit">
      <div class="character-main-sections">
        <CharacterBasicInfoPanel
          v-if="isCharacterSectionVisibleInCurrentMode('basic')"
          v-model:tag-search="tagSearch"
          :can-create-searched-tag="canCreateSearchedTag"
          :can-edit="canEdit"
          :filtered-tags="filteredTags"
          :form="form"
          :hidden-selected-world-book-count="hiddenSelectedWorldBookCount"
          :options-load-error="optionsLoadError"
          :options-loading="optionsLoading"
          :selected-world-book-ids="selectedWorldBookIds"
          :selected-world-book-preview="selectedWorldBookPreview"
          :tag-creating="tagCreating"
          :user-variable-value="userVariableValue"
          :world-books="worldBooks"
          @avatar-change="handleAvatar"
          @create-tag="createAndSelectTag"
          @open-world-book-dialog="openWorldBookDialog"
          @retry-options="loadFormOptions"
          @toggle-tag="toggleTagSelection"
          @toggle-world-book="toggleWorldBook"
          @update-field="updateCharacterFormField"
        />

        <CharacterSettingsPanel
          v-if="isCharacterSectionVisibleInCurrentMode('settings')"
          :can-edit="canEdit"
          :form="form"
          :user-variable-value="userVariableValue"
          @insert-user-variable="insertUserVariable"
          @update-field="updateCharacterFormField"
        />
      </div>

      <div class="editor-side">
        <div id="section-advanced" class="form-section-group-advanced">
        <CharacterAiDraftPanel
          v-if="canEdit && isCharacterSectionVisibleInCurrentMode('ai')"
          id="section-ai"
          ref="aiPanelRef"
          v-model:requirement="aiRequirement"
          v-model:assistant-model="assistantModel"
          v-model:use-current-draft="aiUseCurrentDraft"
          :disabled="characterAiActionBusy"
          :dragging="aiPanelDragging"
          :loading="aiLoading"
          :model-options="assistantModelOptions"
          :options="aiOptions"
          :panel-position="aiPanelPos"
          :panel-size="aiPanelSize"
          :process="aiProcess"
          :reasoning="aiReasoning"
          :suggested-mods-creating="suggestedModsCreating"
          :suggestions="aiModSuggestions"
          :tool-calls="aiToolCalls"
          @complete="completeWithAi"
          @create-suggested-mods="createSuggestedMods"
          @drag-start="onAiPanelDragStart"
          @reset-panel="resetAiPanel"
          @resize-start="onAiPanelResizeStart"
          @set-option="setAiOptionValue"
          @stop="stopCharacterAi"
        />

        <section v-if="isEditing && editingCharacterId && isCharacterSectionVisibleInCurrentMode('images')" id="section-images" class="form-panel character-image-section">
          <CharacterImagePanel :character-id="editingCharacterId" :disabled="!canEdit" />
        </section>

        <CharacterTalentPanel
          v-if="isEditing && editingCharacterId && isCharacterSectionVisibleInCurrentMode('talents')"
          :character-id="editingCharacterId"
          :character-name="form.name"
          :can-edit="canEdit"
        />

        <CharacterAdvancedSettingsPanel
          v-if="isCharacterSectionVisibleInCurrentMode('advanced-settings')"
          v-model:advanced-ai-requirement="advancedAiRequirement"
          v-model:ai-use-current-draft="aiUseCurrentDraft"
          :accessory-skill-items="accessorySkillItems"
          :advanced-ai-loading="advancedAiLoading"
          :advanced-settings="form.authorAdvancedSettings"
          :background-uploading="backgroundUploading"
          :can-edit="canEdit"
          :character-ai-action-busy="characterAiActionBusy"
          :model-override-options="modelOverrideOptions"
          :status-bar-blueprint-template-stats="statusBarBlueprintTemplateStats"
          :status-blueprint-editor-rows="statusBlueprintEditorRows"
          @add-status-variable="addStatusBlueprintVariable"
          @background-change="handleAdvancedBackground"
          @clear-background="clearAdvancedBackground"
          @clear-status-template="clearStatusBlueprintTemplate"
          @complete-ai="completeAdvancedSettingsWithAi"
          @preview-status="showStatusPreviewDialog = true"
          @remove-status-variable="removeStatusBlueprintVariable"
          @sample-status-template="applyStatusBlueprintSampleTemplate"
          @set-color="setColorValueFromEvent"
          @set-composite-value="setStatusBlueprintVariableValueFromEvent"
          @set-variable-mode="setStatusBlueprintVariableModeFromEvent"
          @stop-ai="stopAdvancedAi"
          @sync-status-template="refreshStatusBlueprintVariables"
        />

        <CharacterRenderPluginPanel
          v-if="isCharacterSectionVisibleInCurrentMode('render-plugins')"
          :can-edit="canEdit"
          :enabled-render-plugins="enabledRenderPlugins"
          :preview-text="renderPluginPreviewText"
          :render-plugins="form.renderPlugins"
          @add-plugin="addRenderPlugin(true)"
          @remove-plugin="removeRenderPlugin"
        />

        <CharacterRegexPanel
          v-if="isCharacterSectionVisibleInCurrentMode('regex')"
          v-model:preview-input="previewInput"
          :can-edit="canEdit"
          :regex-preview="regexPreview"
          :rules="form.regexRules"
          @add-rule="addRule"
          @remove-rule="removeRule"
        />

        <div class="form-actions">
          <button v-if="isEditing && canEdit" class="danger-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="deleting" @click="removeCharacter">
            <Trash2 :size="18" />
            <span>{{ deleting ? '删除中...' : '删除' }}</span>
          </button>
          <button v-if="isEditing" class="ghost-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="exporting" @click="handleExport">
            <Download :size="18" />
            <span>{{ exporting ? '导出中...' : '导出' }}</span>
          </button>
          <button v-if="canEdit" class="primary-button" type="submit" :disabled="characterFooterActionBusy" :aria-busy="saving">
            <Save :size="18" />
            <span>{{ saving ? '保存中...' : '保存角色' }}</span>
          </button>
          <button v-else class="primary-button" type="button" @click="emit('navigate', 'home')">
            <span>返回角色大厅</span>
          </button>
        </div>
        </div>
      </div>
    </form>
    </div>

    <CharacterWorldBookDialog
      v-if="showWorldBookDialog"
      v-model:search="worldBookSearch"
      v-model:sort="worldBookSort"
      :can-edit="canEdit"
      :options-loading="optionsLoading"
      :options-load-error="optionsLoadError"
      :paged-world-books="pagedWorldBooks"
      :filtered-world-books="filteredWorldBooks"
      :selected-world-book-ids="selectedWorldBookIds"
      :world-book-page="worldBookPage"
      :world-book-page-start="worldBookPageStart"
      :world-book-page-end="worldBookPageEnd"
      :world-book-page-count="worldBookPageCount"
      @clear-search="clearWorldBookSearch"
      @close="closeWorldBookDialog"
      @page="setWorldBookPage"
      @toggle="toggleWorldBook"
    />

    <CharacterStatusPreviewDialog
      v-if="showStatusPreviewDialog"
      :status-bar="statusBarBlueprintPreview"
      :template-config="statusBarBlueprintPreviewConfig"
      @close="showStatusPreviewDialog = false"
    />
  </section>
</template>
