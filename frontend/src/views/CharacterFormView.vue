<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { ArrowLeft, ChevronLeft, ChevronRight, Dice6, Download, Eye, ListChecks, Plus, RotateCcw, Save, Settings, Sparkles, Trash2, Upload, WandSparkles, X } from '@lucide/vue';
import { createCharacter, createMod, createTag, deleteCharacter, exportCharacter, fetchCharacter, fetchCharacterWorldBooks, fetchTags, fetchWorldBooks, linkCharacterWorldBook, streamCharacterDraft, unlinkCharacterWorldBook, updateCharacter } from '../api';
import CharacterImagePanel from '../components/CharacterImagePanel.vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import StatusBar from '../components/StatusBar.vue';
import TalentRollDialog from '../components/TalentRollDialog.vue';
import VariableEditor from '../components/VariableEditor.vue';
import { useNotify } from '../composables/useNotify';
import { useProviderModels } from '../composables/useProviderModels';
import { appendAiToolList, cloneAiToolList } from '../utils/aiToolLists';
import { callEventMethod } from '../utils/eventMethods';
import { readFileAsDataUrl } from '../utils/fileReaders';
import { countOwnObjectKeys } from '../utils/objectKeys';
import { samePlainValue } from '../utils/plainValues';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';

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
const showTalentDialog = ref(false);
const showStatusPreviewDialog = ref(false);
const aiLoading = ref(false);
const aiRequirement = ref('');
const aiToolCalls = ref([]);
const aiProcess = ref([]);
const aiReasoning = ref('');
const aiModSuggestions = ref([]);
const suggestedModsCreating = ref(false);
const advancedAiLoading = ref(false);
const advancedAiRequirement = ref('');
const aiAbortController = ref(null);
const advancedAiAbortController = ref(null);
let characterFormDisposed = false;
let formOptionsLoadToken = 0;
let editingCharacterLoadToken = 0;
let formSubmitToken = 0;
let characterDeleteToken = 0;
let characterExportToken = 0;
let tagCreateToken = 0;
let suggestedModCreateToken = 0;
const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';
const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';
const AI_DRAFT_SEED_FIELDS = ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'];
const assistantModel = ref(loadAssistantModel());
const aiUseCurrentDraft = ref(loadAiUseCurrentDraft());
const { providerModelOptionsFor } = useProviderModels(computed(() => props.provider));
const assistantModelOptions = computed(() => providerModelOptionsFor(assistantModel.value, '使用全局模型'));
const STATUS_BLUEPRINT_VARIABLE_LIMIT = 60;
const ADVANCED_BACKGROUND_FIELDS = new Set(['desktopBackgroundUrl', 'mobileBackgroundUrl']);
const STATUS_BLUEPRINT_SAMPLE_TEMPLATE = [
  '<section class="sb-sample-card">',
  '  <style>',
  '    .sb-sample-card{display:grid;gap:8px;font-size:13px}',
  '    .sb-sample-card .sb-row{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:center}',
  '    .sb-sample-card .sb-label{color:#6b7280;font-weight:700}',
  '    .sb-sample-card .sb-val{min-width:0;overflow-wrap:anywhere}',
  '    .sb-sample-card .sb-track{height:8px;overflow:hidden;border-radius:999px;background:#e5e7eb}',
  '    .sb-sample-card .sb-fill{height:100%;width:{{体力.percent}};background:{{体力.color}}}',
  '    .sb-sample-card .sb-actions{display:flex;flex-wrap:wrap;gap:6px}',
  '    .sb-sample-card button{border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;background:#fff;color:#111827}',
  '  </style>',
  '  <div class="sb-row"><span class="sb-label">姓名</span><span class="sb-val">{{姓名}}</span></div>',
  '  <div class="sb-row"><span class="sb-label">所在地</span><span class="sb-val">{{所在地}}</span></div>',
  '  <div class="sb-row"><span class="sb-label">体力</span><span class="sb-val">{{体力}} / {{体力.max}}</span></div>',
  '  <div class="sb-track"><div class="sb-fill"></div></div>',
  '  <div class="sb-actions">',
  '    <button type="button" data-sb-action="quick-reply" data-sb-text="查看状态">查看状态</button>',
  '    <button type="button" data-sb-action="copy" data-sb-copy="{{姓名}}｜{{所在地}}">复制摘要</button>',
  '  </div>',
  '</section>'
].join('\n');
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
const worldBooks = ref([]);
const selectedWorldBookIds = ref([]);
const showWorldBookDialog = ref(false);
const worldBookSearch = ref('');
const worldBookSort = ref('updatedDesc');
const worldBookPage = ref(1);
const availableTags = ref([]);
const optionsLoading = ref(false);
const optionsLoadError = ref('');
const tagSearch = ref('');
const tagCreating = ref(false);
const activeSection = ref('basic');
const sectionNavRef = ref(null);
const form = reactive(emptyCharacter());
const backgroundUploading = reactive({
  desktopBackgroundUrl: false,
  mobileBackgroundUrl: false
});
const backgroundUploadTokens = {};
let avatarUploadToken = 0;
let sectionNavRafId = null;
const WORLD_BOOK_SELECTOR_PAGE_SIZE = 8;
const WORLD_BOOK_SORT_OPTIONS = [
  { value: 'updatedDesc', label: '最近更新' },
  { value: 'nameAsc', label: '名称 A-Z' },
  { value: 'entryCountDesc', label: '条目多到少' }
];

const statusBarBlueprintPreview = computed(() => {
  const blueprint = normalizeStatusBarBlueprintForPayload(form.authorAdvancedSettings.statusBarBlueprint || {});
  if (!hasStatusBarBlueprintContent(blueprint)) {
    return null;
  }
  return {
    id: 'character-status-blueprint-preview',
    name: blueprint.name || '状态栏',
    variables: blueprint.variables,
    template: blueprint.template
  };
});

const statusBarBlueprintPreviewConfig = computed(() => (
  parseStatusBarTemplateConfig(statusBarBlueprintPreview.value?.template || '')
));

const statusBarBlueprintTemplateStats = computed(() => {
  const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
  const normalized = normalizeStatusBarBlueprintForPayload(blueprint);
  const template = normalized.template;
  const variableStats = countStatusBlueprintVariableStats(normalized.variables, template);
  return {
    variables: normalized.variables.length,
    inferred: variableStats.inferred,
    text: Math.max(0, normalized.variables.length - variableStats.meter),
    meter: variableStats.meter,
    placeholders: countStatusTemplatePlaceholders(template),
    actions: countStatusTemplateActions(template),
    lines: template ? template.split(/\r\n|\r|\n/).length : 0,
    hasTemplate: Boolean(template)
  };
});

const statusBlueprintEditorRows = computed(() => {
  const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
  const template = String(blueprint.template || '');
  const variables = Array.isArray(blueprint.variables) ? blueprint.variables : [];
  const compositeRows = extractStatusTemplateCompositeRows(template);
  const compositeChildKeys = new Set();
  const compositeLabelKeys = new Set();
  const rows = [];
  for (let index = 0; index < compositeRows.length; index += 1) {
    const row = compositeRows[index];
    compositeLabelKeys.add(normalizeStatusVariableKey(row.label));
    let compositePartKey = '';
    for (let partIndex = 0; partIndex < row.parts.length; partIndex += 1) {
      const part = row.parts[partIndex];
      compositeChildKeys.add(normalizeStatusVariableKey(part.name));
      compositePartKey += `${partIndex > 0 ? '|' : ''}${part?.name ?? ''}`;
    }
    rows.push({
      kind: 'composite',
      key: `composite:${index}:${row.label}:${compositePartKey}`,
      label: row.label,
      parts: row.parts
    });
  }

  for (let index = 0; index < variables.length; index += 1) {
    const variable = variables[index];
    const key = normalizeStatusVariableKey(variable?.name);
    if (
      !key ||
      compositeChildKeys.has(key) ||
      compositeLabelKeys.has(key) ||
      isCompositeStatusPlaceholderValue(variable?.value, variable?.name)
    ) {
      continue;
    }
    rows.push({
      kind: 'variable',
      key: `variable:${index}:${key}`,
      variable,
      index
    });
  }

  return rows;
});

watch(
  () => form.authorAdvancedSettings.statusBarBlueprint.template,
  () => {
    syncStatusBlueprintVariablesFromTemplate();
  }
);

// ---- AI draft panel drag / resize state ----
const AI_PANEL_STORAGE_KEY = 'cf-ai-panel-pos';
const AI_PANEL_VIEWPORT_GAP = 0;
const AI_PANEL_DRAG_THRESHOLD = 8;
const AI_PANEL_MIN_WIDTH = 320;
const AI_PANEL_MIN_HEIGHT = 180;
const AI_PANEL_DEFAULT_HEIGHT = 640;
const AI_PANEL_DEFAULT = (() => {
  try {
    return { x: Math.max(16, window.innerWidth - 460), y: 96, w: 420, h: getAiPanelDefaultHeight() };
  } catch {
    return { x: 16, y: 96, w: 420, h: AI_PANEL_DEFAULT_HEIGHT };
  }
})();
const aiPanelRef = ref(null);
const aiPanelPos = ref(loadAiPanelPos());
const aiPanelSize = ref(loadAiPanelSize());
const aiPanelDragging = ref(false);
let aiPanelDragTracking = false;
let aiPanelResizing = false;
let aiPanelLayoutRafId = null;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragStarted = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;

function getAiPanelDefaultHeight() {
  try {
    return Math.max(
      AI_PANEL_MIN_HEIGHT,
      Math.min(AI_PANEL_DEFAULT_HEIGHT, window.innerHeight - 112)
    );
  } catch {
    return AI_PANEL_DEFAULT_HEIGHT;
  }
}

function loadAiPanelPos() {
  try {
    const raw = localStorage.getItem(AI_PANEL_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        return { x: data.x, y: data.y };
      }
    }
  } catch {}
  return { x: AI_PANEL_DEFAULT.x, y: AI_PANEL_DEFAULT.y };
}

function loadAiPanelSize() {
  try {
    const raw = localStorage.getItem(AI_PANEL_STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.w === 'number' && typeof data.h === 'number' && data.w > 0) {
        return {
          w: Math.max(AI_PANEL_MIN_WIDTH, data.w),
          h: data.h >= AI_PANEL_MIN_HEIGHT ? data.h : AI_PANEL_DEFAULT.h
        };
      }
    }
  } catch {}
  return { w: AI_PANEL_DEFAULT.w, h: AI_PANEL_DEFAULT.h };
}

function loadAssistantModel() {
  try {
    return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function loadAiUseCurrentDraft() {
  try {
    const raw = localStorage.getItem(ASSISTANT_USE_CURRENT_STORAGE_KEY);
    return raw === null ? true : raw !== 'false';
  } catch {
    return true;
  }
}

watch(assistantModel, (value) => {
  try {
    localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, String(value || '').trim());
  } catch {}
});

watch(aiUseCurrentDraft, (value) => {
  try {
    localStorage.setItem(ASSISTANT_USE_CURRENT_STORAGE_KEY, value ? 'true' : 'false');
  } catch {}
});

function saveAiPanelState() {
  try {
    localStorage.setItem(AI_PANEL_STORAGE_KEY, JSON.stringify({
      x: aiPanelPos.value.x,
      y: aiPanelPos.value.y,
      w: aiPanelSize.value.w,
      h: aiPanelSize.value.h
    }));
  } catch {}
}

function getAiPanelSafeTop() {
  if (window.innerWidth <= 760) {
    return 0;
  }
  const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
  return Math.max(
    AI_PANEL_VIEWPORT_GAP,
    Math.ceil(Number.isFinite(topbarBottom) ? topbarBottom : 0)
  );
}

function getAiPanelMeasuredSize(fallback = aiPanelSize.value) {
  const rect = aiPanelRef.value?.getBoundingClientRect();
  return {
    w: rect?.width > 0 ? rect.width : fallback.w,
    h: rect?.height > 0 ? rect.height : fallback.h || 200
  };
}

function clampAiPanelPos(x, y, size = getAiPanelMeasuredSize()) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = size.w;
  const h = size.h || 200;
  const minX = AI_PANEL_VIEWPORT_GAP;
  const minY = getAiPanelSafeTop();
  const maxX = Math.max(minX, vw - w - AI_PANEL_VIEWPORT_GAP);
  const maxY = Math.max(minY, vh - h - AI_PANEL_VIEWPORT_GAP);
  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY))
  };
}

function readAiPanelPointerPoint(event) {
  const source = event?.touches?.[0] || event;
  const clientX = source?.clientX;
  const clientY = source?.clientY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  return { clientX, clientY };
}

function onAiPanelDragStart(e) {
  if (window.innerWidth <= 760 || aiPanelResizing) return;
  const point = readAiPanelPointerPoint(e);
  if (!point) return;
  const panel = aiPanelRef.value;
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  dragStartX = point.clientX;
  dragStartY = point.clientY;
  dragOffsetX = point.clientX - rect.left;
  dragOffsetY = point.clientY - rect.top;
  aiPanelDragTracking = true;
  aiPanelDragging.value = false;
  dragStarted = false;
  document.addEventListener('pointermove', onAiPanelDragMove, { passive: false });
  document.addEventListener('pointerup', onAiPanelDragEnd);
  document.addEventListener('pointercancel', onAiPanelDragEnd);
}

function onAiPanelDragMove(e) {
  if (!aiPanelDragTracking) return;
  callEventMethod(e, 'preventDefault');
  const point = readAiPanelPointerPoint(e);
  if (!point) return;
  const distance = Math.hypot(point.clientX - dragStartX, point.clientY - dragStartY);
  if (distance < AI_PANEL_DRAG_THRESHOLD) {
    return;
  }
  dragStarted = true;
  aiPanelDragging.value = true;
  const clamped = clampAiPanelPos(point.clientX - dragOffsetX, point.clientY - dragOffsetY);
  aiPanelPos.value = { x: clamped.x, y: clamped.y };
}

