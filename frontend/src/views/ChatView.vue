<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BookOpen, Bot, Clipboard, RotateCcw, Settings, X } from '@lucide/vue';
import StatusBar from '../components/StatusBar.vue';
import VirtualMessageList from '../components/VirtualMessageList.vue';
import ChatSidebar from '../components/chat/ChatSidebar.vue';
import ChatHeader from '../components/chat/ChatHeader.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import ChatComposer from '../components/chat/ChatComposer.vue';
import ChatStatusSummary from '../components/chat/ChatStatusSummary.vue';
import { fetchConversationMessages, fetchConversationNpcs } from '../api/chat.js';
import { saveProviderSettings } from '../api/providers.js';
import { useNotify } from '../composables/useNotify';
import { useChatConversation } from '../composables/chat/useChatConversation';
import { useChatAccessory } from '../composables/chat/useChatAccessory';
import { useChatAppearance } from '../composables/chat/useChatAppearance';
import { useChatMessageActions } from '../composables/chat/useChatMessageActions';
import { useChatScroll } from '../composables/chat/useChatScroll';
import { useChatSubmit } from '../composables/chat/useChatSubmit';
import { useChatWorkspaceUi } from '../composables/chat/useChatWorkspaceUi';
import { useProviderModels } from '../composables/useProviderModels';
import { isPhoneViewport } from '../composables/useViewport';
import { refreshProviderModels } from '../services/modelCatalog';
import { callEventMethod } from '../utils/eventMethods';

const EconomyPanel = defineAsyncComponent(() => import('../components/EconomyPanel.vue'));
const NpcPanel = defineAsyncComponent(() => import('../components/NpcPanel.vue'));
const ScenePanel = defineAsyncComponent(() => import('../components/ScenePanel.vue'));
const SaveLoadPanel = defineAsyncComponent(() => import('../components/SaveLoadPanel.vue'));
const ChatSettingsDrawer = defineAsyncComponent(() => import('../components/chat/ChatSettingsDrawer.vue'));
const ChatContextInspector = defineAsyncComponent(() => import('../components/chat/ChatContextInspector.vue'));
const ChatModelSwitcher = defineAsyncComponent(() => import('../components/chat/ChatModelSwitcher.vue'));

const props = defineProps({
  route: { type: Object, required: true },
  user: { type: Object, default: null },
  provider: { type: Object, default: null },
  theme: { type: String, default: 'light' }
});
const emit = defineEmits(['navigate', 'provider-saved', 'toggle-theme']);
const notify = useNotify();

const chatShellRef = ref(null);
const messageScroller = ref(null);
const messageListRef = ref(null);
const statusToolRailRef = ref(null);
const composerWrap = ref(null);
const composerTextarea = ref(null);
const npcRefreshKey = ref(0);
const modelSwitcherOpen = ref(false);
const modelSwitcherRefreshing = ref(false);
const modelSwitcherSaving = ref(false);
const worldBookMatchDialogOpen = ref(false);
const contextInspectorOpen = ref(false);
const statusBarUpdateStatus = ref('not-updated');
const statusSummaryExpanded = ref(false);
const statusBarCollapseRequest = ref(0);
const npcUpdateStatus = ref('not-updated');
let conversationLoadToken = 0;
let modelRefreshToken = 0;
let modelSaveToken = 0;
let chatViewDisposed = false;
let latestNpcFingerprint = '';
let accessoryRefreshSnapshot = {
  conversationId: '',
  statusBar: '',
  npc: '',
  npcSynced: true
};

const ACCESSORY_UPDATING = 'updating';
const ACCESSORY_UPDATED = 'updated';
const ACCESSORY_NOT_UPDATED = 'not-updated';

function showError(message) {
  const needsFix = /API Key|SK|密钥|供应商|网关|模型/.test(message);
  notify.error(message, {
    actionLabel: needsFix ? '去设置' : '',
    action: needsFix ? navigateToSettingsFromToast : null,
    duration: needsFix ? 8000 : undefined
  });
}

function navigateToSettingsFromToast() {
  if (chatViewDisposed) {
    return;
  }
  emit('navigate', 'settings');
}

function showActionNotice(message, type = 'success') {
  const method = notify[type] || notify.info;
  method(message);
}

const {
  conversation, conversations, characters, messages,
  loading, error, sidebarLoadError, sidebarLoading, historySearch, sidebarOpen, settingsDrawerOpen,
  selectedConversationIds, conversationActionBusy, startConversationBusy,
  savePanelOpen, npcPanelOpen, economyPanelOpen,
  presetList, selectedPresetId,
  filteredConversations, visibleConversationIds,
  selectedConversationCount, allVisibleConversationsSelected, conversationReady,
  loadSidebarData, reloadSidebarData, startNewConversation, openConversation,
  openSidebar, closeSidebar, openSettings, closeSettings,
  openSavePanel, closeSavePanel, openNpcPanel, closeNpcPanel,
  openEconomyPanel, closeEconomyPanel,
  toggleConversationSelection, toggleAllVisibleConversations,
  deleteOneConversation, deleteSelectedConversations,
  setActiveConversationIfChanged, setMessagesIfChanged,
  formatConversationUsage,
  cleanup: cleanupConversationState
} = useChatConversation({ route: props.route, emit, showError });

const {
  activeTool,
  openTool: setActiveWorkspaceTool,
  closeTool: clearActiveWorkspaceTool,
  resetTools: resetWorkspaceTools
} = useChatWorkspaceUi();

const {
  statusBar, statusBarForm, statusBarEditorOpen, statusBarSaving,
  statusBarTemplateMode, statusBarTemplateConfig, statusBarTemplateIssues, statusBarTemplateCfg,
  accessorySettingsOpen, accessorySaving, accessorySkills, accessorySkillResults,
  accessorySkillItems,
  hasStatusBarContent, showEconomyFeature, showNpcFeature, showSceneFeature,
  loadStatusBar, loadEconomyBalance, loadAccessorySkills,
  syncAccessorySkills, isAccessorySkillActiveLocal,
  saveAccessorySkillChanges, applyStatusBarUpdate, handleSkillResult,
  syncStatusBarForm, addStatusBarVariable, removeStatusBarVariable,
  saveStatusBarChanges, deleteStatusBarAction,
  openStatusBarEditor, closeStatusBarEditor, setStatusBarTemplateMode,
  addStatusCharacter, removeStatusCharacter,
  addCharacterVariable, removeCharacterVariable,
  addQuickReply, removeQuickReply,
  closeAccessoryPanels, cleanupAccessory
} = useChatAccessory({ conversation, setActiveConversationIfChanged, showActionNotice, showError });

const {
  chatAppearanceForm, authorChatAppearance, chatViewportIsPhone, appearanceSaving,
  chatLorebookId, worldBooks, worldBooksLoading,
  effectiveChatAppearance, activeChatBackgroundUrl, chatMainStyle, chatScopeSelector,
  activeCharacter, activeRenderPlugins,
  syncConversationAppearance, resetConversationAppearance, saveConversationAppearanceChanges,
  setChatLorebookId, applyConversationAppearance, disposeConversationAppearance,
  handleAppearanceBackgroundUpload, clearAppearanceField, handleSettingsBackgroundUpload,
  loadWorldBooks
} = useChatAppearance({
  conversation, characters, chatShellRef, messageScroller,
  composerWrap, composerTextarea,
  user: computed(() => props.user), provider: computed(() => props.provider), messages, notify,
  openSidebar, closeSidebar, openSettings, closeSettings,
  scrollToBottom: (...args) => scroll.scrollToBottom(...args),
  setActiveConversationIfChanged,
  showActionNotice, showError
});

