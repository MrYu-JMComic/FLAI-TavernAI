<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, toRef, watch } from 'vue';
import {
  ArrowLeft, ArrowUp, Check, ChevronDown, Eye, FileText, History, ImagePlus, LoaderCircle,
  Menu, MessageSquare, MoreHorizontal, PanelLeft, Plus, RotateCcw, Save, SlidersHorizontal, Sparkles, SquarePen, Trash2, X
} from '@lucide/vue';
import MarkdownContent from '../components/MarkdownContent.vue';
import AiPlanReview from '../components/AiPlanReview.vue';
import CharacterAiModSuggestions from '../components/character/CharacterAiModSuggestions.vue';
import CharacterAiProcessPanel from '../components/character/CharacterAiProcessPanel.vue';
import CharacterAiDraftActions from '../components/character/CharacterAiDraftActions.vue';
import CharacterAiDraftPanel from '../components/character/CharacterAiDraftPanel.vue';
import CharacterCardPreviewDialog from '../components/character/CharacterCardPreviewDialog.vue';
import CharacterStatusPreviewDialog from '../components/character/CharacterStatusPreviewDialog.vue';
import CharacterAssistantModelPicker from '../components/character/CharacterAssistantModelPicker.vue';
import CharacterAssistantHistoryDialog from '../components/character/CharacterAssistantHistoryDialog.vue';
import WorldBookChanges from '../components/worldbook/WorldBookChanges.vue';
import { CHARACTER_EDITOR_KEY, useCharacterEditor } from '../composables/character/useCharacterEditor';
import { useCharacterAssistantSessions } from '../composables/character/useCharacterAssistantSessions';
import { assistantImageUrl, useCharacterAssistantImages } from '../composables/character/useCharacterAssistantImages';
import { CHARACTER_AI_SECTION_LABELS } from '../utils/aiSectionLabels.js';
import { recordFrontendDiagnostic } from '../diagnostics.js';
import '../styles/character-assistant.css';

const props = defineProps({
  route: { type: Object, required: true },
  user: { type: Object, default: null },
  provider: { type: Object, default: null }
});
const emit = defineEmits(['navigate']);
const editor = reactive(useCharacterEditor({ props, emit }));
provide(CHARACTER_EDITOR_KEY, editor);
const workspace = reactive(useCharacterAssistantSessions({ editor, user: props.user }));
const headerAvatarUrl = computed(() => String(editor.form.avatarUrl || '').trim());
const failedHeaderAvatarUrl = ref('');
const showPreview = ref(false);
const showStatusPreview = ref(false);
const showHistory = ref(false);
const resettingDraft = ref(false);
const committing = ref(false);
const draftReset = ref(false);
const showSessions = ref(false);
const showSettings = ref(false);
const showHeaderActions = ref(false);
const showModelPicker = ref(false);
const settingsHeight = ref(420);
const viewportHeight = ref('100%');
const viewportTop = ref('0px');
const mobileViewport = ref(false);
const mobileKeyboard = ref(false);
const transcript = ref(null);
const composer = ref(null);
const attachmentInput = ref(null);
const sessionsDrawer = ref(null);
let sessionOpener = null;
let composerLayout = '';
let viewportFrame = 0;
let disposed = false;
const followOutput = ref(true);
const messages = computed(() => workspace.activeSession?.messages || []);
const locked = computed(() => workspace.busy || workspace.running || workspace.settling || resettingDraft.value || committing.value || editor.characterAiActionBusy);
const images = reactive(useCharacterAssistantImages({
  attachments: toRef(editor, 'aiAttachments'),
  sessionId: () => workspace.activeSession?.id || '',
  isDisabled: () => locked.value || workspace.loading || !workspace.activeSession
}));
const hasPlan = computed(() => Boolean(editor.aiPlan?.steps?.length) && editor.aiPlanPhase !== 'done');
const scopeCount = computed(() => Object.values(editor.aiOptions).filter(Boolean).length);
const context = computed(() => editor.aiContext || null);
const selectedModelLabel = computed(() => editor.assistantModelOptions.find((model) => model.id === editor.assistantModel)?.label || editor.assistantModel || '使用全局模型');
const statusPreviewContext = computed(() => ({
  user: props.user?.displayName || props.user?.accountName || props.user?.username || '',
  char: editor.form?.name || ''
}));
const starters = [
  { title: '从想法创建角色', text: '我想创建一个新角色，请先和我讨论角色定位、性格与故事方向。' },
  { title: '检查角色一致性', text: '请检查当前角色卡，指出设定矛盾、信息缺口和可以改进的地方，先给建议。' },
  { title: '打磨开场与人设', text: '请结合现有角色设定，和我一起优化人设与开场白。先说明你的思路。' }
];