function onAiPanelDragEnd() {
  if (!aiPanelDragTracking) return;
  aiPanelDragTracking = false;
  aiPanelDragging.value = false;
  document.removeEventListener('pointermove', onAiPanelDragMove);
  document.removeEventListener('pointerup', onAiPanelDragEnd);
  document.removeEventListener('pointercancel', onAiPanelDragEnd);
  if (dragStarted) saveAiPanelState();
  dragStarted = false;
}

function onAiPanelResizeStart(e) {
  if (window.innerWidth <= 760) return;
  const point = readAiPanelPointerPoint(e);
  if (!point) return;
  const panel = aiPanelRef.value;
  if (!panel) return;
  callEventMethod(e, 'preventDefault');
  const rect = panel.getBoundingClientRect();
  aiPanelResizing = true;
  resizeStartX = point.clientX;
  resizeStartY = point.clientY;
  resizeStartWidth = rect.width || aiPanelSize.value.w;
  resizeStartHeight = rect.height || aiPanelSize.value.h || AI_PANEL_MIN_HEIGHT;
  document.addEventListener('pointermove', onAiPanelResizeMove, { passive: false });
  document.addEventListener('pointerup', onAiPanelResizeEnd);
  document.addEventListener('pointercancel', onAiPanelResizeEnd);
}

function onAiPanelResizeMove(e) {
  if (!aiPanelResizing) return;
  callEventMethod(e, 'preventDefault');
  const point = readAiPanelPointerPoint(e);
  if (!point) return;
  const nextSize = {
    w: Math.max(AI_PANEL_MIN_WIDTH, Math.round(resizeStartWidth + point.clientX - resizeStartX)),
    h: Math.max(AI_PANEL_MIN_HEIGHT, Math.round(resizeStartHeight + point.clientY - resizeStartY))
  };
  aiPanelSize.value = nextSize;
  const clamped = clampAiPanelPos(aiPanelPos.value.x, aiPanelPos.value.y, nextSize);
  if (clamped.x !== aiPanelPos.value.x || clamped.y !== aiPanelPos.value.y) {
    aiPanelPos.value = clamped;
  }
}

function onAiPanelResizeEnd() {
  if (!aiPanelResizing) return;
  aiPanelResizing = false;
  document.removeEventListener('pointermove', onAiPanelResizeMove);
  document.removeEventListener('pointerup', onAiPanelResizeEnd);
  document.removeEventListener('pointercancel', onAiPanelResizeEnd);
  saveAiPanelState();
}

function resetAiPanel() {
  aiPanelSize.value = { w: AI_PANEL_DEFAULT.w, h: AI_PANEL_DEFAULT.h };
  aiPanelPos.value = clampAiPanelPos(AI_PANEL_DEFAULT.x, AI_PANEL_DEFAULT.y, aiPanelSize.value);
  saveAiPanelState();
}

function syncAiPanelPosition() {
  if (window.innerWidth <= 760) return;
  const clamped = clampAiPanelPos(aiPanelPos.value.x, aiPanelPos.value.y);
  if (clamped.x !== aiPanelPos.value.x || clamped.y !== aiPanelPos.value.y) {
    aiPanelPos.value = clamped;
    saveAiPanelState();
  }
}

function flushScheduledAiPanelLayout() {
  aiPanelLayoutRafId = null;
  syncAiPanelPosition();
}

function scheduleAiPanelLayoutSync() {
  if (aiPanelLayoutRafId !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    aiPanelLayoutRafId = requestAnimationFrame(flushScheduledAiPanelLayout);
    return;
  }
  flushScheduledAiPanelLayout();
}

function cancelAiPanelLayoutSync() {
  if (aiPanelLayoutRafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(aiPanelLayoutRafId);
  }
  aiPanelLayoutRafId = null;
}

function onWindowResize() {
  scheduleAiPanelLayoutSync();
  scheduleCharacterSectionNavSync();
}

function onWindowScroll() {
  scheduleCharacterSectionNavSync();
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('scroll', onWindowScroll, { passive: true });
  onWindowResize();
});

onBeforeUnmount(() => {
  characterFormDisposed = true;
  formOptionsLoadToken += 1;
  editingCharacterLoadToken += 1;
  formSubmitToken += 1;
  characterDeleteToken += 1;
  characterExportToken += 1;
  tagCreateToken += 1;
  tagCreating.value = false;
  showWorldBookDialog.value = false;
  suggestedModCreateToken += 1;
  avatarUploadToken += 1;
  for (const field of ADVANCED_BACKGROUND_FIELDS) {
    nextBackgroundUploadToken(field);
    backgroundUploading[field] = false;
  }
  aiAbortController.value?.abort();
  advancedAiAbortController.value?.abort();
  onAiPanelDragEnd();
  onAiPanelResizeEnd();
  cancelAiPanelLayoutSync();
  cancelCharacterSectionNavSync();
  window.removeEventListener('resize', onWindowResize);
  window.removeEventListener('scroll', onWindowScroll);
});

const canEdit = computed(() => !isEditing.value || form.canEdit !== false);
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
const visibleFormSections = computed(() => formSections.filter(isSectionVisible));

watch(
  visibleFormSections,
  (sections) => {
    if (!sections.some((section) => section.id === activeSection.value)) {
      activeSection.value = sections[0]?.id || 'basic';
    }
    scheduleCharacterSectionNavSync();
  },
  { flush: 'post' }
);

function scrollToSection(id) {
  const scrollTarget = getCharacterSectionTarget(id);
  if (!scrollTarget) {
    return;
  }
  setActiveCharacterSection(id);
  scrollActiveSectionTab(id);
  const top = scrollTarget.getBoundingClientRect().top + window.scrollY - getCharacterSectionActivationOffset();
  window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: 'smooth' });
}

function isSectionVisible(section) {
  return typeof section.visible !== 'function' || section.visible();
}

function getCharacterSectionTarget(id) {
  if (typeof document === 'undefined') {
    return null;
  }
  const el = document.getElementById(`section-${id}`);
  if (!el) {
    return null;
  }
  return el.getClientRects().length
    ? el
    : el.querySelector('.form-panel, .form-section-group, [id^="section-"]') || el;
}

function setActiveCharacterSection(sectionId) {
  if (!visibleFormSections.value.some((section) => section.id === sectionId)) {
    return;
  }
  if (activeSection.value !== sectionId) {
    activeSection.value = sectionId;
    scrollActiveSectionTab(sectionId);
  }
}

function scrollActiveSectionTab(sectionId) {
  const nav = sectionNavRef.value;
  const tab = nav?.querySelector(`[data-section-id="${sectionId}"]`);
  if (tab) {
    tab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  }
}

function getTopbarBottom() {
  if (typeof document === 'undefined') {
    return 0;
  }
  const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom;
  return Math.max(0, Math.ceil(Number.isFinite(topbarBottom) ? topbarBottom : 0));
}

function syncCharacterSectionNavMetrics() {
  const nav = sectionNavRef.value;
  if (!nav) {
    return;
  }
  nav.style.setProperty('--character-section-nav-top', `${getTopbarBottom()}px`);
}

function getCharacterSectionActivationOffset() {
  const navHeight = sectionNavRef.value?.getBoundingClientRect().height || 0;
  return getTopbarBottom() + navHeight + 14;
}

function syncActiveSectionFromScroll() {
  const sections = visibleFormSections.value
    .map((section) => ({
      id: section.id,
      target: getCharacterSectionTarget(section.id)
    }))
    .filter((section) => section.target);
  if (!sections.length) {
    return;
  }
  const activationOffset = getCharacterSectionActivationOffset();
  let nextSectionId = sections[0].id;
  let nextDistance = Number.POSITIVE_INFINITY;
  for (const section of sections) {
    const top = section.target.getBoundingClientRect().top;
    if (top <= activationOffset) {
      const distance = Math.abs(activationOffset - top);
      if (distance <= nextDistance) {
        nextSectionId = section.id;
        nextDistance = distance;
      }
    }
  }
  const scrollHeight = Math.max(
    document.documentElement?.scrollHeight || 0,
    document.body?.scrollHeight || 0
  );
  if (window.innerHeight + window.scrollY >= scrollHeight - 2) {
    nextSectionId = sections[sections.length - 1].id;
  }
  setActiveCharacterSection(nextSectionId);
}

function flushCharacterSectionNavSync() {
  sectionNavRafId = null;
  syncCharacterSectionNavMetrics();
  syncActiveSectionFromScroll();
}

function scheduleCharacterSectionNavSync() {
  if (sectionNavRafId !== null) {
    return;
  }
  if (typeof requestAnimationFrame === 'function') {
    sectionNavRafId = requestAnimationFrame(flushCharacterSectionNavSync);
    return;
  }
  flushCharacterSectionNavSync();
}