const {
  editingMessageId, editingMessageContent, messageActionBusy, copyBusy,
  toggleReasoning, expandReasoning, reasoningOpen,
  isReasoningTyping, isContentTyping, messagePlaceholder,
  messageAuthorName, messageAuthorInitial, messageAvatarUrl,
  canEditMessage, canDeleteMessage, canRerunMessageEdit, canBranchMessage,
  beginEditMessage, cancelEditMessage,
  setEditingMessageContent, saveMessageEdit, prepareMessageEditRerun, removeMessage, copyMessage,
  messageSwipeState, swipeLoading, initMessageSwipes, swipeMessagePrev, swipeMessageNext, getSwipeDisplay,
  conversationBranches, branchBusy, loadConversationBranches, handleBranchMessage,
  resetMessageUiState, cleanup: cleanupMessageActions
} = useChatMessageActions({
  messages, messageScroller, route: props.route,
  user: computed(() => props.user), activeCharacter,
  loadSidebarData, onCopyFallback: appendCopyFallbackToComposer, showActionNotice, showError
});

const scroll = useChatScroll({
  messageScroller,
  conversationId: computed(() => props.route.params.id),
  scrollToMessageFallback: (messageId, options) => messageListRef.value?.scrollToMessage?.(messageId, options)
});

const {
  showScrollBottomButton,
  handleMessageScroll, handleWheelScrollIntent,
  handleTouchStart, handleTouchMove,
  isPinnedToBottom, hasUserPausedAutoScroll, stickToBottomIfNeeded, scrollToBottom, scrollToMessage, restoreMessageScrollPosition,
  saveMessageScrollPosition, cleanup: cleanupScroll
} = scroll;

function setMessageListRef(instance) {
  messageListRef.value = instance || null;
  messageScroller.value = instance?.getScrollElement?.() || null;
}

function prepareExpandedStatusBarForSubmit() {
  const statusBarRoot = messageScroller.value?.querySelector('.status-bar-wrapper .status-bar-root');
  const statusBarExpanded = statusBarRoot?.getAttribute('aria-expanded') === 'true';
  const hasExpandedStatus = statusSummaryExpanded.value || statusBarExpanded;
  if (hasExpandedStatus && chatViewportIsPhone.value) {
    if (statusSummaryExpanded.value) {
      statusSummaryExpanded.value = false;
    } else {
      statusBarCollapseRequest.value += 1;
    }
  }
  return hasExpandedStatus;
}

const {
  input, chatAttachments, attachmentBusy, useStream, thinkingEnabled, imageGenerationEnabled,
  sending, usage, lastFailure, latestWorldBookMatches,
  canSend, canContinueGeneration, canToggleThinking, canToggleImageGeneration, canUseStream, canAddAttachments, chatProviderCapabilities,
  submitDraft, submit, continueGeneration, stop, restoreLastFailureInput, retryLastFailure, dismissLastFailure,
  addChatAttachmentFiles, removeChatAttachment, clearChatAttachments,
  setSelectedPresetId, toggleUseStream, toggleThinking, toggleImageGeneration,
  cleanup: cleanupSubmit
} = useChatSubmit({
  route: props.route, messages, provider: computed(() => props.provider),
  selectedPresetId, statusBar,
  syncStatusBarForm, applyStatusBarUpdate, handleSkillResult: handleAccessorySkillResult,
  loadStatusBar,
  loadSidebarData, loadEconomyBalance,
  onAccessoryRefreshStart: beginAccessoryRefreshStatus,
  onAccessoryRefresh: refreshAccessoryPanels,
  isPinnedToBottom,
  hasUserPausedAutoScroll,
  stickToBottomIfNeeded,
  scrollToMessage,
  prepareExpandedStatusBarForSubmit,
  expandReasoning,
  showError
});
const { providerModels, syncProviderModels } = useProviderModels(computed(() => props.provider));
const chatRenderPlugins = computed(() => activeRenderPlugins());
const composerHasDraft = computed(() => Boolean(input.value.trim() || chatAttachments.value.length));
const activeChatFailure = computed(() => {
  const failure = lastFailure.value;
  return failure?.conversationId === props.route.params.id ? failure : null;
});
const worldBookMatchSummary = computed(() => {
  const matches = Array.isArray(latestWorldBookMatches.value) ? latestWorldBookMatches.value : [];
  const summary = [];
  for (const match of matches) {
    if (!match?.id) {
      continue;
    }
    summary.push({
      ...match,
      positionLabel: worldBookPositionLabel(match.position),
      roleLabel: worldBookRoleLabel(match.role)
    });
  }
  return summary;
});
const showWorldBookMatchSummary = computed(() => effectiveChatAppearance.value.showWorldBookMatches !== false);

function hasWorldBookMatchesForMessage(message) {
  return Boolean(
    message?.id
    && latestAssistantMessage.value?.id === message.id
    && showWorldBookMatchSummary.value
    && worldBookMatchSummary.value.length
  );
}

function openWorldBookMatchDialog(message) {
  if (!hasWorldBookMatchesForMessage(message)) {
    return;
  }
  worldBookMatchDialogOpen.value = true;
}

function closeWorldBookMatchDialog() {
  worldBookMatchDialogOpen.value = false;
}

function openContextInspector() {
  if (!conversationReady.value) {
    return;
  }
  contextInspectorOpen.value = true;
}

function closeContextInspector() {
  contextInspectorOpen.value = false;
}

function openWorkspaceTool(key, event) {
  if (key !== 'appearance' && !conversationReady.value) return;
  closeWorkspaceToolSurfaces();
  if (!setActiveWorkspaceTool(key, event)) return;
  if (key === 'appearance') openSettings();
  if (key === 'context') openContextInspector();
  if (key === 'npc') openNpcPanel();
  if (key === 'economy') openEconomyPanel();
  if (key === 'saves') openSavePanel();
}

function closeWorkspaceTool(key = activeTool.value, options = {}) {
  closeWorkspaceToolSurfaces();
  clearActiveWorkspaceTool(key, options);
}

function closeWorkspaceToolSurfaces() {
  if (settingsDrawerOpen.value) closeSettings();
  if (contextInspectorOpen.value) closeContextInspector();
  if (npcPanelOpen.value) closeNpcPanel();
  if (economyPanelOpen.value) closeEconomyPanel();
  if (savePanelOpen.value) closeSavePanel();
}