function updateSettingsHeight() {
  const formTop = composer.value?.closest('form')?.getBoundingClientRect().top;
  const transcriptTop = transcript.value?.getBoundingClientRect().top;
  if (typeof formTop !== 'number' || typeof transcriptTop !== 'number') return;
  settingsHeight.value = Math.min(420, Math.max(90, Math.floor(formTop - transcriptTop - 20)));
}

function resizeComposer(onlyIfLayoutChanged = false) {
  const input = composer.value;
  if (!input) return;
  const layout = `${input.getBoundingClientRect().width}:${input.rows}:${getComputedStyle(input).maxHeight}`;
  if (onlyIfLayoutChanged && composerLayout === layout) {
    updateSettingsHeight();
    return;
  }
  composerLayout = layout;
  const scrollTop = input.scrollTop;
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
  input.scrollTop = scrollTop;
  updateSettingsHeight();
}

function recoverOuterScroll() {
  if (!mobileViewport.value) return;
  const viewport = window.visualViewport;
  // Leave native keyboard panning and pinch zoom alone. Only the outer page
  // can have a stale offset; the conversation keeps its own scroll position.
  if (viewport && (Math.abs(viewport.scale - 1) > 0.01 || Math.abs(viewport.offsetTop) > 1 || Math.abs(viewport.height - window.innerHeight) > 2)) return;
  const pageShell = composer.value?.closest('.page-shell');
  if (pageShell?.scrollTop) pageShell.scrollTop = 0;
  if (window.scrollX || window.scrollY) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function updateViewport() {
  if (disposed) return;
  mobileViewport.value = window.matchMedia('(max-width: 760px)').matches;
  mobileKeyboard.value = window.matchMedia('(pointer: coarse)').matches || navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const viewport = mobileViewport.value ? window.visualViewport : null;
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  viewportHeight.value = viewport?.height > 0 ? `${Math.round(viewport.height)}px` : '100%';
  viewportTop.value = viewport ? `${Math.round(Math.max(0, viewport.offsetTop || 0))}px` : '0px';
  void nextTick(() => {
    if (disposed) return;
    resizeComposer(true);
    recoverOuterScroll();
  });
}

function scheduleViewportUpdate() {
  if (disposed || viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0;
    updateViewport();
  });
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') scheduleViewportUpdate();
}

watch([composer, () => editor.aiRequirement], () => resizeComposer(), { flush: 'post' });
watch(headerAvatarUrl, () => { failedHeaderAvatarUrl.value = ''; });
watch(() => workspace.activeSession?.id, () => { draftReset.value = false; });

watch(showSettings, async (open) => {
  if (!open) return;
  await nextTick();
  updateSettingsHeight();
});
watch(showSessions, async (open) => {
  if (!mobileViewport.value) return;
  if (open) {
    sessionOpener = document.activeElement;
    await focusSessionDrawer();
  } else if (sessionOpener?.isConnected) {
    await nextTick();
    sessionOpener.focus({ preventScroll: true });
    sessionOpener = null;
  }
});
watch(mobileViewport, (mobile) => { if (!mobile) showSessions.value = false; });

async function focusSessionDrawer() {
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  sessionsDrawer.value?.querySelector('.assistant-mobile-close:not([disabled])')?.focus({ preventScroll: true });
}

onMounted(() => {
  updateViewport();
  void editor.loadAssistantProviderProfiles();
  window.addEventListener('resize', scheduleViewportUpdate);
  window.addEventListener('pageshow', scheduleViewportUpdate);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
  window.visualViewport?.addEventListener('scroll', scheduleViewportUpdate);
});
onBeforeUnmount(() => {
  disposed = true;
  if (viewportFrame) cancelAnimationFrame(viewportFrame);
  window.removeEventListener('resize', scheduleViewportUpdate);
  window.removeEventListener('pageshow', scheduleViewportUpdate);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.visualViewport?.removeEventListener('resize', scheduleViewportUpdate);
  window.visualViewport?.removeEventListener('scroll', scheduleViewportUpdate);
});