function cancelCharacterSectionNavSync() {
  if (sectionNavRafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(sectionNavRafId);
  }
  sectionNavRafId = null;
}
const accessorySkillItems = [
  { key: 'npcAgent', label: 'NPC Agent', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
  { key: 'economyAgent', label: '经济识别', auto: false },
  { key: 'talentPrompt', label: '天赋提示', auto: false },
  { key: 'cgScene', label: 'CG 场景', auto: false }
];
const characterFooterActionBusy = computed(() => saving.value || deleting.value || exporting.value);
const characterAiActionBusy = computed(() => (
  aiLoading.value
  || advancedAiLoading.value
  || saving.value
  || !canEdit.value
));
const permissionText = computed(() => {
  if (!isEditing.value) {
    return '你将成为这个角色的拥有者';
  }
  return form.canEdit ? '你是角色拥有者，可编辑全部设置' : '你是角色使用者，只能查看和发起对话';
});

const regexPreview = computed(() => {
  if (!previewInput.value.trim()) {
    return '';
  }
  return applyLocalRules(previewInput.value, form.regexRules, 'input');
});
const enabledRenderPlugins = computed(() => form.renderPlugins.filter((plugin) => plugin.enabled !== false && plugin.pattern));
const renderPluginPreviewText = computed(() => {
  return [form.background, form.worldview, form.persona, form.openingMessage]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n');
});
const userVariableValue = computed(() => {
  return props.user?.displayName || props.user?.accountName || props.user?.username || '用户';
});
const filteredTags = computed(() => filterTagsBySearch(availableTags.value, tagSearch.value));
const canCreateSearchedTag = computed(() => canCreateTagFromSearch(availableTags.value, tagSearch.value));
const selectedWorldBooks = computed(() => getSelectedWorldBooks(worldBooks.value, selectedWorldBookIds.value));
const selectedWorldBookPreview = computed(() => selectedWorldBooks.value.slice(0, 4));
const hiddenSelectedWorldBookCount = computed(() => Math.max(0, selectedWorldBooks.value.length - selectedWorldBookPreview.value.length));
const filteredWorldBooks = computed(() => filterAndSortWorldBooks(worldBooks.value, worldBookSearch.value, worldBookSort.value));
const worldBookPageCount = computed(() => Math.max(1, Math.ceil(filteredWorldBooks.value.length / WORLD_BOOK_SELECTOR_PAGE_SIZE)));
const pagedWorldBooks = computed(() => getWorldBookPageItems(filteredWorldBooks.value, worldBookPage.value, WORLD_BOOK_SELECTOR_PAGE_SIZE));
const worldBookPageStart = computed(() => {
  if (!filteredWorldBooks.value.length) {
    return 0;
  }
  return ((worldBookPage.value - 1) * WORLD_BOOK_SELECTOR_PAGE_SIZE) + 1;
});
const worldBookPageEnd = computed(() => Math.min(filteredWorldBooks.value.length, worldBookPage.value * WORLD_BOOK_SELECTOR_PAGE_SIZE));

watch([worldBookSearch, worldBookSort], () => {
  setWorldBookPage(1);
});

watch(worldBookPageCount, (pageCount) => {
  if (worldBookPage.value > pageCount) {
    setWorldBookPage(pageCount);
  }
});

function modelOverrideOptions(value = '') {
  return providerModelOptionsFor(value, '使用当前模型');
}

onMounted(async () => {
  const optionsLoad = loadFormOptions();
  if (isEditing.value) {
    await Promise.all([optionsLoad, loadEditingCharacter()]);
    return;
  }
  await optionsLoad;
});

async function loadFormOptions() {
  if (characterFormDisposed) return;
  const loadToken = ++formOptionsLoadToken;
  optionsLoading.value = true;
  optionsLoadError.value = '';
  try {
    const [nextWorldBooks, nextTags] = await Promise.all([fetchWorldBooks(), fetchTags()]);
    if (!isCurrentFormOptionsLoad(loadToken)) return;
    setWorldBooksIfChanged(nextWorldBooks);
    setAvailableTagsIfChanged(nextTags);
  } catch (err) {
    if (!isCurrentFormOptionsLoad(loadToken)) return;
    optionsLoadError.value = err?.message || '标签和世界书选项加载失败';
    notify.error(optionsLoadError.value);
  } finally {
    if (isCurrentFormOptionsLoad(loadToken)) {
      optionsLoading.value = false;
    }
  }
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

function isCurrentFormOptionsLoad(loadToken) {
  return !characterFormDisposed && loadToken === formOptionsLoadToken;
}

function isCurrentEditingCharacterLoad(loadToken, characterId) {
  return !characterFormDisposed
    && loadToken === editingCharacterLoadToken
    && characterId === editingCharacterId.value;
}

function setWorldBooksIfChanged(nextBooks) {
  const normalizedBooks = Array.isArray(nextBooks) ? nextBooks : [];
  if (sameListItems(worldBooks.value, normalizedBooks, sameWorldBookOption)) {
    return false;
  }
  worldBooks.value = normalizedBooks;
  return true;
}

function setAvailableTagsIfChanged(nextTags) {
  const normalizedTags = Array.isArray(nextTags) ? nextTags : [];
  if (sameListItems(availableTags.value, normalizedTags, sameTagOption)) {
    return false;
  }
  availableTags.value = normalizedTags;
  return true;
}

function appendAvailableTagIfMissing(tag) {
  if (!tag?.name) {
    return false;
  }
  const currentTags = Array.isArray(availableTags.value) ? availableTags.value : [];
  const nextTags = [];
  let tagExists = false;
  for (const currentTag of currentTags) {
    if (currentTag?.name === tag?.name) {
      tagExists = true;
    }
    nextTags.push(currentTag);
  }
  if (tagExists) {
    return false;
  }
  nextTags.push(tag);
  return setAvailableTagsIfChanged(nextTags);
}

function filterTagsBySearch(tags, rawSearch) {
  const currentTags = Array.isArray(tags) ? tags : [];
  const search = String(rawSearch || '').trim().toLowerCase();
  if (!search) {
    return currentTags;
  }
  const matches = [];
  for (const tag of currentTags) {
    if (String(tag?.name || '').toLowerCase().includes(search)) {
      matches.push(tag);
    }
  }
  return matches;
}

function canCreateTagFromSearch(tags, rawSearch) {
  const name = String(rawSearch || '').trim();
  if (!name) {
    return false;
  }
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (tag?.name === name) {
      return false;
    }
  }
  return true;
}

function getSelectedWorldBooks(books, selectedIds) {
  const bookById = new Map();
  for (const book of Array.isArray(books) ? books : []) {
    const id = String(book?.id || '');
    if (id) {
      bookById.set(id, book);
    }
  }
  const selected = [];
  for (const rawId of Array.isArray(selectedIds) ? selectedIds : []) {
    const id = String(rawId || '');
    if (id) {
      selected.push(bookById.get(id) || { id, name: id, entryCount: 0 });
    }
  }
  return selected;
}

function filterAndSortWorldBooks(books, rawSearch, sortKey) {
  const sourceBooks = Array.isArray(books) ? books : [];
  const search = String(rawSearch || '').trim().toLowerCase();
  const matches = [];
  for (const book of sourceBooks) {
    const haystack = `${book?.name || ''} ${book?.description || ''}`.toLowerCase();
    if (!search || haystack.includes(search)) {
      matches.push(book);
    }
  }
  return sortWorldBooks(matches, sortKey);
}

function sortWorldBooks(books, sortKey) {
  const sortedBooks = Array.isArray(books) ? [...books] : [];
  if (sortKey === 'nameAsc') {
    sortedBooks.sort(compareWorldBookNames);
    return sortedBooks;
  }
  if (sortKey === 'entryCountDesc') {
    sortedBooks.sort((current, next) => (
      Number(next?.entryCount || 0) - Number(current?.entryCount || 0)
    ) || compareWorldBookNames(current, next));
    return sortedBooks;
  }
  sortedBooks.sort((current, next) => (
    getWorldBookSortTime(next) - getWorldBookSortTime(current)
  ) || compareWorldBookNames(current, next));
  return sortedBooks;
}

function compareWorldBookNames(current = {}, next = {}) {
  return String(current?.name || '').localeCompare(String(next?.name || ''), 'zh-Hans-CN');
}

function getWorldBookSortTime(book = {}) {
  const timestamp = Date.parse(book?.updatedAt || book?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getWorldBookPageItems(books, page, pageSize) {
  const currentBooks = Array.isArray(books) ? books : [];
  const safePageSize = Math.max(1, Number(pageSize) || WORLD_BOOK_SELECTOR_PAGE_SIZE);
  const start = (clampWorldBookPage(page, Math.max(1, Math.ceil(currentBooks.length / safePageSize))) - 1) * safePageSize;
  return currentBooks.slice(start, start + safePageSize);
}

function clampWorldBookPage(page, pageCount) {
  const safePageCount = Math.max(1, Number(pageCount) || 1);
  const numericPage = Number(page);
  const safePage = Number.isFinite(numericPage) ? Math.floor(numericPage) : 1;
  return Math.max(1, Math.min(safePage, safePageCount));
}

function normalizeWorldBookIds(nextIds) {
  const normalizedIds = [];
  for (const id of Array.isArray(nextIds) ? nextIds : []) {
    normalizedIds.push(String(id || ''));
  }
  return normalizedIds;
}

function setSelectedWorldBookIdsFromBooksIfChanged(nextBooks) {
  const nextIds = [];
  for (const book of Array.isArray(nextBooks) ? nextBooks : []) {
    nextIds.push(book?.id);
  }
  return setSelectedWorldBookIdsIfChanged(nextIds);
}

function setSelectedWorldBookIdsIfChanged(nextIds) {
  const normalizedIds = normalizeWorldBookIds(nextIds);
  if (sameListItems(selectedWorldBookIds.value, normalizedIds, Object.is)) {
    return false;
  }
  selectedWorldBookIds.value = normalizedIds;
  return true;
}

function setAiToolCallsIfChanged(nextToolCalls) {
  return setAiPlainListIfChanged(aiToolCalls, nextToolCalls);
}

function setAiProcessIfChanged(nextProcess) {
  return setAiPlainListIfChanged(aiProcess, nextProcess);
}

function setAiModSuggestionsIfChanged(nextSuggestions) {
  return setAiPlainListIfChanged(aiModSuggestions, nextSuggestions);
}

function setAiPlainListIfChanged(listRef, nextItems) {
  const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
  if (sameListItems(listRef.value, normalizedItems, samePlainValue)) {
    return false;
  }
  listRef.value = normalizedItems;
  return true;
}

function sameListItems(currentItems, nextItems, sameItem) {
  const currentList = Array.isArray(currentItems) ? currentItems : [];
  const nextList = Array.isArray(nextItems) ? nextItems : [];
  if (currentList === nextList) {
    return true;
  }
  if (currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!sameItem(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}

function sameWorldBookOption(current = {}, next = {}) {
  return String(current?.id || '') === String(next?.id || '')
    && String(current?.name || '') === String(next?.name || '')
    && String(current?.description || '') === String(next?.description || '')
    && String(current?.characterId || '') === String(next?.characterId || '')
    && Number(current?.scanDepth || 4) === Number(next?.scanDepth || 4)
    && Number(current?.lorebookContextPercent || 25) === Number(next?.lorebookContextPercent || 25)
    && Number(current?.entryCount || 0) === Number(next?.entryCount || 0);
}

function sameTagOption(current = {}, next = {}) {
  return String(current?.id || '') === String(next?.id || '')
    && String(current?.name || '') === String(next?.name || '')
    && String(current?.color || '') === String(next?.color || '')
    && Number(current?.usageCount || 0) === Number(next?.usageCount || 0);
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
    notify.success(editing ? '角色已保存' : '角色已创建');
    emit('navigate', 'characterEdit', { id: saved.id });
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

async function completeWithAi() {
  if (characterAiActionBusy.value) return;
  const requirement = aiRequirement.value.trim();
  if (!canRunAiWithContext(requirement, '请先写一点角色要求，或开启“结合当前已填写内容”。')) {
    return;
  }

  aiLoading.value = true;
  setAiToolCallsIfChanged([]);
  setAiProcessIfChanged([{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }]);
  aiReasoning.value = '';
  setAiModSuggestionsIfChanged([]);
  const abortController = new AbortController();
  aiAbortController.value = abortController;
  try {
    const result = await streamCharacterDraft({
      requirement,
      character: getAiCurrentCharacter(),
      modelOverride: assistantModel.value.trim(),
      options: { ...aiOptions, optimizeExisting: aiUseCurrentDraft.value }
    }, aiStreamHandlers(() => isCurrentCharacterAiRun(abortController)), abortController.signal);
    if (!isCurrentCharacterAiRun(abortController)) return;
    if (result?.aborted) {
      notify.info('AI 生成已暂停');
      return;
    }
    applyAiDraft(result.character || {}, {
      enabledSections: { ...aiOptions },
      applyEmptyValues: aiUseCurrentDraft.value
    });
    setAiModSuggestionsIfChanged(result.character?.modSuggestions);
    setAiToolCallsIfChanged(result.toolCalls);
    setAiProcessIfChanged(result.process);
    aiReasoning.value = result.reasoning || '';
    notify.success(`AI 已完善设定，调用 ${aiToolCalls.value.length} 次工具`);
  } catch (err) {
    if (!isCurrentCharacterAiRun(abortController)) return;
    if (abortController.signal.aborted || err.name === 'AbortError') {
      notify.info('AI 生成已暂停');
      return;
    }
    setAiProcessIfChanged([{ round: 1, reasoning: err.message, content: '', tools: [] }]);
    notify.error(err.message);
  } finally {
    if (isCurrentCharacterAiRun(abortController)) {
      aiLoading.value = false;
      aiAbortController.value = null;
    }
  }
}

function stopCharacterAi() {
  aiAbortController.value?.abort();
}

function isCurrentCharacterAiRun(abortController) {
  return !characterFormDisposed && aiAbortController.value === abortController;
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
    notify.success('角色已删除');
    emit('navigate', 'home');
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

function addRule() {
  if (!canEdit.value) {
    return;
  }

  form.regexRules.push({
    label: `规则 ${form.regexRules.length + 1}`,
    pattern: '',
    replacement: '',
    flags: 'g',
    scope: 'input',
    enabled: true,
    groupName: '全局',
    priority: 0
  });
}

function removeRule(index) {
  if (!canEdit.value) {
    return;
  }

  form.regexRules.splice(index, 1);
}

function addRenderPlugin(preset = false) {
  if (!canEdit.value) {
    return;
  }

  form.renderPlugins.push({
    ...defaultRenderPlugin(),
    label: preset ? '档案标题折叠' : `渲染插件 ${form.renderPlugins.length + 1}`,
    pattern: preset ? defaultRenderPlugin().pattern : ''
  });
}

function removeRenderPlugin(index) {
  if (!canEdit.value) {
    return;
  }

  form.renderPlugins.splice(index, 1);
}

function insertUserVariable(field) {
  if (!canEdit.value || typeof form[field] !== 'string') {
    return;
  }
  form[field] = form[field] ? `${form[field]}{user}` : '{user}';
}

async function handleAvatar(event) {
  if (characterFormDisposed || !canEdit.value) {
    return;
  }

  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file) {
    return;
  }

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    notify.warning('头像仅支持 PNG、JPG 或 WebP');
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    notify.warning('头像不能超过 2MB');
    return;
  }

  const uploadToken = ++avatarUploadToken;
  try {
    const result = await readFileAsDataUrl(file, '头像读取失败');
    if (!isCurrentAvatarUpload(uploadToken)) {
      return;
    }
    form.avatarUrl = result;
  } catch (err) {
    if (!isCurrentAvatarUpload(uploadToken)) {
      return;
    }
    notify.warning(err.message || '头像读取失败');
  }
}

function isCurrentAvatarUpload(uploadToken) {
  return !characterFormDisposed && uploadToken === avatarUploadToken;
}

async function handleAdvancedBackground(event, field) {
  if (characterFormDisposed || !canEdit.value || !ADVANCED_BACKGROUND_FIELDS.has(field)) {
    return;
  }

  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file) {
    return;
  }

  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    notify.warning('背景图片仅支持 PNG、JPG、WebP 或 GIF');
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    notify.warning('背景图片不能超过 4MB');
    return;
  }

  backgroundUploading[field] = true;
  const uploadToken = nextBackgroundUploadToken(field);
  try {
    const result = await readFileAsDataUrl(file, '背景图片读取失败');
    if (!isCurrentBackgroundUpload(field, uploadToken)) {
      return;
    }
    form.authorAdvancedSettings[field] = result;
    notify.success('背景图片已读取，保存角色后会生成短链');
  } catch (err) {
    if (!isCurrentBackgroundUpload(field, uploadToken)) {
      return;
    }
    notify.warning(err.message || '背景图片读取失败');
  } finally {
    if (isCurrentBackgroundUpload(field, uploadToken)) {
      backgroundUploading[field] = false;
    }
  }
}

function clearAdvancedBackground(field) {
  if (!canEdit.value || !ADVANCED_BACKGROUND_FIELDS.has(field)) {
    return;
  }
  nextBackgroundUploadToken(field);
  backgroundUploading[field] = false;
  form.authorAdvancedSettings[field] = '';
}

function nextBackgroundUploadToken(field) {
  const key = String(field || '');
  const nextToken = (backgroundUploadTokens[key] || 0) + 1;
  backgroundUploadTokens[key] = nextToken;
  return nextToken;
}

function isCurrentBackgroundUpload(field, uploadToken) {
  return !characterFormDisposed && backgroundUploadTokens[String(field || '')] === uploadToken;
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
      customJs: form.authorAdvancedSettings.customJs,
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

function parseTagsTextForPayload(value = '') {
  const tags = [];
  const source = String(value || '');
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source[index] !== ',') {
      continue;
    }
    const tag = source.slice(start, index).trim();
    if (tag) {
      tags.push(tag);
    }
    start = index + 1;
  }
  return tags;
}

function toggleTagSelection(name) {
  if (!canEdit.value || tagCreating.value) {
    return;
  }
  const idx = form.selectedTags.indexOf(name);
  if (idx >= 0) {
    form.selectedTags.splice(idx, 1);
  } else {
    form.selectedTags.push(name);
  }
}

function toggleWorldBook(bookId) {
  if (!canEdit.value) {
    return;
  }
  const normalizedId = String(bookId || '');
  if (!normalizedId) {
    return;
  }
  const currentIds = selectedWorldBookIds.value;
  const nextIds = [];
  let removedSelectedId = false;
  for (const id of currentIds) {
    if (id === normalizedId) {
      removedSelectedId = true;
      continue;
    }
    nextIds.push(id);
  }
  if (!removedSelectedId) {
    nextIds.push(normalizedId);
  }
  setSelectedWorldBookIdsIfChanged(nextIds);
}

function openWorldBookDialog() {
  if (!worldBooks.value.length) {
    return;
  }
  showWorldBookDialog.value = true;
  setWorldBookPage(worldBookPage.value);
}

function closeWorldBookDialog() {
  showWorldBookDialog.value = false;
}

function clearWorldBookSearch() {
  worldBookSearch.value = '';
  setWorldBookPage(1);
}

function setWorldBookPage(page) {
  const nextPage = clampWorldBookPage(page, worldBookPageCount.value);
  if (worldBookPage.value !== nextPage) {
    worldBookPage.value = nextPage;
  }
}

async function createSuggestedMods() {
  if (characterFormDisposed || suggestedModsCreating.value) return;
  const sourceSuggestions = aiModSuggestions.value;
  if (!aiModSuggestions.value.length) {
    notify.warning('没有可创建的 AI Mod 建议');
    return;
  }
  const createToken = ++suggestedModCreateToken;
  const suggestions = [...sourceSuggestions];
  suggestedModsCreating.value = true;
  try {
    for (const mod of suggestions) {
      if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
      await createMod({
        name: mod.name,
        description: mod.description || '',
        type: normalizeModType(mod.type),
        content: mod.content,
        enabled: mod.enabled !== false
      });
      if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
    }
    notify.success(`已创建 ${suggestions.length} 个 Mod`);
    setAiModSuggestionsIfChanged([]);
  } catch (err) {
    if (!isCurrentSuggestedModCreate(createToken, sourceSuggestions)) return;
    notify.error(err.message);
  } finally {
    if (isActiveSuggestedModCreate(createToken)) {
      suggestedModsCreating.value = false;
    }
  }
}

function isActiveSuggestedModCreate(createToken) {
  return !characterFormDisposed && createToken === suggestedModCreateToken;
}

function isCurrentSuggestedModCreate(createToken, sourceSuggestions) {
  return isActiveSuggestedModCreate(createToken)
    && aiModSuggestions.value === sourceSuggestions;
}

function normalizeModType(type) {
  if (['prompt_inject', 'style_enhance', 'custom'].includes(type)) return type;
  if (type === 'style') return 'style_enhance';
  return 'prompt_inject';
}

function aiStreamHandlers(isCurrent = () => !characterFormDisposed) {
  return {
    step: (step = {}) => {
      if (!isCurrent()) return;
      updateAiProcessStep(step.round || 1, (target) => ({
        ...target,
        ...step,
        content: target.content || step.content || '',
        reasoning: target.reasoning === '等待模型响应...' ? step.reasoning || '' : target.reasoning || step.reasoning || '',
        tools: target.tools?.length ? target.tools : cloneAiToolList(step.tools)
      }));
    },
    reasoning: ({ round = 1, text = '' } = {}) => {
      if (!isCurrent()) return;
      updateAiProcessStep(round, (target) => ({
        ...target,
        reasoning: `${target.reasoning === '等待模型响应...' ? '' : target.reasoning || ''}${text}`
      }));
      aiReasoning.value += text;
    },
    content: ({ round = 1, text = '' } = {}) => {
      if (!isCurrent()) return;
      updateAiProcessStep(round, (target) => ({
        ...target,
        content: `${target.content || ''}${text}`
      }));
    },
    nudge: ({ round = 1, text = '' } = {}) => {
      if (!isCurrent()) return;
      updateAiProcessStep(round, (target) => ({
        ...target,
        content: `${target.content || ''}${target.content ? '\n\n' : ''}系统提醒：${text}`
      }));
    },
    tool: (call = {}) => {
      if (!isCurrent()) return;
      const log = {
        name: call.name,
        arguments: call.arguments,
        result: call.result
      };
      updateAiProcessStep(call.round || 1, (target) => ({
        ...target,
        tools: appendAiToolList(target.tools, log)
      }));
      appendAiToolCall(log);
    }
  };
}

function updateAiProcessStep(round = 1, updateStep) {
  const currentProcess = Array.isArray(aiProcess.value) ? aiProcess.value : [];
  let stepIndex = -1;
  for (let index = 0; index < currentProcess.length; index += 1) {
    if (currentProcess[index]?.round === round) {
      stepIndex = index;
      break;
    }
  }
  const currentStep = stepIndex >= 0
    ? currentProcess[stepIndex]
    : { round, reasoning: '', content: '', tools: [] };
  const nextStep = updateStep({
    ...currentStep,
    tools: cloneAiToolList(currentStep.tools)
  });
  const nextProcess = [];
  for (let index = 0; index < currentProcess.length; index += 1) {
    nextProcess.push(index === stepIndex ? nextStep : currentProcess[index]);
  }
  if (stepIndex < 0) {
    nextProcess.push(nextStep);
  }
  setAiProcessIfChanged(nextProcess);
}

function appendAiToolCall(log) {
  const currentToolCalls = Array.isArray(aiToolCalls.value) ? aiToolCalls.value : [];
  const nextToolCalls = [];
  for (const toolCall of currentToolCalls) {
    nextToolCalls.push(toolCall);
  }
  nextToolCalls.push(log);
  setAiToolCallsIfChanged(nextToolCalls);
}

function formatAiValue(value) {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolResultLabel(result = {}) {
  if (result?.ok === false) return result.error || '失败';
  if (typeof result?.count === 'number') return `写入 ${result.count} 项`;
  if (result?.applied && typeof result.applied === 'object') return `更新 ${countOwnObjectKeys(result.applied)} 项`;
  if (result?.rule?.label) return `规则：${result.rule.label}`;
  return result?.ok === true ? '成功' : '已返回';
}

async function completeAdvancedSettingsWithAi() {
  if (characterAiActionBusy.value) return;
  const requirement = advancedAiRequirement.value.trim() || aiRequirement.value.trim();
  if (!canRunAiWithContext(requirement, '请先写一点高阶设置目标，或开启“结合当前已填写内容”。')) {
    return;
  }

  advancedAiLoading.value = true;
  setAiProcessIfChanged([{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }]);
  aiReasoning.value = '';
  setAiToolCallsIfChanged([]);
  const abortController = new AbortController();
  advancedAiAbortController.value = abortController;
  try {
    const result = await streamCharacterDraft({
      requirement,
      character: getAiCurrentCharacter(),
      modelOverride: assistantModel.value.trim(),
      options: {
        profile: false,
        background: false,
        worldview: false,
        persona: false,
        openingMessage: false,
        tags: false,
        regexRules: false,
        renderPlugins: false,
        worldBookSuggestion: false,
        advancedSettings: true,
        modSuggestions: false,
        optimizeExisting: aiUseCurrentDraft.value
      }
    }, aiStreamHandlers(() => isCurrentAdvancedAiRun(abortController)), abortController.signal);
    if (!isCurrentAdvancedAiRun(abortController)) return;
    if (result?.aborted) {
      notify.info('AI 高阶设置生成已暂停');
      return;
    }
    applyAiDraft(result.character || {}, {
      enabledSections: {
        profile: false,
        background: false,
        worldview: false,
        persona: false,
        openingMessage: false,
        tags: false,
        regexRules: false,
        renderPlugins: false,
        worldBookSuggestion: false,
        advancedSettings: true,
        modSuggestions: false
      },
      applyEmptyValues: aiUseCurrentDraft.value
    });
    setAiToolCallsIfChanged(result.toolCalls);
    setAiProcessIfChanged(result.process);
    aiReasoning.value = result.reasoning || '';
    notify.success('AI 已完善高阶设置');
  } catch (err) {
    if (!isCurrentAdvancedAiRun(abortController)) return;
    if (abortController.signal.aborted || err.name === 'AbortError') {
      notify.info('AI 高阶设置生成已暂停');
      return;
    }
    setAiProcessIfChanged([{ round: 1, reasoning: err.message, content: '', tools: [] }]);
    notify.error(err.message);
  } finally {
    if (isCurrentAdvancedAiRun(abortController)) {
      advancedAiLoading.value = false;
      advancedAiAbortController.value = null;
    }
  }
}

function stopAdvancedAi() {
  advancedAiAbortController.value?.abort();
}

function isCurrentAdvancedAiRun(abortController) {
  return !characterFormDisposed && advancedAiAbortController.value === abortController;
}

async function createAndSelectTag() {
  if (characterFormDisposed || tagCreating.value || !canEdit.value) return;
  const name = tagSearch.value.trim();
  if (!name) return;
  if (form.selectedTags.includes(name)) return;
  const createToken = ++tagCreateToken;
  tagCreating.value = true;
  try {
    const tag = await createTag({ name });
    if (!isCurrentTagCreate(createToken, name)) return;
    appendAvailableTagIfMissing(tag);
    if (!form.selectedTags.includes(name)) {
      form.selectedTags.push(name);
    }
    tagSearch.value = '';
  } catch (err) {
    if (!isCurrentTagCreate(createToken, name)) return;
    notify.error(err.message);
  } finally {
    if (isActiveTagCreate(createToken)) {
      tagCreating.value = false;
    }
  }
}

function isCurrentTagCreate(createToken, name) {
  return isActiveTagCreate(createToken)
    && tagSearch.value.trim() === name;
}

function isActiveTagCreate(createToken) {
  return !characterFormDisposed && createToken === tagCreateToken;
}

function getAiCurrentCharacter() {
  return aiUseCurrentDraft.value ? toPayload() : {};
}

function canRunAiWithContext(requirement, message) {
  if (requirement) {
    return true;
  }
  if (aiUseCurrentDraft.value && hasDraftSeed()) {
    return true;
  }
  notify.warning(message);
  return false;
}

function applyAiDraft(character = {}, { enabledSections = {}, applyEmptyValues = true } = {}) {
  const fieldSections = {
    name: 'profile',
    avatarUrl: 'profile',
    gender: 'profile',
    age: 'profile',
    visibility: 'profile',
    background: 'background',
    worldview: 'worldview',
    persona: 'persona',
    openingMessage: 'openingMessage'
  };
  for (const key of ['name', 'avatarUrl', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage', 'visibility']) {
    const section = fieldSections[key];
    if (
      isAiSectionEnabled(enabledSections, section) &&
      Object.prototype.hasOwnProperty.call(character, key) &&
      shouldApplyAiValue(character[key], { applyEmptyValues, key })
    ) {
      form[key] = character[key] || '';
    }
  }
  if (isAiSectionEnabled(enabledSections, 'tags') && Array.isArray(character.tags) && (applyEmptyValues || character.tags.length)) {
    form.tagsText = character.tags.join(', ');
  }
  if (isAiSectionEnabled(enabledSections, 'regexRules') && Array.isArray(character.regexRules) && (applyEmptyValues || character.regexRules.length)) {
    form.regexRules = character.regexRules;
  }
  if (isAiSectionEnabled(enabledSections, 'renderPlugins') && Array.isArray(character.renderPlugins) && (applyEmptyValues || character.renderPlugins.length)) {
    form.renderPlugins = character.renderPlugins;
  }
  if (isAiSectionEnabled(enabledSections, 'advancedSettings') && (character.authorAdvancedSettings || character.advancedSettings)) {
    const nextSettings = character.authorAdvancedSettings || character.advancedSettings;
    applyAdvancedSettingsDraft(nextSettings, { applyEmptyValues });
  }
}

function isAiSectionEnabled(sections = {}, key) {
  return sections[key] !== false;
}

function shouldApplyAiValue(value, { applyEmptyValues = true, key = '' } = {}) {
  if (applyEmptyValues) {
    return true;
  }
  if (key === 'visibility') {
    return value === 'public';
  }
  return String(value || '').trim().length > 0;
}

function hasDraftSeed() {
  const payload = toPayload();
  if (hasDraftSeedText(payload)) {
    return true;
  }
  return (Array.isArray(payload.tags) && payload.tags.length > 0)
    || (Array.isArray(payload.regexRules) && payload.regexRules.length > 0);
}

function hasDraftSeedText(payload = {}) {
  for (const key of AI_DRAFT_SEED_FIELDS) {
    if (String(payload[key] || '').trim()) {
      return true;
    }
  }
  return false;
}

function emptyCharacter() {
  return {
    name: '',
    avatarUrl: '',
    gender: '',
    age: '',
    background: '',
    worldview: '',
    persona: '',
    openingMessage: '',
    visibility: 'private',
    tagsText: '',
    selectedTags: [],
    worldBookId: '',
    renderPlugins: [defaultRenderPlugin()],
    authorAdvancedSettings: {
      desktopBackgroundUrl: '',
      mobileBackgroundUrl: '',
      customCss: '',
      customJs: '',
      statusBarPrompt: '',
      statusBarBlueprint: createDefaultStatusBarBlueprint(),
      accessorySkills: createDefaultAccessorySkills()
    },
    regexRules: [],
    canEdit: true,
    canUse: true,
    isOwner: true
  };
}

function defaultRenderPlugin() {
  return {
    label: '档案标题折叠',
    type: 'fold',
    pattern: '^[>▸▾▶▼◆◇✦✧★☆*+\\-\\s]*[【\\[]([^】\\]\\n]*(?:档案|情报|状态栏|记忆栏|设定|剧情|世界观|摘要|面板|资料)[^】\\]\\n]*)[】\\]][◆◇✦✧★☆*+\\-\\s]*$',
    flags: 'u',
    titleTemplate: '$1',
    enabled: true
  };
}

function createDefaultAccessorySkills() {
  return {
    npcAgent: { enabled: false, modelOverride: '' },
    statusBarAgent: { enabled: 'auto', modelOverride: '' },
    economyAgent: { enabled: false, modelOverride: '' },
    talentPrompt: { enabled: false, modelOverride: '' },
    cgScene: { enabled: false, modelOverride: '' }
  };
}

function normalizeAccessorySkillsForPayload(input = {}) {
  const defaults = createDefaultAccessorySkills();
  const normalized = {};
  for (const key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue;
    const source = input?.[key] || {};
    normalized[key] = {
      enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
      modelOverride: String(source.modelOverride || source.model_override || '').trim()
    };
  }
  return normalized;
}

function createDefaultStatusBarBlueprint() {
  return {
    name: '',
    variables: [],
    template: ''
  };
}

function ensureStatusBlueprint() {
  if (!form.authorAdvancedSettings.statusBarBlueprint || typeof form.authorAdvancedSettings.statusBarBlueprint !== 'object') {
    form.authorAdvancedSettings.statusBarBlueprint = createDefaultStatusBarBlueprint();
  }
  if (!Array.isArray(form.authorAdvancedSettings.statusBarBlueprint.variables)) {
    form.authorAdvancedSettings.statusBarBlueprint.variables = [];
  }
  return form.authorAdvancedSettings.statusBarBlueprint;
}

function syncStatusBlueprintVariablesFromTemplate({ notifyUser = false } = {}) {
  const blueprint = ensureStatusBlueprint();
  if (!blueprint || typeof blueprint !== 'object') {
    return;
  }
  const normalized = normalizeStatusBarBlueprintForPayload(blueprint);
  const changed = !sameStatusVariableList(blueprint.variables, normalized.variables);
  if (changed) {
    blueprint.variables = cloneStatusVariableList(normalized.variables);
  }
  if (notifyUser) {
    notify.success(changed ? '已重新同步模板变量' : '变量已是最新');
  }
}

function refreshStatusBlueprintVariables() {
  if (!canEdit.value) {
    return;
  }
  syncStatusBlueprintVariablesFromTemplate({ notifyUser: true });
}

function applyStatusBlueprintSampleTemplate() {
  if (!canEdit.value) {
    return;
  }
  const blueprint = ensureStatusBlueprint();
  if (!String(blueprint.name || '').trim()) {
    blueprint.name = '状态栏';
  }
  blueprint.template = STATUS_BLUEPRINT_SAMPLE_TEMPLATE;
  syncStatusBlueprintVariablesFromTemplate();
  notify.success('已套用示例模板并同步变量');
}

function clearStatusBlueprintTemplate() {
  if (!canEdit.value) {
    return;
  }
  const blueprint = ensureStatusBlueprint();
  if (!String(blueprint.template || '').trim()) {
    notify.info('模板已经是空的');
    return;
  }
  blueprint.template = '';
  syncStatusBlueprintVariablesFromTemplate();
  notify.success('已清空模板，变量仍保留');
}

function normalizeStatusBarBlueprintForPayload(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const template = String(source.template || '').trim();
  const variables = normalizeStatusVariableListForPayload(source.variables, template);
  return {
    name: String(source.name || '').trim(),
    variables: inferStatusVariablesFromTemplate(template, variables),
    template
  };
}

function normalizeStatusVariableListForPayload(variables = [], template = '') {
  const normalizedVariables = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    const normalized = normalizeStatusVariableForPayload(variable, template);
    if (normalized.name && !isCompositeStatusPlaceholderValue(normalized.value, normalized.name)) {
      normalizedVariables.push(normalized);
    }
  }
  return normalizedVariables;
}

function normalizeStatusVariableForPayload(variable = {}, template = '') {
  const name = String(variable?.name || '').trim();
  if (!name) {
    return { name: '', value: '' };
  }
  if (!shouldTreatStatusVariableAsMeter(variable, template)) {
    return {
      name,
      value: normalizeStatusTextVariableValue(variable?.value)
    };
  }
  return {
    name,
    value: normalizeStatusMeterVariableValue(variable?.value),
    max: normalizeStatusMeterMax(variable?.max),
    color: normalizeHexColor(variable?.color)
  };
}

function isStatusBlueprintMeterVariable(variable = {}) {
  return shouldTreatStatusVariableAsMeter(variable, form.authorAdvancedSettings.statusBarBlueprint.template);
}

function getStatusBlueprintVariableValue(name = '') {
  const variable = findStatusBlueprintVariable(name);
  return variable ? String(variable.value ?? '') : '';
}

function setStatusBlueprintVariableValue(name = '', value = '') {
  if (!canEdit.value) {
    return;
  }
  const normalizedName = normalizeTemplateVariableName(name);
  if (!normalizedName) {
    return;
  }
  const blueprint = ensureStatusBlueprint();
  let variable = findStatusBlueprintVariable(normalizedName);
  if (!variable) {
    variable = { name: normalizedName, value: '' };
    blueprint.variables.push(variable);
  }
  variable.value = normalizeStatusTextVariableValue(value);
  delete variable.max;
  delete variable.color;
}

function findStatusBlueprintVariable(name = '') {
  const key = normalizeStatusVariableKey(name);
  const blueprint = form.authorAdvancedSettings.statusBarBlueprint || {};
  const variables = Array.isArray(blueprint.variables) ? blueprint.variables : [];
  return variables.find((variable) => normalizeStatusVariableKey(variable?.name) === key) || null;
}

function setStatusBlueprintVariableMode(variable, mode) {
  if (!canEdit.value || !variable || typeof variable !== 'object') {
    return;
  }
  if (mode === 'meter') {
    variable.value = normalizeStatusMeterVariableValue(variable.value);
    variable.max = normalizeStatusMeterMax(variable.max);
    variable.color = normalizeHexColor(variable.color);
    return;
  }
  variable.value = normalizeStatusTextVariableValue(variable.value) || defaultStatusTextValueForName(variable.name);
  delete variable.max;
  delete variable.color;
}

function shouldTreatStatusVariableAsMeter(variable = {}, template = '') {
  const name = String(variable?.name || '').trim();
  if (!name) {
    return false;
  }
  const usage = getStatusVariableTemplateUsage(template, name);
  if (usage.meter) {
    return true;
  }
  if (usage.text) {
    return false;
  }
  const value = normalizeStatusVariableValue(variable?.value);
  return typeof value === 'number' && Number.isFinite(Number(variable?.max));
}

function getStatusVariableTemplateUsage(template = '', name = '') {
  const target = normalizeStatusVariableKey(name);
  const usage = { meter: false, text: false };
  if (!target) {
    return usage;
  }
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(String(template || '')))) {
    const token = String(match[1] || match[2] || '').trim();
    const [tokenName, ...propertyParts] = token.split('.');
    if (normalizeStatusVariableKey(tokenName) !== target) {
      continue;
    }
    const property = propertyParts.join('.').trim();
    if (isStatusMeterPlaceholderProperty(property)) {
      usage.meter = true;
    } else {
      usage.text = true;
    }
  }
  return usage;
}

function isStatusMeterPlaceholderProperty(property = '') {
  return ['max', 'percent', 'color', 'display'].includes(String(property || '').trim());
}

function countStatusTemplatePlaceholders(template = '') {
  return (String(template || '').match(/\{\{\s*[^{}]+?\s*\}\}|\{[\w\u4e00-\u9fa5 ._-]+\}/g) || []).length;
}

function countStatusTemplateActions(template = '') {
  return (String(template || '').match(/\bdata-sb-action\s*=/gi) || []).length;
}

function collectInferredStatusVariableKeys(template = '') {
  const inferredKeys = new Set();
  for (const variable of inferStatusVariablesFromTemplate(template, [])) {
    inferredKeys.add(normalizeStatusVariableKey(variable.name));
  }
  return inferredKeys;
}

function countStatusBlueprintVariableStats(variables = [], template = '') {
  const inferredKeys = collectInferredStatusVariableKeys(template);
  const stats = { inferred: 0, meter: 0 };
  for (const variable of Array.isArray(variables) ? variables : []) {
    if (inferredKeys.has(normalizeStatusVariableKey(variable?.name))) {
      stats.inferred += 1;
    }
    if (shouldTreatStatusVariableAsMeter(variable, template)) {
      stats.meter += 1;
    }
  }
  return stats;
}

function normalizeStatusTextVariableValue(value) {
  const text = String(value ?? '').trim();
  return text.length > 200 ? text.slice(0, 200) : text;
}

function normalizeStatusMeterVariableValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStatusMeterMax(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 100;
}

function normalizeStatusVariableValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && /^[-+]?(?:\d+|\d*\.\d+)$/.test(text)) {
    return numeric;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

function inferStatusVariablesFromTemplate(template, variables = []) {
  const inferred = dedupeStatusVariables(variables, template);
  const seen = collectStatusVariableKeys(inferred);
  for (const item of extractTemplateRowVariables(template)) {
    const key = normalizeStatusVariableKey(item.name);
    if (!seen.has(key)) {
      inferred.push(item);
      seen.add(key);
    }
  }
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(String(template || '')))) {
    const token = String(match[1] || match[2] || '').trim();
    const name = normalizeTemplateVariableName(token.split('.')[0]);
    const key = normalizeStatusVariableKey(name);
    if (!name || seen.has(key)) {
      continue;
    }
    inferred.push(
      shouldTreatStatusVariableAsMeter({ name }, template)
        ? { name: name.slice(0, 40), value: 0, max: 100, color: '#6c757d' }
        : { name: name.slice(0, 40), value: defaultStatusTextValueForName(name) }
    );
    seen.add(key);
    if (inferred.length >= STATUS_BLUEPRINT_VARIABLE_LIMIT) {
      break;
    }
  }
  return inferred.slice(0, STATUS_BLUEPRINT_VARIABLE_LIMIT);
}