function handleStatusToolKeydown(event) {
  if (event.key !== 'Tab') return;
  const focusable = statusToolRailRef.value?.querySelectorAll?.(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function worldBookPositionLabel(position) {
  if (position === 'at_start') return '开头';
  if (position === 'after_char') return '角色后';
  if (position === 'at_depth') return '按深度';
  return '角色前';
}

function worldBookRoleLabel(role) {
  if (Number(role) === 1) return 'user';
  if (Number(role) === 2) return 'assistant';
  return 'system';
}

async function copyLastFailureMessage() {
  const failure = activeChatFailure.value;
  const message = failure?.diagnosticId
    ? `${failure.message}\n诊断 ID: ${failure.diagnosticId}`
    : failure?.message || '';
  if (!message) {
    return;
  }
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(message);
    notify.success('已复制错误信息');
  } catch {
    notify.error('复制失败，请手动选择错误信息。');
  }
}

function restoreFailureToComposer() {
  if (restoreLastFailureInput()) {
    scheduleComposerLayoutUpdate({ focus: true });
  }
}

async function retryFailureFromPanel() {
  await retryLastFailure();
  scheduleComposerLayoutUpdate({ focus: true });
}

function canSaveMessageEditAndRerun(message) {
  return canRerunMessageEdit(message)
    && !sending.value
    && !attachmentBusy.value;
}

async function saveMessageEditAndRerun(message) {
  if (sending.value || attachmentBusy.value) {
    return;
  }
  if (composerHasDraft.value) {
    notify.warning('请先处理输入框草稿后再重跑。');
    scheduleComposerLayoutUpdate({ focus: true });
    return;
  }
  const draft = await prepareMessageEditRerun(message);
  if (!draft) {
    return;
  }
  const submitted = await submitDraft(draft.content, draft.attachments);
  if (!submitted) {
    notify.warning('重跑未开始，请检查输入框状态。');
  }
  scheduleComposerLayoutUpdate({ focus: true });
}

function openModelSwitcher() {
  if (sending.value) {
    return;
  }
  syncProviderModels();
  modelSwitcherOpen.value = true;
}

function closeModelSwitcher() {
  if (modelSwitcherSaving.value) return;
  modelSwitcherOpen.value = false;
}

function providerPayloadWithModel(model) {
  const provider = props.provider || {};
  return {
    providerType: provider.providerType || 'custom',
    gatewayName: provider.gatewayName || '',
    baseUrl: provider.baseUrl || '',
    model,
    supportsReasoning: Boolean(provider.supportsReasoning),
    extraBody: provider.extraBody ?? '{}'
  };
}

async function refreshQuickModels() {
  if (modelSwitcherRefreshing.value || modelSwitcherSaving.value) {
    return;
  }
  const requestToken = ++modelRefreshToken;
  const providerSnapshot = { ...(props.provider || {}) };
  const refreshKey = providerRefreshKey(providerSnapshot);
  if (!providerSnapshot.baseUrl) {
    modelSwitcherRefreshing.value = false;
    showError('请先配置网关地址后再刷新模型。');
    return;
  }
  modelSwitcherRefreshing.value = true;
  try {
    const models = await refreshProviderModels(providerSnapshot, { forceRefresh: true });
    if (!isCurrentModelRefresh(requestToken, refreshKey)) return;
    syncProviderModels();
    if (models.length) {
      notify.success(`已刷新 ${models.length} 个模型。`);
    } else {
      notify.info('当前网关没有返回可选模型。');
    }
  } catch (err) {
    if (!isCurrentModelRefresh(requestToken, refreshKey)) return;
    showError(err.message);
  } finally {
    if (isCurrentModelRefresh(requestToken, refreshKey)) {
      modelSwitcherRefreshing.value = false;
    }
  }
}

function isCurrentModelRefresh(requestToken, refreshKey) {
  return !chatViewDisposed
    && requestToken === modelRefreshToken
    && refreshKey === providerRefreshKey(props.provider || {});
}

function isCurrentModelSave(requestToken, saveKey) {
  return !chatViewDisposed
    && requestToken === modelSaveToken
    && saveKey === providerRefreshKey(props.provider || {});
}

function providerRefreshKey(provider = {}) {
  return [
    provider.providerType || '',
    provider.gatewayName || '',
    provider.baseUrl || '',
    Boolean(provider.apiKey || provider.apiKeySet),
    Boolean(provider.supportsReasoning),
    provider.extraBody ?? '{}'
  ].join('|');
}

async function saveQuickModel(model) {
  if (modelSwitcherSaving.value) {
    return;
  }
  const nextModel = String(model || '').trim();
  if (!nextModel) return;
  if (!props.provider?.baseUrl) {
    showError('请先配置网关地址后再切换模型。');
    return;
  }
  if (nextModel === props.provider?.model) {
    modelSwitcherOpen.value = false;
    return;
  }
  const requestToken = ++modelSaveToken;
  const saveKey = providerRefreshKey(props.provider || {});
  modelSwitcherSaving.value = true;
  try {
    const saved = await saveProviderSettings(providerPayloadWithModel(nextModel));
    if (!isCurrentModelSave(requestToken, saveKey)) {
      return;
    }
    notify.success(`已切换模型：${saved.model || nextModel}`);
    modelSwitcherOpen.value = false;
    emit('provider-saved');
  } catch (err) {
    if (isCurrentModelSave(requestToken, saveKey)) {
      showError(err.message);
    }
  } finally {
    if (isCurrentModelSave(requestToken, saveKey)) {
      modelSwitcherSaving.value = false;
    }
  }
}

async function loadConversation() {
  const conversationId = props.route.params.id;
  if (chatViewDisposed || !conversationId) return;
  const requestToken = ++conversationLoadToken;
  if (conversation.value?.id && conversation.value.id !== conversationId) {
    setActiveConversationIfChanged(null);
    setMessagesIfChanged([]);
    applyStatusBarUpdate(null, { syncForm: false });
    syncAccessorySkills();
    resetAccessoryUpdateStatus({ clearNpcFingerprint: true });
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMessages(conversationId);
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    setActiveConversationIfChanged(result.conversation);
    setMessagesIfChanged(result.messages);
    await nextTick();
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    loading.value = false;
    syncConversationAppearance(result.conversation?.settings);
    syncAccessorySkills(result.conversation?.settings?.accessorySkills);
    await applyConversationAppearance();
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    // Parallel: these 4 operations are independent of each other
    const [, , , branchesResult] = await Promise.all([
      loadStatusBar(),
      loadAccessorySkills(),
      typeof initMessageSwipes === 'function'
        ? initMessageSwipes(conversationId)
      : Promise.resolve(),
      loadConversationBranches(conversationId)
    ]);
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    await syncNpcFingerprint(conversationId);
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    resetAccessoryUpdateStatus();
    restoreMessageScrollPosition(messages);
  } catch (err) {
    if (!isCurrentConversationLoad(requestToken, conversationId)) return;
    showError(err.message);
  } finally {
    if (isCurrentConversationLoad(requestToken, conversationId)) {
      loading.value = false;
    }
  }
}

function isCurrentConversationLoad(requestToken, conversationId) {
  return !chatViewDisposed
    && requestToken === conversationLoadToken
    && props.route.params.id === conversationId;
}

async function onSavesLoaded(payload = {}) {
  const eventConversationId = payload?.conversationId || '';
  if (chatViewDisposed || !eventConversationId || eventConversationId !== props.route.params.id) {
    return;
  }
  await loadConversation();
  if (
    chatViewDisposed ||
    props.route.params.id !== eventConversationId ||
    conversation.value?.id !== eventConversationId
  ) {
    return;
  }
  await loadSidebarData();
}

function handleStatusBarQuickReply(text) {
  if (!text) return;
  const current = input.value || '';
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  input.value = current + sep + text;
  scheduleComposerLayoutUpdate({ focus: true });
}

function appendCopyFallbackToComposer(text) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return false;
  }
  const current = input.value || '';
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  input.value = current + sep + normalizedText;
  scheduleComposerLayoutUpdate({ focus: true });
  return true;
}

function handleNpcPanelOpenUpdate(value) {
  if (value) {
    openWorkspaceTool('npc');
  } else {
    closeWorkspaceTool('npc');
  }
}

function beginAccessoryRefreshStatus() {
  const conversationId = conversation.value?.id || '';
  accessoryRefreshSnapshot = {
    conversationId,
    statusBar: serializeStatusBarSnapshot(statusBar.value),
    npc: latestNpcFingerprint,
    npcSynced: false
  };
  statusBarUpdateStatus.value = isAccessorySkillActiveLocal('statusBarAgent')
    ? ACCESSORY_UPDATING
    : ACCESSORY_NOT_UPDATED;
  npcUpdateStatus.value = showNpcFeature.value
    ? ACCESSORY_UPDATING
    : ACCESSORY_NOT_UPDATED;
  return hasPendingAccessoryRefresh();
}

function handleAccessorySkillResult(data = {}) {
  const eventConversationId = String(data?.conversationId || '').trim();
  if (!eventConversationId || eventConversationId !== conversation.value?.id) {
    return;
  }
  const result = data.result || {};
  if (data.skill === 'statusBarAgent') {
    const hasUpdates = Array.isArray(result.updates)
      ? result.updates.length > 0
      : Boolean(result.statusBar);
    statusBarUpdateStatus.value = data.ok && hasUpdates
      ? ACCESSORY_UPDATED
      : ACCESSORY_NOT_UPDATED;
  }
  if (data.skill === 'npcAgent') {
    const hasUpdates = (Array.isArray(result.npcs) && result.npcs.length > 0) ||
      (Array.isArray(result.memories) && result.memories.length > 0);
    npcUpdateStatus.value = data.ok && hasUpdates
      ? ACCESSORY_UPDATED
      : ACCESSORY_NOT_UPDATED;
  }
  handleSkillResult(data);
}