function trackScroll() {
  const element = transcript.value;
  if (element) followOutput.value = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
}

watch(() => [messages.value.length, workspace.running, editor.aiProcess, editor.aiStatusMessage, hasPlan.value], async () => {
  if (!followOutput.value) return;
  await nextTick();
  transcript.value?.scrollTo?.({ top: transcript.value.scrollHeight, behavior: 'instant' });
}, { deep: true });

async function run(action = editor.completeWithAi) {
  if (locked.value || images.busy || !workspace.activeSession || (!editor.aiRequirement.trim() && !editor.aiAttachments.length && action === editor.completeWithAi)) return;
  followOutput.value = true;
  await workspace.run(action);
  if (!showSessions.value && !showModelPicker.value && !showPreview.value && !showStatusPreview.value) composer.value?.focus({ preventScroll: true });
}

function addSelectedImages(event) {
  const files = Array.from(event.target?.files || []);
  if (event.target) event.target.value = '';
  void images.addFiles(files);
}

function messageImages(attachments = []) {
  return attachments.map((image, index) => ({
    id: image.id || index,
    url: assistantImageUrl(image),
    alt: image.alt || image.name || '助手图片'
  })).filter((image) => image.url);
}

function sendKey(event) {
  if (mobileKeyboard.value) return;
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void run();
}

function openModelPicker() {
  showSettings.value = false;
  showModelPicker.value = true;
  void editor.loadAssistantProviderProfiles();
}

function selectAssistantModel(model) {
  editor.assistantModel = model;
  showModelPicker.value = false;
}