function collectStatusVariableKeys(variables = []) {
  const keys = new Set();
  for (const item of Array.isArray(variables) ? variables : []) {
    keys.add(normalizeStatusVariableKey(item?.name));
  }
  return keys;
}

function extractTemplateRowVariables(template) {
  const rows = [];
  const seen = new Set();
  const addRow = (rawName, rawValue) => {
    const name = normalizeTemplateVariableName(rawName);
    const key = normalizeStatusVariableKey(name);
    if (!name || !key || seen.has(key)) {
      return;
    }
    if (isCompositeStatusPlaceholderValue(rawValue, name)) {
      return;
    }
    const rawValueText = normalizeHtmlText(rawValue);
    const value = isSelfStatusPlaceholder(rawValueText, name)
      ? defaultStatusTextValueForName(name)
      : normalizeStatusTextVariableValue(rawValueText);
    rows.push({ name, value });
    seen.add(key);
  };

  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(String(template || '')))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(String(template || '')))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function extractStatusTemplateCompositeRows(template) {
  const rows = [];
  const seen = new Set();
  const addRow = (rawLabel, rawValue) => {
    const label = normalizeTemplateVariableName(rawLabel);
    const key = normalizeStatusVariableKey(label);
    if (!label || !key || seen.has(key)) {
      return;
    }
    const parts = extractCompositePlaceholderParts(rawValue, label);
    if (parts.length < 2) {
      return;
    }
    rows.push({ label, parts });
    seen.add(key);
  };

  const rawTemplate = String(template || '');
  const pairPattern = /<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-label\b[^'"]*\1[^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,180}?<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\3[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  let match;
  while ((match = pairPattern.exec(rawTemplate))) {
    addRow(match[2], match[4]);
  }

  const inlineValuePattern = /(?:^|>|\n)([^<>\n]{1,40}?)[\s:\uFF1A]+<[^>]+\bclass\s*=\s*(['"])[^'"]*\bsb-val\b[^'"]*\2[^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((match = inlineValuePattern.exec(rawTemplate))) {
    addRow(match[1], match[3]);
  }
  return rows;
}

function extractCompositePlaceholderParts(value = '', label = '') {
  const parts = [];
  const seen = new Set();
  const labelKey = normalizeStatusVariableKey(label);
  const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\{([\w\u4e00-\u9fa5 ._-]+)\}/g;
  let match;
  while ((match = placeholderPattern.exec(normalizeHtmlText(value)))) {
    const token = String(match[1] || match[2] || '').trim();
    const parsed = parseStatusTemplateToken(token);
    const rawProperty = parsed.rawProperty.trim() || 'value';
    const name = normalizeTemplateVariableName(parsed.rawName.trim());
    const key = normalizeStatusVariableKey(name);
    if (!name || !key || key === labelKey || seen.has(key)) {
      continue;
    }
    if (isMeterTemplateProperty(rawProperty)) {
      continue;
    }
    parts.push({ name });
    seen.add(key);
  }
  return parts;
}

function isMeterTemplateProperty(value = '') {
  return ['max', 'percent', 'percentage'].includes(String(value || '').trim());
}

function isCompositeStatusPlaceholderValue(value = '', name = '') {
  return extractCompositePlaceholderParts(value, name).length >= 2;
}

function isSelfStatusPlaceholder(value = '', name = '') {
  const escaped = escapeRegExp(String(name || '').trim());
  return Boolean(escaped && new RegExp(`^\\{\\{\\s*${escaped}\\s*\\}\\}$`).test(String(value || '').trim()));
}

function defaultStatusTextValueForName(name = '') {
  const text = String(name || '');
  if (/事件/.test(text)) return '故事尚未开始';
  if (/记忆|淡忘/.test(text)) return '暂无';
  if (/情绪/.test(text)) return '平静';
  if (/倾向/.test(text)) return '无特殊';
  if (/伤病|排泄|特殊|随身/.test(text)) return '无';
  return '待定';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupeStatusVariables(variables = [], template = '') {
  const byKey = new Map();
  for (const variable of Array.isArray(variables) ? variables : []) {
    const normalized = normalizeStatusVariableForPayload(variable, template);
    const key = normalizeStatusVariableKey(normalized.name);
    if (!key) {
      continue;
    }
    if (byKey.has(key)) {
      byKey.set(key, mergeStatusVariable(byKey.get(key), normalized, template));
    } else {
      byKey.set(key, normalized);
    }
  }
  return [...byKey.values()];
}

function mergeStatusVariable(current, next, template = '') {
  const useMeter = shouldTreatStatusVariableAsMeter(next, template) || shouldTreatStatusVariableAsMeter(current, template);
  if (useMeter) {
    return {
      name: next.name || current.name,
      value: normalizeStatusMeterVariableValue(next.value ?? current.value),
      max: normalizeStatusMeterMax(next.max ?? current.max),
      color: normalizeHexColor(next.color || current.color)
    };
  }
  return {
    name: next.name || current.name,
    value: normalizeStatusTextVariableValue(next.value || current.value)
  };
}

function normalizeTemplateVariableName(value) {
  return normalizeHtmlText(value)
    .replace(/^[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+|[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);
}

function normalizeStatusVariableKey(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\u3000:\uFF1A;\uFF1B,\uFF0C.\u3002\u3001/\\|()[\]{}"'`~!@#$%^&*_+=?<>-]+/g, '')
    .trim()
    .toLowerCase();
}

function sameStatusVariableList(left = [], right = []) {
  const currentList = Array.isArray(left) ? left : [];
  const nextList = Array.isArray(right) ? right : [];
  if (currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!sameStatusVariableForPayload(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}

function sameStatusVariableForPayload(current, next) {
  const currentVariable = normalizeStatusVariableForPayload(current);
  const nextVariable = normalizeStatusVariableForPayload(next);
  return currentVariable.name === nextVariable.name
    && Object.is(currentVariable.value, nextVariable.value)
    && Object.is(currentVariable.max, nextVariable.max)
    && String(currentVariable.color || '') === String(nextVariable.color || '');
}

function cloneStatusVariableList(variables = []) {
  const clonedVariables = [];
  for (const variable of Array.isArray(variables) ? variables : []) {
    clonedVariables.push({ ...variable });
  }
  return clonedVariables;
}

function normalizeHtmlText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStatusBarTemplateConfig(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed[0] !== '{') {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const cfg = {};
    if (['default', 'compact', 'minimal', 'neon'].includes(parsed.variant)) cfg.variant = parsed.variant;
    if (['default', 'cozy', 'compact'].includes(parsed.density)) cfg.density = parsed.density;
    if (['immersive', 'compact'].includes(parsed.displayMode)) cfg.displayMode = parsed.displayMode;
    if (typeof parsed.accentColor === 'string' && parsed.accentColor.trim()) cfg.accentColor = parsed.accentColor.trim();
    if (typeof parsed.customCss === 'string' && parsed.customCss.trim()) cfg.customCss = parsed.customCss.trim();
    if (Array.isArray(parsed.effects)) {
      cfg.effects = parsed.effects.filter((effect) => ['glow', 'striped', 'pulse'].includes(effect));
    }
    if (Array.isArray(parsed.characters)) {
      cfg.characters = parsed.characters;
    }
    if (Array.isArray(parsed.quickReplies)) {
      cfg.quickReplies = parsed.quickReplies;
    }
    return cfg;
  } catch {
    return {};
  }
}

function normalizeAdvancedSettingsForForm(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    ...emptyCharacter().authorAdvancedSettings,
    ...source,
    statusBarBlueprint: normalizeStatusBarBlueprintForPayload(source.statusBarBlueprint || source.status_bar_blueprint || {}),
    accessorySkills: normalizeAccessorySkillsForPayload(source.accessorySkills)
  };
}

function applyAdvancedSettingsDraft(input = {}, { applyEmptyValues = true } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = normalizeAdvancedSettingsForForm(source);
  for (const key of ['desktopBackgroundUrl', 'mobileBackgroundUrl', 'customCss', 'customJs', 'statusBarPrompt']) {
    if (applyEmptyValues || String(normalized[key] || '').trim()) {
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

function hasStatusBarBlueprintContent(blueprint = {}) {
  return Boolean(
    String(blueprint.name || '').trim() ||
      String(blueprint.template || '').trim() ||
      (Array.isArray(blueprint.variables) && blueprint.variables.length)
  );
}

function hasNonDefaultAccessorySkills(skills = {}) {
  const defaults = createDefaultAccessorySkills();
  for (const key in defaults) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      continue;
    }
    const current = skills?.[key] || {};
    const fallback = defaults[key] || {};
    if (
      normalizeSkillEnabled(current.enabled, fallback.enabled) !== fallback.enabled ||
      String(current.modelOverride || current.model_override || '').trim()
    ) {
      return true;
    }
  }
  return false;
}

function normalizeSkillEnabled(value, fallback = false) {
  if (value === 'auto') return 'auto';
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false' || value === 'off') return false;
  return fallback;
}

function normalizeHexColor(value, fallback = '#6c757d') {
  const normalized = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function setColorValue(target, key, value) {
  if (!target || typeof target !== 'object') {
    return;
  }
  target[key] = normalizeHexColor(value);
}

function readEventTargetValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : undefined;
}

function setStatusBlueprintVariableValueFromEvent(name, event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  setStatusBlueprintVariableValue(name, value);
}

function setStatusBlueprintVariableModeFromEvent(variable, event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  setStatusBlueprintVariableMode(variable, value);
}

function setColorValueFromEvent(target, key, event) {
  const value = readEventTargetValue(event);
  if (value === undefined) {
    return;
  }
  setColorValue(target, key, value);
}

function normalizeForForm(character) {
  return {
    ...emptyCharacter(),
    ...character,
    visibility: character.visibility || 'private',
    worldBookId: character.worldBookId || '',
    canEdit: character.canEdit !== false,
    canUse: character.canUse !== false,
    isOwner: character.isOwner === true,
    tagsText: (character.tags || []).join(', '),
    selectedTags: (character.characterTags || []).map((t) => t.name),
    renderPlugins: character.renderPlugins || [],
    authorAdvancedSettings: {
      ...normalizeAdvancedSettingsForForm(character.authorAdvancedSettings || character.advancedSettings || {})
    },
    regexRules: character.regexRules || []
  };
}

function addStatusBlueprintVariable() {
  if (!canEdit.value) {
    return;
  }
  const blueprint = ensureStatusBlueprint();
  blueprint.variables.push({
    name: `变量 ${blueprint.variables.length + 1}`,
    value: '待定'
  });
}

function removeStatusBlueprintVariable(index) {
  if (!canEdit.value) {
    return;
  }
  form.authorAdvancedSettings.statusBarBlueprint.variables.splice(index, 1);
}

async function handleExport() {
  if (characterFormDisposed || characterFooterActionBusy.value || !isEditing.value) {
    return;
  }

  const exportToken = ++characterExportToken;
  const characterId = editingCharacterId.value;
  exporting.value = true;
  let objectUrl = '';
  try {
    const data = await exportCharacter(characterId);
    if (!isCurrentCharacterExport(exportToken, characterId)) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${data.character?.name || 'character'}.flai-char.json`;
    a.click();
    notify.success('角色卡已导出');
  } catch (err) {
    if (!isCurrentCharacterExport(exportToken, characterId)) return;
    notify.error(err.message);
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
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

function applyLocalRules(text, rules, phase) {
  return rules.reduce((value, rule) => {
    if (!rule.enabled || !rule.pattern || !(rule.scope === phase || rule.scope === 'both')) {
      return value;
    }
    try {
      return value.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '');
    } catch {
      return value;
    }
  }, text);
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
        <button class="ghost-button" type="button" @click="emit('navigate', 'home')">
          <ArrowLeft :size="18" />
          <span>返回首页</span>
        </button>
      </div>
    </section>
    <p v-if="!loading && !loadError" class="permission-note" :class="{ readonly: !canEdit }">{{ permissionText }}</p>

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
        <section id="section-basic" class="form-panel form-section-group character-basic-panel">
          <div class="inline-heading">
            <div>
              <h2>基础信息</h2>
              <p>
                <span class="variable-token">{user}</span>
                <span>当前：{{ userVariableValue }}</span>
              </p>
            </div>
          </div>

          <div class="avatar-editor">
            <div class="large-avatar">
              <img v-if="form.avatarUrl" :src="form.avatarUrl" :alt="form.name" />
              <span v-else>{{ form.name.slice(0, 1) || 'F' }}</span>
            </div>
            <label v-if="canEdit" class="file-button">
              <Upload :size="18" />
              <span>上传头像</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleAvatar" />
            </label>
            <div v-else class="permission-chip">只读展示</div>
          </div>

          <div class="form-grid two-col">
            <div class="field full-span">
              <span>展示权限</span>
              <div class="visibility-picker" :class="{ disabled: !canEdit }">
                <label>
                  <input v-model="form.visibility" type="radio" value="private" :disabled="!canEdit" />
                  <span>
                    私人角色
                    <small>仅拥有者可见、可编辑、可使用</small>
                  </span>
                </label>
                <label>
                  <input v-model="form.visibility" type="radio" value="public" :disabled="!canEdit" />
                  <span>
                    公开角色
                    <small>所有登录用户可查看和使用，仅拥有者可编辑</small>
                  </span>
                </label>
              </div>
            </div>
            <label class="field">
              <span>角色名</span>
              <input v-model.trim="form.name" required maxlength="40" :disabled="!canEdit" />
            </label>
            <div v-if="optionsLoading || optionsLoadError" class="field full-span">
              <p v-if="optionsLoading" class="muted-text" aria-live="polite">正在加载标签和世界书选项...</p>
              <div v-else class="section-load-status error-state" role="alert">
                <span>{{ optionsLoadError }}</span>
                <button class="ghost-button compact-button" type="button" :disabled="optionsLoading" @click="loadFormOptions">
                  <RotateCcw :size="17" />
                  <span>{{ optionsLoading ? '重试中...' : '重试' }}</span>
                </button>
              </div>
            </div>
            <div class="field">
              <span>标签</span>
              <div class="tag-selector" :class="{ disabled: !canEdit || tagCreating }">
                <div v-if="form.selectedTags.length" class="selected-tags">
                  <span
                    v-for="tagName in form.selectedTags"
                    :key="tagName"
                    class="tag-badge removable"
                    @click="canEdit && !tagCreating && toggleTagSelection(tagName)"
                  >
                    {{ tagName }}
                    <span v-if="canEdit && !tagCreating" class="tag-remove">×</span>
                  </span>
                </div>
                <div v-if="canEdit" class="tag-input-row">
                  <input v-model="tagSearch" placeholder="搜索或创建标签..." class="tag-search-input" aria-label="搜索或创建角色标签" :disabled="tagCreating" :aria-busy="tagCreating" />
                  <button
                    v-if="canCreateSearchedTag"
                    class="ghost-button tag-create-btn"
                    type="button"
                    :disabled="tagCreating"
                    :aria-busy="tagCreating"
                    @click="createAndSelectTag"
                  >
                    <Plus :size="14" />
                    {{ tagCreating ? '创建中...' : '创建' }}
                  </button>
                </div>
                <div v-if="canEdit && tagSearch.trim()" class="tag-dropdown">
                  <button
                    v-for="tag in filteredTags"
                    :key="tag.id"
                    class="tag-option"
                    :class="{ selected: form.selectedTags.includes(tag.name) }"
                    type="button"
                    :disabled="tagCreating"
                    @click="toggleTagSelection(tag.name)"
                  >
                    {{ tag.name }}
                    <span v-if="form.selectedTags.includes(tag.name)" class="tag-check">✓</span>
                  </button>
                  <p v-if="!filteredTags.length" class="muted-text tag-empty">无匹配标签</p>
                </div>
              </div>
              <small v-if="!optionsLoadError" class="muted-text">选择已有标签或输入新标签名创建</small>
              <small v-else class="muted-text">选项加载失败时仍可输入新标签，重试后可查看已有标签和世界书。</small>
            </div>
            <div class="field full-span world-book-field">
              <div class="field-heading compact">
                <span>关联世界书</span>
                <small v-if="worldBooks.length">{{ worldBooks.length }} 本可选</small>
              </div>
              <div class="world-book-picker">
                <button
                  class="world-book-picker-button"
                  type="button"
                  :disabled="optionsLoading || !worldBooks.length"
                  @click="openWorldBookDialog"
                >
                  <ListChecks :size="17" />
                  <span>{{ selectedWorldBookIds.length ? `已关联 ${selectedWorldBookIds.length} 本世界书` : '选择世界书' }}</span>
                </button>
                <div v-if="selectedWorldBookPreview.length" class="world-book-selected-preview" aria-live="polite">
                  <button
                    v-for="book in selectedWorldBookPreview"
                    :key="book.id"
                    class="world-book-selected-chip"
                    type="button"
                    :disabled="!canEdit"
                    :title="canEdit ? `取消关联：${book.name}` : book.name"
                    @click="toggleWorldBook(book.id)"
                  >
                    <span>{{ book.name }}</span>
                    <small>{{ book.entryCount || 0 }} 条目</small>
                    <X v-if="canEdit" :size="12" />
                  </button>
                  <span v-if="hiddenSelectedWorldBookCount" class="world-book-selected-more">
                    +{{ hiddenSelectedWorldBookCount }}
                  </span>
                </div>
                <small v-if="selectedWorldBookIds.length" class="muted-text">已选世界书会按角色绑定顺序注入。</small>
                <small v-else-if="worldBooks.length" class="muted-text">选择世界书后，对话中触发词匹配时会自动注入设定。</small>
                <small v-else-if="!optionsLoading && !optionsLoadError" class="muted-text">还没有世界书，去 <a href="#/world-books">世界书管理</a> 创建</small>
              </div>
            </div>
            <label class="field">
              <span>性别</span>
              <input v-model.trim="form.gender" maxlength="24" :disabled="!canEdit" />
            </label>
            <label class="field">
              <span>年龄</span>
              <input v-model.trim="form.age" maxlength="24" :disabled="!canEdit" />
            </label>
          </div>
        </section>

        <section id="section-settings" class="form-panel form-section-group character-settings-panel">
          <h3 class="form-section-title">角色设定</h3>
          <p class="form-section-desc">定义角色的背景、世界观、人设和开场白。支持 <span class="variable-token">{user}</span> 变量替换。</p>

          <div class="field">
            <div class="field-heading">
              <span>背景</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('background')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.background"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              aria-label="角色背景内容"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>世界观</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('worldview')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.worldview"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              aria-label="角色世界观内容"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>人设</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('persona')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.persona"
              :rows="5"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              aria-label="角色人设内容"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>开场白</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('openingMessage')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.openingMessage"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              aria-label="角色开场白内容"
              placeholder=""
            />
          </div>
        </section>
      </div>

      <div class="editor-side">
        <div id="section-advanced" class="form-section-group-advanced">
        <section
          v-if="canEdit"
          id="section-ai"
          ref="aiPanelRef"
          class="form-panel ai-draft-panel"
          :class="{ 'ai-panel-dragging': aiPanelDragging }"
          :style="{ '--ai-panel-x': aiPanelPos.x + 'px', '--ai-panel-y': aiPanelPos.y + 'px', '--ai-panel-w': aiPanelSize.w + 'px', '--ai-panel-h': aiPanelSize.h + 'px' }"
        >
          <div class="inline-heading ai-panel-heading" @pointerdown="onAiPanelDragStart">
            <div>
              <h2>AI 完善设定</h2>
              <p>按你的要求自动补全角色字段和正则规则。</p>
            </div>
            <div class="ai-panel-heading-actions">
              <button
                class="ai-panel-reset"
                type="button"
                title="重置位置"
                aria-label="重置 AI 完善面板位置"
                @pointerdown.stop
                @click.stop="resetAiPanel"
              >
                <RotateCcw :size="14" />
              </button>
              <Sparkles :size="20" />
            </div>
          </div>
          <label class="field">
            <span>完善要求</span>
            <textarea
              v-model="aiRequirement"
              rows="5"
              placeholder="例如：赛博茶馆老板娘，温柔但有边界，会把用户称作{user}；需要把用户输入里的'老板'替换成'掌柜'。"
              :disabled="characterAiActionBusy"
            />
          </label>
          <label class="field">
            <span>助手模型</span>
            <select
              v-model="assistantModel"
              :disabled="characterAiActionBusy"
            >
              <option v-for="model in assistantModelOptions" :key="model.id || '__global'" :value="model.id">
                {{ model.label || model.id }}
              </option>
            </select>
          </label>
          <label class="checkbox-line ai-context-toggle">
            <input v-model="aiUseCurrentDraft" type="checkbox" :disabled="characterAiActionBusy" />
            <span>结合当前已填写内容 + 完善要求进行优化</span>
          </label>
          <p class="ai-context-hint">
            {{ aiUseCurrentDraft ? '开启后，助手会参考表单现有内容并按你的消息优化。' : '关闭后，助手只按完善要求生成，不读取当前表单内容。' }}
          </p>
          <div class="ai-scope-grid">
            <label v-for="(enabled, key) in aiOptions" :key="key" class="checkbox-line">
              <input v-model="aiOptions[key]" type="checkbox" :disabled="characterAiActionBusy" />
              <span>{{ {
                profile: '基础资料',
                background: '背景',
                worldview: '世界观',
                persona: '人设',
                openingMessage: '开场白',
                tags: '标签',
                regexRules: '正则',
                renderPlugins: '渲染插件',
                worldBookSuggestion: '世界书建议',
                advancedSettings: '高阶设置',
                modSuggestions: 'Mod 建议'
              }[key] || key }}</span>
            </label>
          </div>
          <div class="ai-action-row">
            <button class="primary-button ai-draft-button" type="button" :disabled="characterAiActionBusy" :aria-busy="aiLoading" @click="completeWithAi">
              <WandSparkles :size="18" />
              <span>{{ aiLoading ? 'AI 正在调用工具...' : 'AI 完善角色设定' }}</span>
            </button>
            <button v-if="aiLoading" class="ghost-button" type="button" @click="stopCharacterAi">
              <span>暂停</span>
            </button>
          </div>
          <div v-if="aiModSuggestions.length" class="ai-mod-suggestions">
            <div class="ai-tool-title">
              <ListChecks :size="16" />
              <span>AI Mod 建议 {{ aiModSuggestions.length }}</span>
            </div>
            <article v-for="(mod, index) in aiModSuggestions" :key="index" class="ai-mod-card">
              <strong>{{ mod.name }}</strong>
              <small>{{ mod.type || 'system' }}</small>
              <p>{{ mod.description || mod.content }}</p>
            </article>
            <button
              class="ghost-button"
              type="button"
              :disabled="suggestedModsCreating"
              @click="createSuggestedMods"
            >
              <Plus :size="16" />
              <span>{{ suggestedModsCreating ? '创建中...' : '创建这些 Mod' }}</span>
            </button>
          </div>
          <div v-if="aiProcess.length || aiToolCalls.length" class="ai-process-panel">
            <div class="ai-tool-title">
              <ListChecks :size="16" />
              <span>AI 过程 {{ aiProcess.length || 1 }} 轮 · 工具 {{ aiToolCalls.length }}</span>
            </div>
            <div v-if="aiReasoning" class="ai-reasoning-box">
              <strong>思考摘要</strong>
              <p>{{ aiReasoning }}</p>
            </div>
            <details v-for="(step, stepIndex) in aiProcess" :key="`step-${step.round || stepIndex}`" class="ai-process-step" open>
              <summary>
                <span>第 {{ step.round || stepIndex + 1 }} 轮</span>
                <small>{{ step.tools?.length || 0 }} 个工具</small>
              </summary>
              <p v-if="step.reasoning" class="ai-process-text">{{ step.reasoning }}</p>
              <p v-if="step.content" class="ai-process-text">{{ step.content }}</p>
              <div v-if="step.tools?.length" class="ai-tool-detail-list">
                <details v-for="(call, index) in step.tools" :key="`${call.name}-${index}`" class="ai-tool-detail">
                  <summary>
                    <span>{{ call.name }}</span>
                    <small>{{ toolResultLabel(call.result) }}</small>
                  </summary>
                  <strong>参数</strong>
                  <pre>{{ formatAiValue(call.arguments) }}</pre>
                  <strong>结果</strong>
                  <pre>{{ formatAiValue(call.result) }}</pre>
                </details>
              </div>
            </details>
            <div v-if="!aiProcess.length && aiToolCalls.length" class="ai-tool-list">
              <span v-for="(call, index) in aiToolCalls" :key="`${call.name}-${index}`">{{ call.name }}</span>
            </div>
          </div>
          <span class="ai-panel-resize-handle" aria-hidden="true" @pointerdown.stop="onAiPanelResizeStart"></span>
        </section>

        <section v-if="isEditing && editingCharacterId" id="section-images" class="form-panel character-image-section">
          <CharacterImagePanel :character-id="editingCharacterId" :disabled="!canEdit" />
        </section>

        <section v-if="isEditing && editingCharacterId" id="section-talents" class="form-panel talent-panel">
          <div class="inline-heading">
            <div>
              <h2>角色天赋</h2>
              <p>管理 Roll 得到的角色天赋；开启“天赋提示”后会进入聊天提示词。</p>
            </div>
            <button class="ghost-button" type="button" @click="showTalentDialog = true">
              <Dice6 :size="17" />
              <span>管理天赋</span>
            </button>
          </div>
        </section>

        <TalentRollDialog
          v-if="showTalentDialog && editingCharacterId"
          :character-id="editingCharacterId"
          :character-name="form.name"
          :can-edit="canEdit"
          @close="showTalentDialog = false"
        />

        <section id="section-advanced-settings" class="form-panel advanced-settings-panel">
          <div class="inline-heading">
            <div>
              <h2>作者高级设置</h2>
              <p>固定随角色进入对话；从聊天里打开时只读展示，使用者可另加自己的设置。</p>
            </div>
            <Settings :size="20" />
          </div>

          <label class="field">
            <span>高阶设置 AI 需求</span>
            <textarea
              v-model="advancedAiRequirement"
              rows="3"
              placeholder="例如：生成适合豪门恋爱角色的状态栏提示词、附属技能默认值和一点聊天气泡 CSS。"
              :disabled="characterAiActionBusy"
            />
          </label>
          <label v-if="canEdit" class="checkbox-line ai-context-toggle compact">
            <input v-model="aiUseCurrentDraft" type="checkbox" :disabled="characterAiActionBusy" />
            <span>结合当前已填写内容优化</span>
          </label>
          <div v-if="canEdit" class="ai-action-row">
            <button
              class="ghost-button"
              type="button"
              :disabled="characterAiActionBusy"
              :aria-busy="advancedAiLoading"
              @click="completeAdvancedSettingsWithAi"
            >
              <WandSparkles :size="17" />
              <span>{{ advancedAiLoading ? 'AI 正在完善...' : 'AI 完善高阶设置' }}</span>
            </button>
            <button v-if="advancedAiLoading" class="ghost-button" type="button" @click="stopAdvancedAi">
              <span>暂停</span>
            </button>
          </div>

          <div class="advanced-grid">
            <div class="field background-url-field">
              <span>电脑端背景</span>
              <input
                v-model="form.authorAdvancedSettings.desktopBackgroundUrl"
                type="text"
                placeholder="图片链接、短链或 data URL，可留空"
                aria-label="电脑端背景图片链接"
                :disabled="!canEdit"
              />
              <div v-if="canEdit" class="background-upload-actions">
                <label class="chat-setting-inline-button background-upload-button" :class="{ disabled: backgroundUploading.desktopBackgroundUrl }">
                  <Upload :size="14" />
                  <span>{{ backgroundUploading.desktopBackgroundUrl ? '读取中...' : '上传图片' }}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    :disabled="backgroundUploading.desktopBackgroundUrl"
                    @change="handleAdvancedBackground($event, 'desktopBackgroundUrl')"
                  />
                </label>
                <button class="chat-setting-inline-button" type="button" @click="clearAdvancedBackground('desktopBackgroundUrl')">
                  清空
                </button>
              </div>
            </div>
            <div class="field background-url-field">
              <span>手机端背景</span>
              <input
                v-model="form.authorAdvancedSettings.mobileBackgroundUrl"
                type="text"
                placeholder="手机端专用背景，可留空"
                aria-label="手机端背景图片链接"
                :disabled="!canEdit"
              />
              <div v-if="canEdit" class="background-upload-actions">
                <label class="chat-setting-inline-button background-upload-button" :class="{ disabled: backgroundUploading.mobileBackgroundUrl }">
                  <Upload :size="14" />
                  <span>{{ backgroundUploading.mobileBackgroundUrl ? '读取中...' : '上传图片' }}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    :disabled="backgroundUploading.mobileBackgroundUrl"
                    @change="handleAdvancedBackground($event, 'mobileBackgroundUrl')"
                  />
                </label>
                <button class="chat-setting-inline-button" type="button" @click="clearAdvancedBackground('mobileBackgroundUrl')">
                  清空
                </button>
              </div>
            </div>
          </div>

          <label class="field">
            <span>状态栏提示词</span>
            <textarea
              v-model="form.authorAdvancedSettings.statusBarPrompt"
              rows="4"
              placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
              :disabled="!canEdit"
            />
          </label>

          <div id="section-status-blueprint" class="accessory-defaults-panel status-blueprint-panel">
            <div class="inline-heading compact">
              <div>
                <h3>初始状态栏</h3>
                <p>创建新会话时自动写入；模板会自动同步变量，并支持安全 HTML/CSS 与 data-sb-action 按钮。</p>
              </div>
              <div class="status-blueprint-heading-actions">
                <button class="ghost-button" type="button" @click="showStatusPreviewDialog = true">
                  <Eye :size="16" />
                  <span>预览</span>
                </button>
                <button class="ghost-button" type="button" :disabled="!canEdit" @click="addStatusBlueprintVariable">
                  <Plus :size="16" />
                  <span>变量</span>
                </button>
              </div>
            </div>
            <div class="status-blueprint-toolbar" aria-live="polite">
              <div class="status-blueprint-summary">
                <span><strong>{{ statusBarBlueprintTemplateStats.variables }}</strong> 变量</span>
                <span><strong>{{ statusBarBlueprintTemplateStats.inferred }}</strong> 自动识别</span>
                <span><strong>{{ statusBarBlueprintTemplateStats.meter }}</strong> 数值</span>
                <span><strong>{{ statusBarBlueprintTemplateStats.placeholders }}</strong> 占位符</span>
                <span><strong>{{ statusBarBlueprintTemplateStats.actions }}</strong> 按钮动作</span>
              </div>
              <div v-if="canEdit" class="status-blueprint-actions">
                <button class="chat-setting-inline-button" type="button" @click="refreshStatusBlueprintVariables">
                  <RotateCcw :size="14" />
                  <span>同步</span>
                </button>
                <button class="chat-setting-inline-button" type="button" @click="applyStatusBlueprintSampleTemplate">
                  <Sparkles :size="14" />
                  <span>示例</span>
                </button>
                <button class="chat-setting-inline-button danger" type="button" @click="clearStatusBlueprintTemplate">
                  <Trash2 :size="14" />
                  <span>清空模板</span>
                </button>
              </div>
            </div>
            <label class="field compact">
              <span>状态栏名称</span>
              <input
                v-model="form.authorAdvancedSettings.statusBarBlueprint.name"
                type="text"
                placeholder="状态栏"
                maxlength="50"
                :disabled="!canEdit"
              />
            </label>
            <div class="status-blueprint-vars">
              <div
                v-for="row in statusBlueprintEditorRows"
                :key="row.key"
                class="variable-editor-row status-variable-row"
                :class="{
                  'is-composite': row.kind === 'composite',
                  'is-meter': row.kind === 'variable' && isStatusBlueprintMeterVariable(row.variable),
                  'is-text': row.kind === 'variable' && !isStatusBlueprintMeterVariable(row.variable)
                }"
              >
                <template v-if="row.kind === 'composite'">
                  <input
                    :value="row.label"
                    class="variable-input name"
                    type="text"
                    readonly
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏组合行 ${row.label}`"
                  />
                  <span class="variable-input kind status-composite-kind">组合</span>
                  <div class="status-composite-values">
                    <label
                      v-for="part in row.parts"
                      :key="part.name"
                      class="status-composite-value"
                    >
                      <span>{{ part.name }}</span>
                      <input
                        class="variable-input value"
                        type="text"
                        :value="getStatusBlueprintVariableValue(part.name)"
                        placeholder="文本内容"
                        :disabled="!canEdit"
                        :aria-label="`初始状态栏 ${row.label} 的 ${part.name}`"
                        @input="setStatusBlueprintVariableValueFromEvent(part.name, $event)"
                      />
                    </label>
                  </div>
                </template>
                <template v-else>
                  <input
                    v-model="row.variable.name"
                    class="variable-input name"
                    type="text"
                    placeholder="变量名"
                    maxlength="40"
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏变量 ${row.index + 1} 名称`"
                  />
                  <select
                    class="variable-input kind"
                    :value="isStatusBlueprintMeterVariable(row.variable) ? 'meter' : 'text'"
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏变量 ${row.index + 1} 类型`"
                    @change="setStatusBlueprintVariableModeFromEvent(row.variable, $event)"
                  >
                    <option value="text">文本</option>
                    <option value="meter">数值</option>
                  </select>
                  <input
                    v-model="row.variable.value"
                    class="variable-input value"
                    type="text"
                    :placeholder="isStatusBlueprintMeterVariable(row.variable) ? '数值' : '文本内容'"
                    :disabled="!canEdit"
                    :aria-label="`初始状态栏变量 ${row.index + 1} 内容`"
                  />
                  <template v-if="isStatusBlueprintMeterVariable(row.variable)">
                    <span class="variable-separator">/</span>
                    <input
                      v-model.number="row.variable.max"
                      class="variable-input num"
                      type="number"
                      placeholder="最大"
                      :disabled="!canEdit"
                      :aria-label="`初始状态栏变量 ${row.index + 1} 最大值`"
                    />
                    <input :value="normalizeHexColor(row.variable.color)" class="variable-input color" type="color" title="颜色" :disabled="!canEdit" @input="setColorValueFromEvent(row.variable, 'color', $event)" />
                  </template>
                  <button
                    v-if="canEdit"
                    class="variable-remove"
                    type="button"
                    title="删除变量"
                    :aria-label="`删除初始状态栏变量 ${row.index + 1}`"
                    @click="removeStatusBlueprintVariable(row.index)"
                  >
                    x
                  </button>
                </template>
              </div>
              <p v-if="!statusBlueprintEditorRows.length" class="status-blueprint-vars-empty">
                粘贴模板会自动识别变量，也可以点击右上角“变量”手动添加。
              </p>
            </div>
            <div class="field status-blueprint-template-field">
              <div class="field-heading compact">
                <span>完全自定义模板</span>
                <small>
                  {{ statusBarBlueprintTemplateStats.hasTemplate ? `${statusBarBlueprintTemplateStats.lines} 行` : '留空使用内置状态栏' }}
                </small>
              </div>
              <textarea
                v-model="form.authorAdvancedSettings.statusBarBlueprint.template"
                rows="6"
                placeholder="<div class=&quot;my-status&quot;><span class=&quot;sb-label&quot;>HP</span><span class=&quot;sb-val&quot;>{{HP}}</span><button data-sb-action=&quot;quick-reply&quot; data-sb-text=&quot;查看状态&quot;>查看</button></div>"
                :disabled="!canEdit"
                aria-label="完全自定义状态栏模板"
              />
              <div class="status-blueprint-hints">
                <span>标签 + 值：<code v-pre>&lt;span class="sb-label"&gt;姓名&lt;/span&gt;&lt;span class="sb-val"&gt;{{ 姓名 }}&lt;/span&gt;</code></span>
                <span>按钮：<code>data-sb-action="quick-reply"</code>、<code>copy</code>、<code>collapse</code></span>
              </div>
            </div>
          </div>

          <div id="section-accessories" class="accessory-defaults-panel">
            <div class="inline-heading compact">
              <div>
                <h3>附属技能默认值</h3>
                <p>作为新会话默认值；使用者仍可在会话中覆盖。</p>
              </div>
            </div>
            <div class="accessory-skills-grid">
              <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
                <label class="field compact">
                  <span>{{ item.label }}</span>
                  <select v-model="form.authorAdvancedSettings.accessorySkills[item.key].enabled" :disabled="!canEdit">
                    <option :value="false">关闭</option>
                    <option :value="true">开启</option>
                    <option v-if="item.auto" value="auto">自动</option>
                  </select>
                </label>
                <label class="field compact">
                  <span>模型覆盖</span>
                  <select
                    v-model="form.authorAdvancedSettings.accessorySkills[item.key].modelOverride"
                    :disabled="!canEdit"
                  >
                    <option
                      v-for="model in modelOverrideOptions(form.authorAdvancedSettings.accessorySkills[item.key].modelOverride)"
                      :key="model.id || `current-${item.key}`"
                      :value="model.id"
                    >
                      {{ model.label || model.id }}
                    </option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <label class="field">
            <span>内置 CSS</span>
            <textarea
              v-model="form.authorAdvancedSettings.customCss"
              rows="5"
              placeholder=".deep-bubble { ... }"
              :disabled="!canEdit"
            />
          </label>

          <label class="field">
            <span>内置 JS</span>
            <textarea
              v-model="form.authorAdvancedSettings.customJs"
              rows="5"
              placeholder="return () => {}"
              :disabled="!canEdit"
            />
          </label>
        </section>

        <section id="section-render-plugins" class="form-panel render-plugin-panel">
          <div class="inline-heading">
            <div>
              <h2>消息渲染插件</h2>
              <p>用正则把角色回复中的指定标题行渲染成默认收起的折叠消息。</p>
            </div>
            <button class="ghost-button" type="button" :disabled="!canEdit" @click="addRenderPlugin(true)">
              <Plus :size="17" />
              <span>插件</span>
            </button>
          </div>

          <div v-for="(plugin, index) in form.renderPlugins" :key="index" class="render-plugin-row">
            <label class="checkbox-line plugin-enabled">
              <input v-model="plugin.enabled" type="checkbox" :disabled="!canEdit" />
              <span>启用</span>
            </label>
            <input
              v-model="plugin.label"
              class="plugin-label"
              placeholder="插件名称"
              :disabled="!canEdit"
              :aria-label="`消息渲染插件 ${index + 1} 名称`"
            />
            <input
              v-model="plugin.pattern"
              class="plugin-pattern"
              placeholder="标题行正则，例如 ^【(.+档案.*)】$"
              :disabled="!canEdit"
              :aria-label="`消息渲染插件 ${index + 1} 标题行正则`"
            />
            <input
              v-model="plugin.titleTemplate"
              class="plugin-template"
              placeholder="标题模板，例如 $1"
              :disabled="!canEdit"
              :aria-label="`消息渲染插件 ${index + 1} 标题模板`"
            />
            <input
              v-model="plugin.flags"
              class="flags-input plugin-flags"
              placeholder="u"
              :disabled="!canEdit"
              :aria-label="`消息渲染插件 ${index + 1} 正则标志`"
            />
            <button
              v-if="canEdit"
              class="icon-button danger plugin-delete"
              type="button"
              title="删除插件"
              :aria-label="`删除消息渲染插件 ${index + 1}`"
              @click="removeRenderPlugin(index)"
            >
              <Trash2 :size="17" />
            </button>
          </div>

          <button v-if="canEdit && !form.renderPlugins.length" class="ghost-button add-plugin-empty" type="button" @click="addRenderPlugin(true)">
            <Plus :size="17" />
            <span>添加折叠插件</span>
          </button>

          <div class="render-plugin-preview">
            <label class="field">
              <span>角色内容预览</span>
              <textarea
                :value="renderPluginPreviewText || '当前角色还没有可预览的背景、世界观、人设或开场白。'"
                rows="6"
                readonly
                aria-label="角色内容渲染预览文本"
              />
            </label>
            <div class="render-preview-card">
              <MarkdownContent
                v-if="renderPluginPreviewText"
                :text="renderPluginPreviewText"
                :render-plugins="enabledRenderPlugins"
              />
              <p v-else class="muted-text render-preview-empty">填写角色设定后，这里会直接预览真实角色内容的渲染效果。</p>
            </div>
          </div>
        </section>

        <section id="section-regex" class="form-panel regex-panel">
        <div class="inline-heading">
          <div>
            <h2>高阶正则替换</h2>
            <p>按顺序应用，可选择输入、输出或双向作用域。</p>
          </div>
          <button class="ghost-button" type="button" :disabled="!canEdit" @click="addRule">
            <Plus :size="17" />
            <span>规则</span>
          </button>
        </div>

        <div v-for="(rule, index) in form.regexRules" :key="index" class="rule-row">
          <label class="checkbox-line rule-enabled">
            <input v-model="rule.enabled" type="checkbox" :disabled="!canEdit" />
            <span>启用</span>
          </label>
          <input
            v-model="rule.label"
            class="rule-name"
            placeholder="名称"
            :disabled="!canEdit"
            :aria-label="`正则规则 ${index + 1} 名称`"
          />
          <input
            v-model="rule.pattern"
            class="rule-pattern"
            placeholder="正则 pattern"
            :disabled="!canEdit"
            :aria-label="`正则规则 ${index + 1} 匹配模式`"
          />
          <input
            v-model="rule.replacement"
            class="rule-replacement"
            placeholder="替换为"
            :disabled="!canEdit"
            :aria-label="`正则规则 ${index + 1} 替换内容`"
          />
          <input
            v-model="rule.flags"
            class="flags-input rule-flags"
            placeholder="gim"
            :disabled="!canEdit"
            :aria-label="`正则规则 ${index + 1} 正则标志`"
          />
          <select
            v-model="rule.scope"
            class="rule-scope"
            :disabled="!canEdit"
            :aria-label="`正则规则 ${index + 1} 作用域`"
          >
            <option value="input">输入</option>
            <option value="output">输出</option>
            <option value="both">双向</option>
          </select>
          <input
            v-model="rule.groupName"
            class="rule-group"
            placeholder="分组名"
            :disabled="!canEdit"
            maxlength="60"
            :aria-label="`正则规则 ${index + 1} 分组名`"
          />
          <input
            v-model.number="rule.priority"
            class="rule-priority"
            type="number"
            min="0"
            placeholder="0"
            :disabled="!canEdit"
            title="优先级，数字越小越先执行"
            :aria-label="`正则规则 ${index + 1} 优先级`"
          />
          <button
            v-if="canEdit"
            class="icon-button danger rule-delete"
            type="button"
            title="删除规则"
            :aria-label="`删除正则规则 ${index + 1}`"
            @click="removeRule(index)"
          >
            <Trash2 :size="17" />
          </button>
        </div>

        <div class="preview-box">
          <label class="field">
            <span>预览输入</span>
            <input v-model="previewInput" placeholder="输入一段文本测试正则替换效果" />
          </label>
          <p v-if="previewInput.trim()">{{ regexPreview }}</p>
          <p v-else class="muted-text">输入测试文本后会显示替换结果。</p>
        </div>

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
        </section>
        </div>
      </div>
    </form>

    <div
      v-if="showWorldBookDialog"
      class="world-book-dialog-overlay"
      @click.self="closeWorldBookDialog"
    >
      <section
        class="world-book-dialog form-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-book-dialog-title"
        tabindex="-1"
        @keydown.esc.prevent="closeWorldBookDialog"
      >
        <div class="world-book-dialog-header">
          <div>
            <h2 id="world-book-dialog-title">关联世界书</h2>
            <p>搜索、排序并勾选要随角色绑定的世界书。</p>
          </div>
          <button
            class="icon-button"
            type="button"
            title="关闭"
            aria-label="关闭关联世界书选择"
            @click="closeWorldBookDialog"
          >
            <X :size="18" />
          </button>
        </div>

        <div class="world-book-dialog-tools">
          <label class="field compact world-book-dialog-search">
            <span>搜索</span>
            <input
              v-model="worldBookSearch"
              type="search"
              placeholder="按名称或描述搜索"
              aria-label="搜索世界书"
            />
          </label>
          <label class="field compact world-book-dialog-sort">
            <span>排序</span>
            <select v-model="worldBookSort" aria-label="世界书排序">
              <option
                v-for="option in WORLD_BOOK_SORT_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <button
            class="ghost-button world-book-clear-search"
            type="button"
            :disabled="!worldBookSearch.trim()"
            @click="clearWorldBookSearch"
          >
            <X :size="15" />
            <span>清空</span>
          </button>
        </div>

        <div class="world-book-dialog-summary" aria-live="polite">
          <span>已选 {{ selectedWorldBookIds.length }} 本</span>
          <span>{{ filteredWorldBooks.length }} 个匹配结果</span>
        </div>

        <div v-if="optionsLoading" class="world-book-dialog-state">
          正在加载世界书...
        </div>
        <div v-else-if="optionsLoadError" class="world-book-dialog-state error-text" role="alert">
          {{ optionsLoadError }}
        </div>
        <div v-else-if="!filteredWorldBooks.length" class="world-book-dialog-state">
          没有匹配的世界书。
        </div>
        <div v-else class="world-book-dialog-list">
          <label
            v-for="book in pagedWorldBooks"
            :key="book.id"
            class="world-book-dialog-option"
            :class="{ selected: selectedWorldBookIds.includes(book.id) }"
          >
            <input
              type="checkbox"
              :checked="selectedWorldBookIds.includes(book.id)"
              :disabled="!canEdit"
              @change="toggleWorldBook(book.id)"
            />
            <span class="world-book-dialog-option-main">
              <strong>{{ book.name }}</strong>
              <small v-if="book.description">{{ book.description }}</small>
              <small v-else class="muted-text">暂无描述</small>
            </span>
            <span class="world-book-dialog-meta">
              <small>{{ book.entryCount || 0 }} 条目</small>
              <small>深度 {{ book.scanDepth || 4 }}</small>
              <small>预算 {{ book.lorebookContextPercent || 25 }}%</small>
            </span>
          </label>
        </div>

        <div class="world-book-dialog-footer">
          <div class="world-book-pagination" aria-live="polite">
            <button
              class="icon-button"
              type="button"
              title="上一页"
              aria-label="上一页"
              :disabled="worldBookPage <= 1"
              @click="setWorldBookPage(worldBookPage - 1)"
            >
              <ChevronLeft :size="17" />
            </button>
            <span>{{ worldBookPageStart }}-{{ worldBookPageEnd }} / {{ filteredWorldBooks.length }} · 第 {{ worldBookPage }} / {{ worldBookPageCount }} 页</span>
            <button
              class="icon-button"
              type="button"
              title="下一页"
              aria-label="下一页"
              :disabled="worldBookPage >= worldBookPageCount"
              @click="setWorldBookPage(worldBookPage + 1)"
            >
              <ChevronRight :size="17" />
            </button>
          </div>
          <button class="primary-button" type="button" @click="closeWorldBookDialog">
            完成
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="showStatusPreviewDialog"
      class="status-preview-overlay"
      @click.self="showStatusPreviewDialog = false"
    >
      <section
        class="status-preview-dialog form-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-preview-title"
        tabindex="-1"
        @keydown.esc.prevent="showStatusPreviewDialog = false"
      >
        <div class="status-preview-header">
          <div>
            <h2 id="status-preview-title">实际效果预览</h2>
            <p>保存后，新会话会按此状态栏效果显示。</p>
          </div>
          <button
            class="icon-button status-preview-close"
            type="button"
            aria-label="关闭效果预览"
            @click="showStatusPreviewDialog = false"
          >
            <X :size="18" />
          </button>
        </div>
        <div class="status-preview-body">
          <StatusBar
            v-if="statusBarBlueprintPreview"
            :status-bar="statusBarBlueprintPreview"
            :template-config="statusBarBlueprintPreviewConfig"
          />
          <p v-else class="muted-text status-blueprint-empty">添加变量或模板后显示预览。</p>
        </div>
      </section>
    </div>
  </section>
</template>