async function refreshAccessoryPanels(payload = {}) {
  refreshStatusBarUpdateStatus(payload);
  const shouldRefreshNpcPanel = await refreshNpcUpdateStatus(Boolean(payload?.isFinal));
  if (npcPanelOpen.value && shouldRefreshNpcPanel) {
    npcRefreshKey.value += 1;
  }
  return hasPendingAccessoryRefresh();
}

function hasPendingAccessoryRefresh() {
  return statusBarUpdateStatus.value === ACCESSORY_UPDATING ||
    npcUpdateStatus.value === ACCESSORY_UPDATING;
}

function refreshStatusBarUpdateStatus(payload = {}) {
  if (statusBarUpdateStatus.value !== ACCESSORY_UPDATING) {
    return;
  }
  if (!accessoryRefreshSnapshot.conversationId || accessoryRefreshSnapshot.conversationId !== conversation.value?.id) {
    return;
  }
  const statusBarResult = Array.isArray(payload.results) ? payload.results[0] : null;
  if (statusBarResult?.status === 'fulfilled') {
    const nextFingerprint = serializeStatusBarSnapshot(statusBarResult.value);
    if (nextFingerprint !== accessoryRefreshSnapshot.statusBar) {
      accessoryRefreshSnapshot.statusBar = nextFingerprint;
      statusBarUpdateStatus.value = ACCESSORY_UPDATED;
      return;
    }
  }
  if (payload.isFinal) {
    statusBarUpdateStatus.value = ACCESSORY_NOT_UPDATED;
  }
}

async function refreshNpcUpdateStatus(isFinal = false) {
  if (chatViewDisposed) {
    return false;
  }
  if (!showNpcFeature.value) {
    npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
    return false;
  }
  const conversationId = conversation.value?.id;
  if (!conversationId || accessoryRefreshSnapshot.conversationId !== conversationId) {
    return false;
  }
  if (npcUpdateStatus.value !== ACCESSORY_UPDATING && accessoryRefreshSnapshot.npcSynced) {
    return false;
  }
  try {
    const npcs = await fetchConversationNpcs(conversationId);
    if (
      chatViewDisposed ||
      conversation.value?.id !== conversationId ||
      accessoryRefreshSnapshot.conversationId !== conversationId
    ) {
      return false;
    }
    const nextFingerprint = serializeNpcSnapshot(npcs);
    const npcChanged = nextFingerprint !== accessoryRefreshSnapshot.npc;
    if (npcUpdateStatus.value === ACCESSORY_UPDATING && npcChanged) {
      npcUpdateStatus.value = ACCESSORY_UPDATED;
    }
    latestNpcFingerprint = nextFingerprint;
    accessoryRefreshSnapshot.npcSynced = true;
    return npcChanged;
  } catch {
    // Keep the visible state pending until the final scheduled poll can settle it.
    return false;
  } finally {
    if (
      isFinal &&
      !chatViewDisposed &&
      npcUpdateStatus.value === ACCESSORY_UPDATING &&
      conversation.value?.id === conversationId &&
      accessoryRefreshSnapshot.conversationId === conversationId
    ) {
      npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
    }
  }
}

async function syncNpcFingerprint(conversationId = conversation.value?.id) {
  if (chatViewDisposed) {
    return latestNpcFingerprint;
  }
  if (!conversationId || !showNpcFeature.value) {
    latestNpcFingerprint = '';
    return latestNpcFingerprint;
  }
  try {
    const npcs = await fetchConversationNpcs(conversationId);
    if (chatViewDisposed || conversation.value?.id !== conversationId) {
      return latestNpcFingerprint;
    }
    latestNpcFingerprint = serializeNpcSnapshot(npcs);
  } catch {
    if (!chatViewDisposed && conversation.value?.id === conversationId) {
      latestNpcFingerprint = '';
    }
  }
  return latestNpcFingerprint;
}

function handleNpcPanelLoaded(payload = {}) {
  if (npcUpdateStatus.value === ACCESSORY_UPDATING) {
    return;
  }
  const eventConversationId = payload?.conversationId || '';
  if (!eventConversationId || eventConversationId !== conversation.value?.id) {
    return;
  }
  const npcs = Array.isArray(payload?.npcs) ? payload.npcs : [];
  latestNpcFingerprint = serializeNpcSnapshot(npcs);
}

function resetAccessoryUpdateStatus(options = {}) {
  statusBarUpdateStatus.value = ACCESSORY_NOT_UPDATED;
  npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
  if (options.clearNpcFingerprint) {
    latestNpcFingerprint = '';
  }
  accessoryRefreshSnapshot = {
    conversationId: conversation.value?.id || '',
    statusBar: serializeStatusBarSnapshot(statusBar.value),
    npc: latestNpcFingerprint,
    npcSynced: true
  };
}

function serializeStatusBarSnapshot(value = null) {
  if (!value) {
    return '';
  }
  let snapshot = '';
  snapshot = appendSnapshotField(snapshot, value.id || '');
  snapshot = appendSnapshotField(snapshot, value.name || '');
  snapshot = appendSnapshotField(snapshot, value.template || '');
  snapshot = appendSnapshotField(snapshot, value.updatedAt || '');
  const sourceVariables = Array.isArray(value.variables) ? value.variables : [];
  snapshot = appendSnapshotField(snapshot, sourceVariables.length);
  for (let index = 0; index < sourceVariables.length; index += 1) {
    const item = sourceVariables[index];
    snapshot = appendSnapshotField(snapshot, item?.name || '');
    snapshot = appendSnapshotField(snapshot, item?.value ?? '');
    snapshot = appendSnapshotField(snapshot, item?.max ?? '');
    snapshot = appendSnapshotField(snapshot, item?.color || '');
  }
  return snapshot;
}

function serializeNpcSnapshot(value = []) {
  const items = [];
  const sourceNpcs = Array.isArray(value) ? value : [];
  for (let index = 0; index < sourceNpcs.length; index += 1) {
    const npc = sourceNpcs[index];
    const name = String(npc?.name || '');
    let snapshot = '';
    snapshot = appendSnapshotField(snapshot, name);
    snapshot = appendSnapshotField(snapshot, Number(npc?.memoryCount || 0));
    snapshot = appendSnapshotField(snapshot, Number(npc?.behaviorCount || 0));
    snapshot = appendSnapshotField(snapshot, npc?.source || '');
    snapshot = appendSnapshotField(snapshot, Number(npc?.confidence || 0));
    snapshot = appendSnapshotField(snapshot, npc?.evidence || '');
    items.push({ name, snapshot });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  let serialized = '';
  for (let index = 0; index < items.length; index += 1) {
    serialized += items[index].snapshot;
  }
  return serialized;
}

function appendSnapshotField(snapshot, value) {
  const text = String(value ?? '');
  return `${snapshot}${text.length}:${text};`;
}

async function createBranchFromMessage(message) {
  const branchConversationId = props.route.params.id;
  await handleBranchMessage(message, branchConversationId, async (branchId, isCurrentBranchAction, invalidateBranchAction) => {
    if (!isCurrentBranchAction()) {
      return;
    }
    await loadSidebarData();
    if (!isCurrentBranchAction()) {
      return;
    }
    navigateFromBranchCreation(branchId, invalidateBranchAction);
  });
}

function navigateFromBranchCreation(branchId, invalidateBranchAction) {
  invalidateBranchAction?.();
  emit('navigate', 'chat', { id: branchId });
}

function canSwipePrev(message) {
  return (messageSwipeState[message.id]?.activeIndex || 0) > 0;
}

function canSwipeNext(message) {
  const state = messageSwipeState[message.id];
  return Boolean(state && state.swipeCount > 1 && state.activeIndex < state.swipeCount - 1);
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && worldBookMatchDialogOpen.value) {
    closeWorldBookMatchDialog();
    return;
  }
  if (event.key === 'Escape' && activeTool.value) {
    closeWorkspaceTool(activeTool.value);
    return;
  }
  if (event.key === 'Escape' && contextInspectorOpen.value) {
    closeContextInspector();
    return;
  }
  if (event.key === 'Escape' && modelSwitcherOpen.value) {
    closeModelSwitcher();
    return;
  }
  if (event.key === 'Escape' && settingsDrawerOpen.value) {
    closeSettings();
    return;
  }
  if (event.key === 'Escape' && npcPanelOpen.value) {
    closeNpcPanel();
    return;
  }
  if (event.key === 'Escape' && sidebarOpen.value) {
    closeSidebar();
  }
}