function handleDrawerKeydown(event) {
  if (!mobileViewport.value || !showSessions.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    showSessions.value = false;
    return;
  }
  if (event.key !== 'Tab') return;
  const buttons = [...(sessionsDrawer.value?.querySelectorAll('button:not([disabled])') || [])]
    .filter((button) => button.getClientRects().length);
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !sessionsDrawer.value.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !sessionsDrawer.value.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function startConversation(text) {
  editor.aiRequirement = text;
  composer.value?.focus({ preventScroll: true });
}

async function selectSession(id) {
  await workspace.selectSession(id);
  showSessions.value = false;
  followOutput.value = true;
  await nextTick();
  transcript.value?.scrollTo?.({ top: transcript.value.scrollHeight });
}

async function saveCharacter() {
  if (disposed || locked.value || images.busy || workspace.loading || !workspace.activeSession || !editor.canEdit) return;
  committing.value = true;
  showHeaderActions.value = false;
  try {
    await workspace.persist({ force: true });
    await editor.submit();
    await workspace.persist();
  } catch (error) { recordFrontendDiagnostic('characterAssistant.saveCharacter', error); }
  finally { committing.value = false; }
}

function openHistory() {
  showHeaderActions.value = false;
  showHistory.value = true;
  void workspace.loadVersions();
}

async function restoreVersion(id) {
  if (await workspace.restoreVersion(id)) showHistory.value = false;
}

async function resetDraftFromSavedCharacter() {
  const sessionId = workspace.activeSession?.id;
  if (disposed || !sessionId || !workspace.activeSession.characterId || !editor.canEdit || locked.value || images.busy || workspace.loading) return;
  if (!window.confirm('用数据库中已保存的完整角色卡覆盖当前会话草稿？当前草稿会保留为历史版本，旧计划与待应用修改将清除，对话记录会保留。')) return;
  resettingDraft.value = true;
  draftReset.value = false;
  try {
    const success = await workspace.resetDraftFromSavedCharacter();
    if (!disposed && workspace.activeSession?.id === sessionId) draftReset.value = success;
  } finally {
    if (!disposed) resettingDraft.value = false;
  }
}

async function returnToEditor() {
  if (disposed || locked.value || images.busy || workspace.loading) return;
  committing.value = true;
  showHeaderActions.value = false;
  try {
    await workspace.persist();
    editor.prepareAssistantEditorHandoff();
    emit('navigate', editor.isEditing ? 'characterEdit' : 'characterNew', editor.isEditing ? { id: editor.editingCharacterId } : {});
  } catch (error) { recordFrontendDiagnostic('characterAssistant.returnToEditor', error); }
  finally { committing.value = false; }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function formatTokens(value) {
  return typeof value === 'number' ? new Intl.NumberFormat('zh-CN').format(value) : '—';
}

function cacheLabel(cache) {
  if (!cache?.reported) return '模型服务未返回缓存用量';
  if (typeof cache.hitRate === 'number') return `${Math.round(cache.hitRate * 100)}% 缓存命中`;
  return `${formatTokens(cache.cachedTokens)} 缓存 token`;
}
</script>

<template>
  <section class="character-assistant-page" :style="{ '--assistant-settings-max-height': `${settingsHeight}px`, '--assistant-viewport-height': viewportHeight, '--assistant-viewport-top': viewportTop }" aria-label="AI 角色完善助手" @keydown="handleDrawerKeydown">
    <header class="character-assistant-header" :inert="mobileViewport && showSessions">
      <div class="character-assistant-heading">
        <button class="ghost-button assistant-icon-button assistant-back-button" type="button" aria-label="返回角色编辑" :disabled="locked || images.busy || workspace.loading" @click="returnToEditor"><ArrowLeft :size="18" /></button>
        <button class="assistant-mobile-header-button assistant-header-history" type="button" aria-label="会话" :aria-expanded="showSessions" @click="showSessions = !showSessions"><Menu :size="22" /></button>
        <span class="assistant-brand-mark" aria-hidden="true">
          <img v-if="headerAvatarUrl && headerAvatarUrl !== failedHeaderAvatarUrl" :key="headerAvatarUrl" :src="headerAvatarUrl" alt="" @error="failedHeaderAvatarUrl = $event.currentTarget.getAttribute('src')" />
          <Sparkles v-else :size="20" />
        </span>
        <div>
          <p>AI 完善助手 <span>{{ editor.isEditing ? '绑定角色' : '临时会话' }}</span></p>
          <h1>{{ editor.form.name || '一起构建你的角色' }}</h1>
        </div>
      </div>
      <div class="assistant-mobile-header-controls">
        <button class="assistant-mobile-header-button" type="button" aria-label="新建助手会话" :disabled="locked || workspace.loading" @click="workspace.newSession"><SquarePen :size="21" /></button>
        <button class="assistant-mobile-header-button" type="button" aria-label="更多助手操作" :aria-expanded="showHeaderActions" aria-controls="assistant-header-actions" @click="showHeaderActions = !showHeaderActions"><MoreHorizontal :size="22" /></button>
      </div>
      <div id="assistant-header-actions" class="character-assistant-header-actions" :class="{ 'actions-open': showHeaderActions }">
        <button class="ghost-button" type="button" aria-label="草稿历史版本" title="草稿历史版本" :disabled="locked || workspace.loading || !workspace.activeSession" @click="openHistory"><History :size="16" /><span>历史版本</span></button>
        <button class="ghost-button" type="button" aria-label="预览角色卡" title="预览角色卡" :disabled="editor.loading || Boolean(editor.loadError)" @click="showPreview = true; showHeaderActions = false"><Eye :size="16" /><span>预览角色卡</span></button>
        <button class="ghost-button" type="button" aria-label="预览状态栏" title="预览当前会话草稿状态栏" :disabled="editor.loading || Boolean(editor.loadError)" @click="showStatusPreview = true; showHeaderActions = false"><Eye :size="16" /><span>预览状态栏 · 当前草稿</span></button>
        <button class="primary-button" type="button" :disabled="locked || images.busy || !editor.canEdit || workspace.loading || Boolean(editor.loadError)" @click="saveCharacter"><Save :size="16" /><span>{{ editor.saving ? '保存中…' : editor.isEditing ? '保存角色' : '创建角色' }}</span></button>
        <button class="ghost-button assistant-mobile-return" type="button" :disabled="locked || images.busy || workspace.loading" aria-label="返回角色编辑" @click="returnToEditor"><ArrowLeft :size="16" /><span>返回角色编辑</span></button>
      </div>
    </header>

    <div v-if="editor.loading" class="assistant-page-state" role="status"><LoaderCircle :size="22" class="assistant-spinning" />正在加载角色…</div>
    <div v-else-if="editor.loadError" class="assistant-page-state" role="alert">
      <p>{{ editor.loadError }}</p><button class="ghost-button" type="button" @click="editor.loadEditingCharacter">
      <RotateCcw :size="16" />重新加载角色</button>
    </div>
    <div v-else-if="!editor.canEdit" class="assistant-page-state"><p>只有角色拥有者可以使用完善助手。</p><button class="ghost-button" type="button" @click="returnToEditor">返回查看角色</button></div>

    <div v-else class="character-assistant-workspace" :class="{ 'sessions-open': showSessions }">
      <button v-if="showSessions" class="assistant-sidebar-scrim" type="button" tabindex="-1" aria-label="关闭会话列表" @click="showSessions = false"></button>
      <aside ref="sessionsDrawer" class="assistant-sessions" :role="mobileViewport && showSessions ? 'dialog' : undefined" :aria-modal="mobileViewport && showSessions ? 'true' : undefined" aria-label="助手会话">
        <div class="assistant-sessions-title"><strong>对话记录</strong><button class="ghost-button assistant-mobile-close assistant-icon-button" type="button" aria-label="关闭会话列表" @click="showSessions = false">
      <X :size="17" /></button></div>
        <button class="assistant-new-session" type="button" :disabled="locked || workspace.loading" @click="workspace.newSession"><Plus :size="17" />新建会话</button>
        <p class="assistant-sessions-caption">{{ editor.isEditing ? '此角色的创作与维护记录' : '创建角色后，当前会话会自动绑定' }}</p>
        <div v-if="workspace.loading" class="assistant-sessions-loading" role="status"><LoaderCircle :size="16" class="assistant-spinning" />加载会话…</div>
        <nav v-else class="assistant-session-list" aria-label="选择助手会话">
          <div v-for="session in workspace.sessions" :key="session.id" class="assistant-session-row" :class="{ active: session.id === workspace.activeSession?.id }">
            <button class="assistant-session-select" type="button" :disabled="locked" :aria-current="session.id === workspace.activeSession?.id ? 'page' : undefined" @click="selectSession(session.id)">
              <MessageSquare :size="15" /><span><strong>{{ session.title || '新会话' }}</strong><small>{{ formatDate(session.updatedAt) }} · {{ session.characterId ? '角色会话' : '临时会话' }}</small></span>
            </button>
            <button class="assistant-session-delete" type="button" :aria-label="`删除会话：${session.title || '新会话'}`" :disabled="locked" @click="workspace.removeSession(session.id)"><Trash2 :size="14" /></button>
          </div>
        </nav>
        <div class="assistant-session-footer"><FileText :size="15" /><p>会话保留对话与角色草稿。确认内容后，保存到角色卡。</p></div>
      </aside>

      <section class="assistant-conversation" :inert="mobileViewport && showSessions" aria-label="当前助手会话">
        <div class="assistant-conversation-toolbar">
          <button class="ghost-button assistant-history-toggle" type="button" :aria-expanded="showSessions" @click="showSessions = !showSessions"><PanelLeft :size="16" /><span>会话</span></button>
          <span class="assistant-current-title">{{ workspace.activeSession?.title || '新会话' }}</span>
          <span class="assistant-save-status" aria-live="polite"><LoaderCircle v-if="workspace.busy" :size="13" class="assistant-spinning" />
      <Check v-else :size="13" />{{ workspace.saveStatus || '准备会话中' }}</span>
        </div>

        <div v-if="workspace.error" class="assistant-workspace-error" role="alert"><span>{{ workspace.error }}</span><button class="ghost-button" type="button" :disabled="workspace.busy || workspace.running" @click="workspace.initialize">
      <RotateCcw :size="14" />重新加载</button></div>

        <div ref="transcript" class="assistant-transcript" role="log" aria-label="与角色完善助手的对话" :aria-busy="workspace.running" @scroll="trackScroll">
          <div v-if="!messages.length && !workspace.running" class="assistant-welcome">
            <span class="assistant-welcome-mark" aria-hidden="true"><Sparkles :size="30" /></span>
            <p class="assistant-eyebrow">你的角色创作伙伴</p>
            <h2>{{ editor.isEditing ? '让这个角色，继续生长。' : '一个想法，就能开启故事。' }}</h2>
            <p>自由讨论设定、推敲故事，也可以直接交代修改要求。助手会结合角色草稿与对话，通过工具完成创作。</p>
            <div class="assistant-starters"><button v-for="starter in starters" :key="starter.title" type="button" :disabled="locked || workspace.loading" @click="startConversation(starter.text)"><span>{{ starter.title }}</span>
      <ArrowUp :size="16" /></button></div>
          </div>

          <article v-for="(message, index) in messages" :key="message.id || index" class="assistant-message" :class="message.role === 'user' ? 'from-user' : 'from-assistant'">
            <div class="assistant-message-label"><Sparkles v-if="message.role !== 'user'" :size="16" /><strong>{{ message.role === 'user' ? '你' : '角色助手' }}</strong><small v-if="['paused', 'cancelled'].includes(message.status)">已停止</small><small v-else-if="message.status === 'failed'">未完成</small></div>
            <MarkdownContent v-if="message.content && message.role === 'user'" :text="message.content" class="assistant-message-content" />
            <div v-if="message.attachments?.length" class="assistant-message-attachments"><a v-for="image in messageImages(message.attachments)" :key="image.id" :href="image.url" target="_blank" rel="noopener noreferrer"><img :src="image.url" :alt="image.alt" loading="lazy" /></a></div>
            <CharacterAiProcessPanel v-if="message.toolCalls?.length || message.process?.some((step) => step.tools?.length)" :final-content="message.content || ''" :process="message.process || []" :tool-calls="message.toolCalls || []" :status="message.status || 'completed'" :status-message="''" />
            <MarkdownContent v-if="message.content && message.role !== 'user'" :text="message.content" class="assistant-message-content" />
          </article>

          <template v-if="workspace.running">
            <article v-if="workspace.pendingMessage || workspace.pendingAttachments.length" class="assistant-message from-user"><div class="assistant-message-label"><strong>你</strong></div><MarkdownContent v-if="workspace.pendingMessage" :text="workspace.pendingMessage" class="assistant-message-content" /><div v-if="workspace.pendingAttachments.length" class="assistant-message-attachments"><a v-for="image in messageImages(workspace.pendingAttachments)" :key="image.id" :href="image.url" target="_blank" rel="noopener noreferrer"><img :src="image.url" :alt="image.alt" /></a></div></article>
            <article class="assistant-message from-assistant is-live"><div class="assistant-message-label"><Sparkles :size="16" /><strong>角色助手</strong><LoaderCircle v-if="editor.aiLoading" :size="14" class="assistant-spinning" /></div><CharacterAiProcessPanel v-if="editor.aiLoading || editor.aiProcess.length" :loading="editor.aiLoading" :final-content="editor.aiFinalContent" :process="editor.aiProcess" :reasoning="editor.aiReasoning" :status="editor.aiStatus" :status-message="editor.aiStatusMessage" :tool-calls="editor.aiToolCalls" /><MarkdownContent v-if="editor.aiStatus === 'completed' && editor.aiFinalContent" :text="editor.aiFinalContent" class="assistant-message-content" /></article>
          </template>

          <div v-if="editor.aiLastError && !workspace.running" class="assistant-run-error" role="alert"><p>{{ editor.aiLastError }}</p><button class="ghost-button" type="button" :disabled="locked" @click="run(editor.retryCharacterAi)">
      <RotateCcw :size="15" />重试</button><button v-if="editor.aiHasCheckpoint" class="ghost-button" type="button" :disabled="locked" @click="editor.saveAiCheckpoint">保留阶段草稿</button></div>
          <div v-if="editor.aiStatus === 'paused' && !workspace.running" class="assistant-draft-notice"><span>已停止，阶段结果与会话记录已保留。</span><button v-if="editor.aiHasCheckpoint" class="ghost-button" type="button" :disabled="locked" @click="run(editor.resumeCharacterAi)">继续完成</button></div>
          <ul v-if="editor.aiWarnings.length" class="assistant-run-warnings"><li v-for="warning in editor.aiWarnings" :key="warning">{{ warning }}</li></ul>

          <div class="assistant-review-items">
            <AiPlanReview v-if="hasPlan" :busy="workspace.running" :disabled="locked && !workspace.running" :extra-requirement="editor.aiPlanExtraRequirement" :phase="editor.aiPlanPhase" :plan="editor.aiPlan" :section-labels="CHARACTER_AI_SECTION_LABELS" :step-status="editor.aiPlanStepStatus" @discard="editor.discardCharacterPlan" @execute="run(editor.executeApprovedPlan)" @replan="run(editor.replanCharacterAi)" @toggle-step="editor.toggleAiPlanStep" @update-step="editor.updateAiPlanStep" @update:extra-requirement="editor.aiPlanExtraRequirement = $event" />
            <WorldBookChanges v-if="editor.aiWorldBookChanges.length" :changes="editor.aiWorldBookChanges" :busy="locked || editor.aiWorldBookCreating || !editor.aiOptions.worldBook" character-context defer-save @update-add-to-character="editor.setAiWorldBookAddToCharacter" @reload="editor.reloadAiWorldBook" @discard="editor.discardAiWorldBookChange" />
            <CharacterAiModSuggestions v-if="editor.aiModSuggestions.length" :suggestions="editor.aiModSuggestions" :creating="editor.suggestedModsCreating" @create="editor.createSuggestedMods" />
          </div>
        </div>

        <div class="assistant-composer-area">
          <details v-if="context" class="assistant-context-inspector">
            <summary><span><FileText :size="13" />上下文 · 约 {{ formatTokens(context.estimatedTokens) }} token</span><span>{{ cacheLabel(context.cache) }}<ChevronDown :size="13" /></span></summary>
            <p v-if="context.imageCount || context.droppedHistoryImages" class="assistant-context-images">参考图片 {{ context.imageCount || 0 }} 张<span v-if="context.droppedHistoryImages"> · 历史图片未纳入 {{ context.droppedHistoryImages }} 张</span></p>
            <div class="assistant-context-body"><p>指令和工具保持稳定前缀，角色草稿、近期对话和当前要求随后组合，便于服务商复用缓存。</p><dl><div v-for="part in context.components || []" :key="part.key"><dt>{{ part.label }}</dt><dd>约 {{ formatTokens(part.estimatedTokens) }} token</dd></div></dl><div class="assistant-context-cache"><span>保留对话 {{ context.historyMessages || 0 }} 条</span><span>输入 {{ formatTokens(context.cache?.inputTokens) }}</span><span>缓存 {{ formatTokens(context.cache?.cachedTokens) }}</span></div><small>估算用量用于理解组成；缓存命中以模型服务实际返回为准。用量为本轮最后一次模型请求的服务商统计。</small></div>
          </details>

          <form class="assistant-composer" @submit.prevent="run()" @paste="images.pasteImages" @dragover="images.dragImages" @drop="images.dropImages">
            <div v-if="editor.aiAttachments.length && !workspace.running" class="assistant-pending-images" aria-label="待发送图片"><div v-for="image in editor.aiAttachments" :key="image.id" class="assistant-pending-image"><img :src="assistantImageUrl(image)" :alt="image.alt || image.name || '助手图片'" /><button type="button" :aria-label="`移除图片 ${image.name || '图片'}`" :disabled="locked || images.busy" @click="images.removeImage(image.id)"><X :size="14" /></button></div></div>
            <p v-if="images.error" class="assistant-attachment-error" role="alert">{{ images.error }}</p>
            <p v-if="images.busy" class="assistant-attachment-loading" role="status"><LoaderCircle :size="13" class="assistant-spinning" />正在读取图片…</p>
            <label class="visually-hidden" for="character-assistant-message">给角色助手发送消息</label>
            <textarea id="character-assistant-message" ref="composer" v-model="editor.aiRequirement" rows="2" placeholder="聊聊你的想法，或描述希望助手完成的修改…" :disabled="locked || workspace.loading || !workspace.activeSession" @keydown="sendKey"></textarea>
            <div class="assistant-composer-controls">
              <div class="assistant-composer-options">
                <input ref="attachmentInput" type="file" hidden accept="image/png,image/jpeg,image/webp" multiple aria-label="选择助手图片" :disabled="locked || images.busy || workspace.loading || !workspace.activeSession" @change="addSelectedImages" />
                <button class="assistant-attachment-button" type="button" aria-label="添加图片" title="添加图片（最多 4 张，每张 4 MB）" :disabled="locked || images.busy || workspace.loading || !workspace.activeSession || editor.aiAttachments.length >= 4" @click="attachmentInput?.click()"><ImagePlus :size="17" /></button>
                <button class="assistant-model-control" type="button" :disabled="locked" :aria-label="`选择助手模型，当前：${selectedModelLabel}`" aria-haspopup="dialog" @click="openModelPicker"><span>{{ selectedModelLabel }}</span><ChevronDown :size="13" /></button>
                <button class="assistant-plan-toggle" :class="{ active: editor.assistantPlanMode }" type="button" :aria-pressed="editor.assistantPlanMode" :disabled="locked" @click="editor.assistantPlanMode = !editor.assistantPlanMode">Plan<span>{{ editor.assistantPlanMode ? '开' : '关' }}</span></button>
                <button class="assistant-settings-toggle" :class="{ active: showSettings }" type="button" :aria-label="`对话设置与完善范围（${scopeCount} 项）`" :aria-expanded="showSettings" :disabled="locked" @click="showSettings = !showSettings"><SlidersHorizontal :size="15" /><span>范围 {{ scopeCount }}</span></button>
              </div>
              <CharacterAiDraftActions :disabled="locked || images.busy || workspace.loading || !workspace.activeSession || (!editor.aiRequirement.trim() && !editor.aiAttachments.length)" :loading="editor.aiLoading" :pending="workspace.running" @complete="run()" @stop="editor.stopCharacterAi" />
            </div>
            <CharacterAiDraftPanel v-if="showSettings" v-model:streaming-enabled="editor.assistantStreamingEnabled" v-model:thinking-level="editor.assistantThinkingLevel" v-model:use-current-draft="editor.aiUseCurrentDraft" :disabled="locked" :options="editor.aiOptions" :thinking-options="editor.assistantThinkingOptions" :thinking-supported="editor.assistantThinkingSupported" :world-books="editor.worldBooks" :world-book-selected-ids="editor.aiWorldBookSelectedIds" :world-book-automatic="editor.aiWorldBookAutomatic" :world-book-source-label="editor.aiWorldBookSourceLabel" @close="showSettings = false" @set-option="editor.setAiOptionValue" @update:world-book-selected-ids="editor.setAiWorldBookSelectedIds" @update:world-book-automatic="editor.setAiWorldBookAutomatic" @new-world-book="editor.requestAiNewWorldBook" />
          </form>
          <p class="assistant-composer-hint">Enter 发送 · Shift + Enter 换行 <span>修改先保留在草稿，保存角色后生效</span></p>
        </div>
      </section>
    </div>

    <CharacterAssistantHistoryDialog v-if="showHistory" :versions="workspace.versions" :loading="workspace.versionsLoading" :busy="locked || images.busy" :error="workspace.versionsError" :can-reset-draft="Boolean(workspace.activeSession?.characterId) && editor.canEdit && !workspace.loading" :resetting-draft="resettingDraft" :draft-reset="draftReset" :reset-error="workspace.resetDraftError" @close="showHistory = false" @reload="workspace.loadVersions" @restore="restoreVersion" @reset-draft="resetDraftFromSavedCharacter" />
    <CharacterCardPreviewDialog v-if="showPreview" :character="editor.toPayload()" :world-books="editor.selectedWorldBookPreview" @close="showPreview = false" />
    <CharacterStatusPreviewDialog v-if="showStatusPreview" :status-bar="editor.statusBarBlueprintPreview" :template-config="editor.statusBarBlueprintPreviewConfig" :context="statusPreviewContext" @close="showStatusPreview = false" />
    <CharacterAssistantModelPicker v-if="showModelPicker" :model="editor.assistantModel" :model-options="editor.assistantModelOptions" :provider-profile-id="editor.assistantProviderProfileId" :provider-profiles="editor.assistantProviderProfiles" :touch-device="mobileKeyboard" :loading="editor.assistantModelsLoading" :error="editor.assistantModelsError" @close="showModelPicker = false" @select-model="selectAssistantModel" @select-provider="editor.selectAssistantProviderProfile" @refresh="editor.refreshAssistantModels({ forceRefresh: true })" />
  </section>
</template>