let suppressNpcPanelClick = false;

function handleGlobalPointerDown(event) {
  if (!npcPanelOpen.value) {
    return;
  }
  const target = event?.target;
  const shouldClose = target?.closest?.('.npc-close') || target?.classList?.contains('npc-panel-overlay');
  if (!shouldClose) {
    return;
  }
  suppressNpcPanelClick = true;
  closeWorkspaceTool('npc');
  callEventMethod(event, 'preventDefault');
  callEventMethod(event, 'stopPropagation');
}

function handleGlobalClick(event) {
  if (!suppressNpcPanelClick) {
    return;
  }
  suppressNpcPanelClick = false;
  callEventMethod(event, 'preventDefault');
  callEventMethod(event, 'stopPropagation');
}

function handleComposerEnter(payload) {
  const isEnter = payload?.isEnter === true;
  if (isEnter && isPhoneViewport()) {
    return;
  }
  callEventMethod(payload?.event, 'preventDefault');
  submit();
}

function handleComposerEnterFromComposer(payload) {
  handleComposerEnter(payload);
}

// isPhoneViewport is now imported from composables/useViewport.js

let userResizedHeight = 0;
let isUserResizing = false;
let isAutoSizingTextarea = false;
let autoSizingTextareaHeight = 0;
let autoSizingTextareaRafId = null;
let composerLayoutTickPending = false;
let composerFocusPending = false;
let composerLayoutTickId = 0;
let viewportLayoutRafId = null;
let textareaResizeRafId = null;

function resizeComposerTextarea() {
  if (chatViewDisposed) return;
  const el = composerWrap.value?.textareaRef || composerTextarea.value;
  if (!el) return;
  const maxHeight = readComposerTextareaMaxHeight(el);
  el.style.height = 'auto';
  const scrollH = el.scrollHeight;
  const minHeight = isUserResizing ? Math.min(userResizedHeight, maxHeight) : 0;
  const targetHeight = Math.min(Math.max(scrollH, minHeight), maxHeight);
  isAutoSizingTextarea = true;
  autoSizingTextareaHeight = targetHeight;
  if (autoSizingTextareaRafId !== null) {
    cancelChatFrame(autoSizingTextareaRafId);
  }
  el.style.height = `${targetHeight}px`;
  el.style.overflowY = scrollH > maxHeight ? 'auto' : 'hidden';
  autoSizingTextareaRafId = scheduleChatFrame(() => {
    autoSizingTextareaRafId = null;
    if (chatViewDisposed) return;
    isAutoSizingTextarea = false;
  });
  updateComposerDock();
}

function handleTextareaResize() {
  if (chatViewDisposed) return;
  const el = composerWrap.value?.textareaRef || composerTextarea.value;
  if (!el) return;
  const maxH = readComposerTextareaMaxHeight(el);
  const h = el.offsetHeight;
  if (isAutoSizingTextarea || Math.abs(h - autoSizingTextareaHeight) <= 1) {
    updateComposerDock();
    return;
  }
  if (h > maxH * 0.6) {
    userResizedHeight = Math.min(h, maxH);
    isUserResizing = true;
  }
  updateComposerDock();
}

function scheduleTextareaResizeUpdate() {
  if (chatViewDisposed) return;
  if (textareaResizeRafId !== null) {
    return;
  }
  textareaResizeRafId = scheduleChatFrame(() => {
    textareaResizeRafId = null;
    handleTextareaResize();
  });
}

function resetUserResize() {
  if (chatViewDisposed) return;
  isUserResizing = false;
  userResizedHeight = 0;
}

function readComposerTextareaMaxHeight(el) {
  const customValue = window.getComputedStyle(el).getPropertyValue('--composer-textarea-max-height');
  const parsed = Number.parseFloat(customValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return isPhoneViewport() ? 112 : 180;
}

function handleViewportResize() {
  if (chatViewDisposed) return;
  chatViewportIsPhone.value = isPhoneViewport();
  resizeComposerTextarea();
  updateComposerDock();
}

function scheduleViewportLayoutUpdate() {
  if (chatViewDisposed) return;
  if (viewportLayoutRafId !== null) {
    return;
  }
  viewportLayoutRafId = scheduleChatFrame(() => {
    viewportLayoutRafId = null;
    handleViewportResize();
  });
}

let composerDockRafId = null;
let composerResizeObserver = null;
let textareaResizeObserver = null;

function updateComposerDock() {
  if (chatViewDisposed) return;
  if (composerDockRafId !== null) {
    cancelChatFrame(composerDockRafId);
  }
  composerDockRafId = scheduleChatFrame(() => {
    composerDockRafId = null;
    if (chatViewDisposed) {
      return;
    }
    const shell = chatShellRef.value;
    const wrap = composerWrap.value?.wrapRef || composerWrap.value;
    if (!shell || !wrap) {
      return;
    }

    shell.style.setProperty('--chat-composer-height', `${Math.ceil(wrap.getBoundingClientRect().height)}px`);

    if (!isPhoneViewport() || !window.visualViewport) {
      shell.style.setProperty('--chat-keyboard-inset', '0px');
      shell.style.setProperty('--chat-viewport-top-inset', '0px');
      shell.style.setProperty('--chat-visual-viewport-height', '100dvh');
      return;
    }

    const viewport = window.visualViewport;
    const viewportTopInset = Math.max(0, viewport.offsetTop || 0);
    const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    shell.style.setProperty('--chat-viewport-top-inset', `${Math.round(viewportTopInset)}px`);
    shell.style.setProperty('--chat-visual-viewport-height', `${Math.round(viewport.height)}px`);
    shell.style.setProperty('--chat-keyboard-inset', `${Math.round(keyboardInset)}px`);
  });
}

function scheduleChatFrame(callback) {
  if (typeof requestAnimationFrame !== 'function') {
    callback();
    return null;
  }
  return requestAnimationFrame(callback);
}

function cancelChatFrame(frameId) {
  if (frameId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameId);
  }
}

function scheduleComposerLayoutUpdate(options = {}) {
  if (chatViewDisposed) return;
  composerFocusPending = composerFocusPending || Boolean(options.focus);
  if (composerLayoutTickPending) {
    return;
  }
  composerLayoutTickPending = true;
  const tickId = ++composerLayoutTickId;
  nextTick(() => {
    composerLayoutTickPending = false;
    if (chatViewDisposed || tickId !== composerLayoutTickId) {
      return;
    }
    const shouldFocus = composerFocusPending;
    composerFocusPending = false;
    const el = composerWrap.value?.textareaRef || composerTextarea.value;
    if (shouldFocus && el) {
      el.focus();
    }
    resizeComposerTextarea();
    updateComposerDock();
  });
}

function cancelComposerLayoutWork() {
  composerLayoutTickId += 1;
  composerLayoutTickPending = false;
  composerFocusPending = false;
  if (composerDockRafId !== null) {
    cancelChatFrame(composerDockRafId);
    composerDockRafId = null;
  }
  if (autoSizingTextareaRafId !== null) {
    cancelChatFrame(autoSizingTextareaRafId);
    autoSizingTextareaRafId = null;
  }
  if (viewportLayoutRafId !== null) {
    cancelChatFrame(viewportLayoutRafId);
    viewportLayoutRafId = null;
  }
  if (textareaResizeRafId !== null) {
    cancelChatFrame(textareaResizeRafId);
    textareaResizeRafId = null;
  }
}

const latestAssistantMessage = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index];
    if (message?.role === 'assistant') {
      return message;
    }
  }
  return null;
});

const latestMessage = computed(() => {
  const messageList = Array.isArray(messages.value) ? messages.value : [];
  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const message = messageList[index];
    if (message?.id) {
      return message;
    }
  }
  return null;
});

const hasStatusBarVisible = computed(() => {
  if (hasStatusBarContent.value) return true;
  const cfg = statusBarTemplateConfig.value;
  return cfg.displayMode === 'immersive' && Array.isArray(cfg.characters) && cfg.characters.length > 0;
});

onMounted(async () => {
  await loadConversation();
  if (chatViewDisposed) return;
  await loadSidebarData();
  if (chatViewDisposed) return;
  await loadEconomyBalance();
  if (chatViewDisposed) return;
  resizeComposerTextarea();
  updateComposerDock();
  window.addEventListener('resize', scheduleViewportLayoutUpdate);
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('pointerdown', handleGlobalPointerDown, true);
  window.addEventListener('click', handleGlobalClick, true);
  window.addEventListener('focusin', scheduleViewportLayoutUpdate);
  window.addEventListener('focusout', scheduleViewportLayoutUpdate);
  window.visualViewport?.addEventListener('resize', scheduleViewportLayoutUpdate);
  window.visualViewport?.addEventListener('scroll', scheduleViewportLayoutUpdate);
  const wrapEl = composerWrap.value?.wrapRef || composerWrap.value;
  if (wrapEl && typeof ResizeObserver !== 'undefined') {
    composerResizeObserver = new ResizeObserver(() => {
      updateComposerDock();
    });
    composerResizeObserver.observe(wrapEl);
  }
  const textareaEl = composerWrap.value?.textareaRef || composerTextarea.value;
  if (textareaEl && typeof ResizeObserver !== 'undefined') {
    textareaResizeObserver = new ResizeObserver(() => {
      scheduleTextareaResizeUpdate();
    });
    textareaResizeObserver.observe(textareaEl);
  }
});

onBeforeUnmount(() => {
  chatViewDisposed = true;
  conversationLoadToken += 1;
  modelRefreshToken += 1;
  modelSaveToken += 1;
  saveMessageScrollPosition();
  cleanupSubmit();
  cleanupConversationState();
  cleanupMessageActions();
  cleanupAccessory();
  disposeConversationAppearance();
  cleanupScroll();
  window.removeEventListener('resize', scheduleViewportLayoutUpdate);
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
  window.removeEventListener('click', handleGlobalClick, true);
  window.removeEventListener('focusin', scheduleViewportLayoutUpdate);
  window.removeEventListener('focusout', scheduleViewportLayoutUpdate);
  window.visualViewport?.removeEventListener('resize', scheduleViewportLayoutUpdate);
  window.visualViewport?.removeEventListener('scroll', scheduleViewportLayoutUpdate);
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  if (textareaResizeObserver) {
    textareaResizeObserver.disconnect();
    textareaResizeObserver = null;
  }
  cancelComposerLayoutWork();
});

watch(input, (newVal) => {
  if (!newVal) {
    resetUserResize();
  }
  scheduleComposerLayoutUpdate();
});

watch(settingsDrawerOpen, (isOpen) => {
  if (!isOpen) {
    closeAccessoryPanels();
    return;
  }
  if (!chatViewDisposed && isOpen && worldBooks.value.length === 0) {
    loadWorldBooks();
  }
});

watch(() => providerRefreshKey(props.provider || {}), (providerKey, previousProviderKey) => {
  if (chatViewDisposed || !previousProviderKey || providerKey === previousProviderKey) {
    return;
  }
  modelRefreshToken += 1;
  modelSaveToken += 1;
  modelSwitcherRefreshing.value = false;
  modelSwitcherSaving.value = false;
});

watch(() => conversation.value?.id || '', (conversationId, previousConversationId) => {
  if (chatViewDisposed || !previousConversationId || conversationId === previousConversationId) {
    return;
  }
  resetMessageUiState();
  statusSummaryExpanded.value = false;
  closeWorldBookMatchDialog();
  closeWorkspaceToolSurfaces();
  resetWorkspaceTools();
  closeAccessoryPanels();
});

watch(activeTool, (tool) => {
  if (tool !== 'status') return;
  nextTick(() => statusToolRailRef.value?.querySelector?.('button:not(:disabled)')?.focus());
});

watch(statusSummaryExpanded, async (expanded) => {
  if (!expanded) return;
  await nextTick();
  const disclosure = messageScroller.value?.querySelector('.chat-status-disclosure');
  disclosure?.scrollIntoView?.({ block: 'nearest' });
});

watch([showWorldBookMatchSummary, worldBookMatchSummary], ([shouldShow, matches]) => {
  if (!shouldShow || !matches.length) {
    closeWorldBookMatchDialog();
  }
});

watch(showNpcFeature, (active) => {
  if (chatViewDisposed) return;
  if (active && conversation.value?.id) {
    void syncNpcFingerprint(conversation.value.id);
  } else if (!active) {
    latestNpcFingerprint = '';
    npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
  }
});
</script>

<template>
  <section
    ref="chatShellRef"
    class="deep-chat-shell"
    :class="{ 'sidebar-collapsed': !sidebarOpen }"
  >
    <ChatSidebar
      :open="sidebarOpen"
      :user="user"
      :conversation="conversation"
      :history-search="historySearch"
      :filtered-conversations="filteredConversations"
      :selected-conversation-ids="selectedConversationIds"
      :all-visible-conversations-selected="allVisibleConversationsSelected"
      :selected-conversation-count="selectedConversationCount"
      :conversation-action-busy="conversationActionBusy"
      :start-conversation-busy="startConversationBusy"
      :conversation-branches="conversationBranches"
      :sidebar-load-error="sidebarLoadError"
      :sidebar-loading="sidebarLoading"
      :route="route"
      :format-conversation-usage="formatConversationUsage"
      @close="closeSidebar"
      @navigate="(page, params) => emit('navigate', page, params)"
      @start-new="startNewConversation"
      @open-conversation="openConversation"
      @update:history-search="(val) => historySearch = val"
      @toggle-all="toggleAllVisibleConversations"
      @toggle-selection="toggleConversationSelection"
      @delete-one="deleteOneConversation"
      @delete-selected="deleteSelectedConversations"
      @reload-sidebar="reloadSidebarData"
      @open-settings="(event) => openWorkspaceTool('appearance', event)"
    />

      <ChatSettingsDrawer
        :open="settingsDrawerOpen"
        :conversation="conversation"
        :sending="sending"
        :image-generation-enabled="imageGenerationEnabled"
        :can-toggle-image-generation="canToggleImageGeneration"
        :author-chat-appearance="authorChatAppearance"
      :chat-appearance-form="chatAppearanceForm"
      :appearance-saving="appearanceSaving"
      :chat-lorebook-id="chatLorebookId"
      :world-books="worldBooks"
      :world-books-loading="worldBooksLoading"
      :accessory-settings-open="accessorySettingsOpen"
      :accessory-saving="accessorySaving"
      :accessory-skills="accessorySkills"
      :accessory-skill-items="accessorySkillItems"
      :provider-model-options="providerModels"
      :status-bar="statusBar"
      :status-bar-editor-open="statusBarEditorOpen"
      :status-bar-saving="statusBarSaving"
      :status-bar-form="statusBarForm"
      :status-bar-template-mode="statusBarTemplateMode"
      :status-bar-template-issues="statusBarTemplateIssues"
      :status-bar-template-cfg="statusBarTemplateCfg"
        @close="closeWorkspaceTool('appearance')"
        @toggle-image-generation="toggleImageGeneration"
        @save-appearance="saveConversationAppearanceChanges"
      @update:chat-lorebook-id="setChatLorebookId"
      @reset-appearance="resetConversationAppearance(conversation?.settings)"
      @background-upload="handleSettingsBackgroundUpload"
      @clear-field="clearAppearanceField"
      @update:accessory-settings-open="(val) => accessorySettingsOpen = val"
      @save-accessory="saveAccessorySkillChanges"
      @open-status-bar-editor="openStatusBarEditor"
      @close-status-bar-editor="closeStatusBarEditor"
      @update:status-bar-template-mode="setStatusBarTemplateMode"
      @add-status-bar-variable="addStatusBarVariable"
      @remove-status-bar-variable="removeStatusBarVariable"
      @save-status-bar="saveStatusBarChanges"
      @delete-status-bar="deleteStatusBarAction"
      @add-status-character="addStatusCharacter"
      @remove-status-character="removeStatusCharacter"
      @add-character-variable="addCharacterVariable"
      @remove-character-variable="removeCharacterVariable"
      @add-quick-reply="addQuickReply"
      @remove-quick-reply="removeQuickReply"
    />

    <section class="deep-chat-main" :style="chatMainStyle" :data-chat-scope="conversation?.id || 'active'">
      <ChatHeader
        :show-economy-feature="showEconomyFeature"
        :show-npc-feature="showNpcFeature"
        :show-scene-feature="showSceneFeature"
        :conversation-ready="conversationReady"
        :theme="theme"
        :conversation="conversation"
        :provider="provider"
        :sending="sending"
        :active-tool="activeTool || ''"
        @navigate="(page) => emit('navigate', page)"
        @toggle-theme="emit('toggle-theme')"
        @open-sidebar="openSidebar"
        @open-status="(event) => openWorkspaceTool('status', event)"
        @open-context="(event) => openWorkspaceTool('context', event)"
        @open-economy="(event) => openWorkspaceTool('economy', event)"
        @open-npc="(event) => openWorkspaceTool('npc', event)"
        @open-scene="(event) => openWorkspaceTool('scene', event)"
        @open-saves="(event) => openWorkspaceTool('saves', event)"
        @open-settings="(event) => openWorkspaceTool('appearance', event)"
      />

      <VirtualMessageList
        :ref="setMessageListRef"
        class="deep-message-scroll"
        :messages="messages"
        :virtualize="messages.length > 80"
        :overscan="6"
        aria-live="polite"
        @scroll.passive="handleMessageScroll"
        @wheel.passive="handleWheelScrollIntent"
        @touchstart.passive="handleTouchStart"
        @touchmove.passive="handleTouchMove"
      >
        <template #empty>
        <article
          v-if="loading"
          class="deep-message assistant chat-loading-notice"
          role="status"
          aria-live="polite"
        >
          <div class="deep-message-author" aria-hidden="true">
            <span class="deep-message-avatar">
              <span>F</span>
            </span>
            <small>FLAI</small>
          </div>
          <div class="deep-message-content">
            <div class="deep-message-name">系统通知</div>
            <div class="deep-bubble is-typing is-waiting">
              <span class="typing-text">正在加载对话</span>
            </div>
          </div>
        </article>
        <section v-else class="chat-empty-conversation" aria-live="polite">
          <span aria-hidden="true">F</span>
          <h2>从这里开始新的故事</h2>
          <p>输入一条消息，或先从会话设置中选择预设与世界书。</p>
        </section>
        </template>
        <template #default="{ message }">
          <ChatMessageItem
            :message="message"
            :editing-message-id="editingMessageId"
            :editing-message-content="editingMessageContent"
            :reasoning-open="reasoningOpen(message.id)"
            :is-reasoning-typing="isReasoningTyping(message)"
            :is-content-typing="isContentTyping(message)"
            :message-placeholder="messagePlaceholder(message)"
            :author-name="messageAuthorName(message)"
            :author-initial="messageAuthorInitial(message)"
            :avatar-url="messageAvatarUrl(message)"
            :can-edit="canEditMessage(message)"
            :can-delete="canDeleteMessage(message)"
            :can-rerun-edit="canSaveMessageEditAndRerun(message)"
            :can-continue="canContinueGeneration && latestMessage?.id === message.id"
            :branch-can="canBranchMessage(message)"
            :message-action-busy="messageActionBusy === message.id || branchBusy"
            :copy-busy="copyBusy"
            :render-plugins="chatRenderPlugins"
            :swipe-display="getSwipeDisplay(message)"
            :swipe-can-prev="canSwipePrev(message)"
            :swipe-can-next="canSwipeNext(message)"
            :swipe-loading="swipeLoading.has(message.id) || messageActionBusy === message.id || branchBusy"
            :branch-busy="branchBusy"
            :world-book-match-count="hasWorldBookMatchesForMessage(message) ? worldBookMatchSummary.length : 0"
            @toggle-reasoning="toggleReasoning"
            @begin-edit="beginEditMessage"
            @cancel-edit="cancelEditMessage"
            @save-edit="saveMessageEdit"
            @save-edit-rerun="saveMessageEditAndRerun"
            @continue-generation="continueGeneration"
            @delete="removeMessage"
            @copy="copyMessage"
            @update:editing-message-content="setEditingMessageContent"
            @swipe-prev="swipeMessagePrev"
            @swipe-next="(item) => swipeMessageNext(item, route.params.id)"
            @branch="createBranchFromMessage"
            @open-worldbook-matches="openWorldBookMatchDialog"
          />
          <div v-if="hasStatusBarVisible && message === latestAssistantMessage" class="status-bar-wrapper chat-status-summary-wrapper">
            <ChatStatusSummary
              v-model:expanded="statusSummaryExpanded"
              :status-bar="statusBar"
              :template-config="statusBarTemplateConfig"
              :update-status="statusBarUpdateStatus"
            >
              <template #details>
                <StatusBar
                  embedded
                  :status-bar="statusBar"
                  :template-config="statusBarTemplateConfig"
                  :update-status="statusBarUpdateStatus"
                  @quick-reply="handleStatusBarQuickReply"
                />
              </template>
            </ChatStatusSummary>
          </div>
        </template>
        <template #footer>
        <aside
          v-if="activeChatFailure"
          class="chat-recovery-panel"
          role="alert"
          aria-live="polite"
        >
          <div class="chat-recovery-copy">
            <strong>这次回复失败了</strong>
            <p>{{ activeChatFailure.message }}</p>
            <small v-if="activeChatFailure.diagnosticId">诊断 ID: {{ activeChatFailure.diagnosticId }}</small>
          </div>
          <div class="chat-recovery-actions">
            <button
              v-if="activeChatFailure.canRetry"
              class="chat-recovery-button"
              type="button"
              :disabled="sending"
              :aria-busy="sending"
              @click="retryFailureFromPanel"
            >
              <RotateCcw :size="16" />
              <span>重试发送</span>
            </button>
            <button class="chat-recovery-button" type="button" :disabled="sending" @click="restoreFailureToComposer">
              <RotateCcw :size="16" />
              <span>放回输入框</span>
            </button>
            <button class="chat-recovery-button" type="button" @click="openModelSwitcher">
              <Bot :size="16" />
              <span>切换模型</span>
            </button>
            <button class="chat-recovery-button" type="button" @click="emit('navigate', 'settings')">
              <Settings :size="16" />
              <span>打开设置</span>
            </button>
            <button class="chat-recovery-icon" type="button" aria-label="复制错误信息" title="复制错误信息" @click="copyLastFailureMessage">
              <Clipboard :size="16" />
            </button>
            <button class="chat-recovery-icon" type="button" aria-label="关闭失败提示" title="关闭" @click="dismissLastFailure">
              <X :size="16" />
            </button>
          </div>
        </aside>
        </template>
      </VirtualMessageList>

      <ChatComposer
        ref="composerWrap"
        :input="input"
        :sending="sending"
        :can-send="canSend"
        :use-stream="useStream"
        :thinking-enabled="thinkingEnabled"
        :can-toggle-thinking="canToggleThinking"
        :can-use-stream="canUseStream"
        :can-add-attachments="canAddAttachments"
        :model-capabilities="chatProviderCapabilities"
        :chat-viewport-is-phone="chatViewportIsPhone"
        :show-scroll-bottom-button="showScrollBottomButton"
        :usage="usage"
        :attachments="chatAttachments"
        :attachment-busy="attachmentBusy"
        :preset-list="presetList"
        :selected-preset-id="selectedPresetId"
        :current-model="provider?.model || ''"
        :model-options="providerModels"
        :model-saving="modelSwitcherSaving"
        :current-model-supports-reasoning="Boolean(chatProviderCapabilities?.reasoning)"
        @update:input="(val) => input = val"
        @submit="handleComposerEnterFromComposer"
        @stop="stop"
        @toggle-stream="toggleUseStream"
        @toggle-thinking="toggleThinking"
        @open-model-switcher="openModelSwitcher"
        @quick-model-change="saveQuickModel"
        @add-attachments="addChatAttachmentFiles"
        @remove-attachment="removeChatAttachment"
        @clear-attachments="clearChatAttachments"
        @scroll-to-bottom="scrollToBottom()"
        @update:selected-preset-id="setSelectedPresetId"
      />
      <div
        v-if="worldBookMatchDialogOpen && showWorldBookMatchSummary && worldBookMatchSummary.length"
        class="chat-worldbook-match-overlay"
        @click.self="closeWorldBookMatchDialog"
      >
        <section
          class="chat-worldbook-match-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-worldbook-match-title"
        >
          <header class="chat-worldbook-match-head">
            <div>
              <span>
                <BookOpen :size="15" />
                世界书命中来源
              </span>
              <h2 id="chat-worldbook-match-title">本轮命中 {{ worldBookMatchSummary.length }} 条世界书</h2>
            </div>
            <button
              class="chat-worldbook-match-close"
              type="button"
              aria-label="关闭世界书命中来源"
              title="关闭"
              @click="closeWorldBookMatchDialog"
            >
              <X :size="18" />
            </button>
          </header>
          <ul class="chat-worldbook-match-list">
            <li v-for="match in worldBookMatchSummary" :key="match.id">
              <strong>{{ match.name }}</strong>
              <span>{{ match.worldBookName }} · {{ match.positionLabel }} · {{ match.roleLabel }}{{ match.position === 'at_depth' ? ` depth ${match.depth}` : '' }}</span>
            </li>
          </ul>
        </section>
      </div>
      <ChatModelSwitcher
        :open="modelSwitcherOpen"
        :provider="provider"
        :models="providerModels"
        :refreshing="modelSwitcherRefreshing"
        :saving="modelSwitcherSaving"
        @close="closeModelSwitcher"
        @refresh="refreshQuickModels"
        @save="saveQuickModel"
      />
      <ChatContextInspector
        :open="contextInspectorOpen"
        :conversation-id="conversation?.id || ''"
        :draft-content="input"
        :draft-attachments="chatAttachments"
        :preset-id="selectedPresetId"
        @close="closeWorkspaceTool('context')"
      />
    </section>

    <button
      v-if="activeTool === 'status'"
      class="chat-tool-backdrop"
      type="button"
      aria-label="关闭角色状态"
      @click="closeWorkspaceTool('status')"
    ></button>
    <aside v-if="activeTool === 'status'" ref="statusToolRailRef" class="chat-tool-rail" role="dialog" aria-modal="true" aria-labelledby="chat-status-panel-title" @keydown="handleStatusToolKeydown">
      <header class="chat-tool-rail-header">
        <div>
          <p>当前会话</p>
          <h2 id="chat-status-panel-title">完整角色状态</h2>
        </div>
        <button class="deep-icon-button" type="button" aria-label="关闭角色状态" @click="closeWorkspaceTool('status')">
          <X :size="18" />
        </button>
      </header>
      <div class="chat-tool-rail-body">
        <StatusBar
          :status-bar="statusBar"
          :template-config="statusBarTemplateConfig"
          :update-status="statusBarUpdateStatus"
          :collapse-request="statusBarCollapseRequest"
          @quick-reply="handleStatusBarQuickReply"
        />
      </div>
    </aside>

    <EconomyPanel
      v-if="conversation?.id && showEconomyFeature"
      :conversation-id="conversation.id"
      :open="economyPanelOpen"
      @close="closeWorkspaceTool('economy')"
    />
    <NpcPanel
      v-if="conversation?.id && (showNpcFeature || npcPanelOpen)"
      :conversation-id="conversation.id"
      :open="npcPanelOpen"
      :refresh-key="npcRefreshKey"
      :update-status="npcUpdateStatus"
      @update:open="handleNpcPanelOpenUpdate"
      @npcs-loaded="handleNpcPanelLoaded"
      @close="closeWorkspaceTool('npc')"
    />
    <ScenePanel
      v-if="conversation?.id && (showSceneFeature || activeTool === 'scene')"
      :conversation-id="conversation.id"
      :open="activeTool === 'scene'"
      @close="closeWorkspaceTool('scene')"
    />
    <SaveLoadPanel
      v-if="conversation?.id"
      :conversation-id="conversation.id"
      :open="savePanelOpen"
      @close="closeWorkspaceTool('saves')"
      @loaded="onSavesLoaded"
    />
  </section>
</template>

<style scoped>
.chat-recovery-panel {
  width: min(calc(100% - 24px), var(--chat-readable-width, 860px));
  margin: 8px auto 12px;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 90%, transparent);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--primary) 12%, transparent);
}

.chat-recovery-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.chat-recovery-copy strong {
  display: block;
  color: var(--text);
  font-size: 0.92rem;
}

.chat-recovery-copy p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.chat-recovery-copy small {
  display: block;
  margin-top: 4px;
  color: color-mix(in srgb, var(--muted) 86%, var(--text));
  font-size: 0.76rem;
  line-height: 1.4;
}

.chat-recovery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.chat-recovery-button,
.chat-recovery-icon {
  min-height: 34px;
  border: 1px solid color-mix(in srgb, var(--line) 84%, transparent);
  background: color-mix(in srgb, var(--surface) 84%, transparent);
  color: var(--text);
}

.chat-recovery-button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 0.82rem;
}

.chat-recovery-icon {
  display: inline-grid;
  width: 34px;
  place-items: center;
  border-radius: 999px;
}

.chat-recovery-button:hover:not(:disabled),
.chat-recovery-icon:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary) 36%, var(--line));
  background: color-mix(in srgb, var(--primary-soft) 52%, var(--surface));
}

.chat-worldbook-match-overlay {
  position: fixed;
  inset: 0;
  z-index: 128;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.chat-worldbook-match-dialog {
  display: grid;
  width: min(560px, calc(100vw - 28px));
  max-height: min(620px, calc(100dvh - 36px));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--line));
  border-radius: 8px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 96%, #ffffff 4%);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
}

.chat-worldbook-match-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
}

.chat-worldbook-match-head span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.chat-worldbook-match-head h2 {
  margin: 4px 0 0;
  font-size: 1.04rem;
  line-height: 1.28;
}

.chat-worldbook-match-close {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--line) 84%, transparent);
  border-radius: 999px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-strong) 84%, transparent);
}

.chat-worldbook-match-close:hover {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, var(--line));
  background: var(--primary-soft);
}

.chat-worldbook-match-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 14px 18px 18px;
  overflow: auto;
  list-style: none;
}

.chat-worldbook-match-list li {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--line) 68%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 74%, transparent);
}

.chat-worldbook-match-list strong,
.chat-worldbook-match-list span {
  overflow-wrap: anywhere;
}

.chat-worldbook-match-list strong {
  color: var(--text);
  font-size: 0.86rem;
}

.chat-worldbook-match-list span {
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

@media (max-width: 520px) {
  .chat-worldbook-match-overlay {
    align-items: end;
    padding: 12px;
  }

  .chat-worldbook-match-dialog {
    width: 100%;
    max-height: min(640px, calc(100dvh - 24px));
  }
}
</style>
