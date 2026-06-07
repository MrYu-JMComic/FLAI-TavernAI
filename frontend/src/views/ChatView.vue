<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EconomyPanel from '../components/EconomyPanel.vue';
import NpcPanel from '../components/NpcPanel.vue';
import SaveLoadPanel from '../components/SaveLoadPanel.vue';
import StatusBar from '../components/StatusBar.vue';
import ChatSidebar from '../components/chat/ChatSidebar.vue';
import ChatSettingsDrawer from '../components/chat/ChatSettingsDrawer.vue';
import ChatHeader from '../components/chat/ChatHeader.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import ChatModelSwitcher from '../components/chat/ChatModelSwitcher.vue';
import ChatComposer from '../components/chat/ChatComposer.vue';
import { fetchConversationMessages, fetchConversationNpcs, saveProviderSettings } from '../api';
import { useNotify } from '../composables/useNotify';
import { useChatConversation } from '../composables/chat/useChatConversation';
import { useChatAccessory } from '../composables/chat/useChatAccessory';
import { useChatAppearance } from '../composables/chat/useChatAppearance';
import { useChatMessageActions } from '../composables/chat/useChatMessageActions';
import { useChatScroll } from '../composables/chat/useChatScroll';
import { useChatSubmit } from '../composables/chat/useChatSubmit';
import { useProviderModels } from '../composables/useProviderModels';
import { isPhoneViewport } from '../composables/useViewport';
import { refreshProviderModels } from '../services/modelCatalog';

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
const composerWrap = ref(null);
const composerTextarea = ref(null);
const npcRefreshKey = ref(0);
const modelSwitcherOpen = ref(false);
const modelSwitcherRefreshing = ref(false);
const modelSwitcherSaving = ref(false);
const statusBarUpdateStatus = ref('not-updated');
const npcUpdateStatus = ref('not-updated');
let conversationLoadToken = 0;
let modelRefreshToken = 0;
let modelSaveToken = 0;
let chatViewDisposed = false;
let latestNpcFingerprint = '';
let accessoryRefreshSnapshot = {
  conversationId: '',
  statusBar: '',
  npc: ''
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
  selectedConversationCount, allVisibleConversationsSelected,
  loadSidebarData, startNewConversation, openConversation,
  openSidebar, closeSidebar, openSettings, closeSettings,
  openSavePanel, closeSavePanel, openNpcPanel, closeNpcPanel,
  openEconomyPanel, closeEconomyPanel,
  toggleConversationSelection, toggleAllVisibleConversations,
  deleteOneConversation, deleteSelectedConversations,
  formatConversationUsage,
  cleanup: cleanupConversationState
} = useChatConversation({ route: props.route, emit, showError });

const {
  statusBar, statusBarForm, statusBarEditorOpen, statusBarSaving,
  statusBarTemplateMode, statusBarTemplateConfig, statusBarTemplateIssues, statusBarTemplateCfg,
  accessorySettingsOpen, accessorySaving, accessorySkills, accessorySkillResults,
  accessorySkillItems,
  hasStatusBarContent, showEconomyFeature, showNpcFeature,
  loadStatusBar, loadEconomyBalance, loadAccessorySkills,
  syncAccessorySkills, isAccessorySkillActiveLocal,
  saveAccessorySkillChanges, handleSkillResult,
  syncStatusBarForm, addStatusBarVariable, removeStatusBarVariable,
  saveStatusBarChanges, deleteStatusBarAction,
  openStatusBarEditor, closeStatusBarEditor, setStatusBarTemplateMode,
  addStatusCharacter, removeStatusCharacter,
  addCharacterVariable, removeCharacterVariable,
  addQuickReply, removeQuickReply,
  closeAccessoryPanels, cleanupAccessory
} = useChatAccessory({ conversation, showActionNotice, showError });

const {
  chatAppearanceForm, authorChatAppearance, chatViewportIsPhone, appearanceSaving,
  chatLorebookId, worldBooks, worldBooksLoading,
  effectiveChatAppearance, activeChatBackgroundUrl, chatMainStyle, chatScopeSelector,
  activeCharacter, activeRenderPlugins,
  syncConversationAppearance, saveConversationAppearanceChanges,
  applyConversationAppearance, disposeConversationAppearance,
  handleAppearanceBackgroundUpload, clearAppearanceField, handleSettingsBackgroundUpload,
  loadWorldBooks
} = useChatAppearance({
  conversation, characters, chatShellRef, messageScroller,
  composerWrap, composerTextarea,
  user: computed(() => props.user), provider: computed(() => props.provider), messages, notify,
  openSidebar, closeSidebar, openSettings, closeSettings,
  scrollToBottom: (...args) => scroll.scrollToBottom(...args),
  showActionNotice, showError
});

const {
  editingMessageId, editingMessageContent, messageActionBusy,
  toggleReasoning, expandReasoning, reasoningOpen,
  isReasoningTyping, isContentTyping, messagePlaceholder,
  messageAuthorName, messageAuthorInitial, messageAvatarUrl,
  canEditMessage, canDeleteMessage,
  beginEditMessage, cancelEditMessage,
  saveMessageEdit, removeMessage, copyMessage,
  messageSwipeState, swipeLoading, initMessageSwipes, swipeMessagePrev, swipeMessageNext, getSwipeDisplay,
  branchBusy, loadConversationBranches, handleBranchMessage,
  resetMessageUiState, cleanup: cleanupMessageActions
} = useChatMessageActions({
  messages, messageScroller, route: props.route,
  user: computed(() => props.user), activeCharacter,
  loadSidebarData, showActionNotice, showError
});

const scroll = useChatScroll({
  messageScroller,
  conversationId: computed(() => props.route.params.id)
});

const {
  showScrollBottomButton,
  handleMessageScroll, handleWheelScrollIntent,
  handleTouchStart, handleTouchMove,
  stickToBottomIfNeeded, scrollToBottom, restoreMessageScrollPosition,
  saveMessageScrollPosition, cleanup: cleanupScroll
} = scroll;

const {
  input, useStream, thinkingEnabled,
  sending, usage,
  canSend, canToggleThinking,
  submit, stop, toggleUseStream, toggleThinking,
  cleanup: cleanupSubmit
} = useChatSubmit({
  route: props.route, messages, provider: computed(() => props.provider),
  selectedPresetId, statusBar,
  syncStatusBarForm, handleSkillResult: handleAccessorySkillResult,
  loadStatusBar,
  loadSidebarData, loadEconomyBalance,
  onAccessoryRefreshStart: beginAccessoryRefreshStatus,
  onAccessoryRefresh: refreshAccessoryPanels,
  stickToBottomIfNeeded, expandReasoning, showError
});
const { providerModels, syncProviderModels } = useProviderModels(computed(() => props.provider));

function openModelSwitcher() {
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
  return requestToken === modelRefreshToken && refreshKey === providerRefreshKey(props.provider || {});
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
    Boolean(provider.supportsReasoning),
    provider.extraBody ?? '{}'
  ].join('|');
}

async function saveQuickModel(model) {
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
    if (!chatViewDisposed && requestToken === modelSaveToken) {
      modelSwitcherSaving.value = false;
    }
  }
}

async function loadConversation() {
  const conversationId = props.route.params.id;
  if (!conversationId) return;
  const requestToken = ++conversationLoadToken;
  if (conversation.value?.id && conversation.value.id !== conversationId) {
    conversation.value = null;
    messages.value = [];
    statusBar.value = null;
    syncAccessorySkills();
    resetAccessoryUpdateStatus({ clearNpcFingerprint: true });
  }
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMessages(conversationId);
    if (requestToken !== conversationLoadToken || props.route.params.id !== conversationId) return;
    conversation.value = result.conversation;
    messages.value = result.messages;
    await nextTick();
    syncConversationAppearance(result.conversation?.settings);
    syncAccessorySkills(result.conversation?.settings?.accessorySkills);
    await applyConversationAppearance();
    // Parallel: these 4 operations are independent of each other
    const [, , , branchesResult] = await Promise.all([
      loadStatusBar(),
      loadAccessorySkills(),
      typeof initMessageSwipes === 'function'
        ? initMessageSwipes(conversationId)
        : Promise.resolve(),
      loadConversationBranches(conversationId)
    ]);
    if (requestToken !== conversationLoadToken || props.route.params.id !== conversationId) return;
    await syncNpcFingerprint(conversationId);
    if (requestToken !== conversationLoadToken || props.route.params.id !== conversationId) return;
    resetAccessoryUpdateStatus();
    restoreMessageScrollPosition(messages);
  } catch (err) {
    if (requestToken !== conversationLoadToken || props.route.params.id !== conversationId) return;
    showError(err.message);
  } finally {
    if (requestToken === conversationLoadToken && props.route.params.id === conversationId) {
      loading.value = false;
    }
  }
}

async function onSavesLoaded() {
  await loadConversation();
  await loadSidebarData();
}

function handleStatusBarQuickReply(text) {
  if (!text) return;
  const current = input.value || '';
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  input.value = current + sep + text;
  scheduleComposerLayoutUpdate({ focus: true });
}

function handleNpcPanelOpenUpdate(value) {
  if (value) {
    openNpcPanel();
  } else {
    closeNpcPanel();
  }
}

function beginAccessoryRefreshStatus() {
  const conversationId = conversation.value?.id || '';
  accessoryRefreshSnapshot = {
    conversationId,
    statusBar: serializeStatusBarSnapshot(statusBar.value),
    npc: latestNpcFingerprint
  };
  statusBarUpdateStatus.value = isAccessorySkillActiveLocal('statusBarAgent')
    ? ACCESSORY_UPDATING
    : ACCESSORY_NOT_UPDATED;
  npcUpdateStatus.value = showNpcFeature.value
    ? ACCESSORY_UPDATING
    : ACCESSORY_NOT_UPDATED;
}

function handleAccessorySkillResult(data = {}) {
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
  await refreshNpcUpdateStatus(Boolean(payload?.isFinal));
  if (npcPanelOpen.value) {
    npcRefreshKey.value += 1;
  }
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
  if (!showNpcFeature.value) {
    npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
    return;
  }
  const conversationId = conversation.value?.id;
  if (!conversationId || accessoryRefreshSnapshot.conversationId !== conversationId) {
    return;
  }
  try {
    const npcs = await fetchConversationNpcs(conversationId);
    if (conversation.value?.id !== conversationId || accessoryRefreshSnapshot.conversationId !== conversationId) {
      return;
    }
    const nextFingerprint = serializeNpcSnapshot(npcs);
    if (npcUpdateStatus.value === ACCESSORY_UPDATING && nextFingerprint !== accessoryRefreshSnapshot.npc) {
      npcUpdateStatus.value = ACCESSORY_UPDATED;
    }
    latestNpcFingerprint = nextFingerprint;
  } catch {
    // Keep the visible state pending until the final scheduled poll can settle it.
  } finally {
    if (isFinal && npcUpdateStatus.value === ACCESSORY_UPDATING) {
      npcUpdateStatus.value = ACCESSORY_NOT_UPDATED;
    }
  }
}

async function syncNpcFingerprint(conversationId = conversation.value?.id) {
  if (!conversationId || !showNpcFeature.value) {
    latestNpcFingerprint = '';
    return latestNpcFingerprint;
  }
  try {
    const npcs = await fetchConversationNpcs(conversationId);
    if (conversation.value?.id !== conversationId) {
      return latestNpcFingerprint;
    }
    latestNpcFingerprint = serializeNpcSnapshot(npcs);
  } catch {
    latestNpcFingerprint = '';
  }
  return latestNpcFingerprint;
}

function handleNpcPanelLoaded(npcs = []) {
  if (npcUpdateStatus.value === ACCESSORY_UPDATING) {
    return;
  }
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
    npc: latestNpcFingerprint
  };
}

function serializeStatusBarSnapshot(value = null) {
  if (!value) {
    return '';
  }
  return JSON.stringify({
    id: value.id || '',
    name: value.name || '',
    template: value.template || '',
    updatedAt: value.updatedAt || '',
    variables: Array.isArray(value.variables)
      ? value.variables.map((item) => ({
        name: item?.name || '',
        value: item?.value ?? '',
        max: item?.max ?? '',
        color: item?.color || ''
      }))
      : []
  });
}

function serializeNpcSnapshot(value = []) {
  const items = Array.isArray(value) ? value : [];
  return JSON.stringify(items
    .map((npc) => ({
      name: String(npc?.name || ''),
      memoryCount: Number(npc?.memoryCount || 0),
      behaviorCount: Number(npc?.behaviorCount || 0),
      source: String(npc?.source || ''),
      confidence: Number(npc?.confidence || 0),
      evidence: String(npc?.evidence || '')
    }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

async function createBranchFromMessage(message) {
  await handleBranchMessage(message, props.route.params.id, async (branchId) => {
    await loadSidebarData();
    emit('navigate', 'chat', { id: branchId });
  });
}

function canSwipePrev(message) {
  return (messageSwipeState[message.id]?.activeIndex || 0) > 0;
}

function handleGlobalKeydown(event) {
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
  const target = event.target;
  const shouldClose = target?.closest?.('.npc-close') || target?.classList?.contains('npc-panel-overlay');
  if (!shouldClose) {
    return;
  }
  suppressNpcPanelClick = true;
  closeNpcPanel();
  event.preventDefault();
  event.stopPropagation();
}

function handleGlobalClick(event) {
  if (!suppressNpcPanelClick) {
    return;
  }
  suppressNpcPanelClick = false;
  event.preventDefault();
  event.stopPropagation();
}

function handleComposerEnter(payload) {
  const isEnter = payload?.isEnter === true;
  if (isEnter && isPhoneViewport()) {
    return;
  }
  const event = payload?.event;
  if (event?.preventDefault) {
    event.preventDefault();
  }
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
  if (autoSizingTextareaRafId) {
    cancelAnimationFrame(autoSizingTextareaRafId);
  }
  el.style.height = `${targetHeight}px`;
  el.style.overflowY = scrollH > maxHeight ? 'auto' : 'hidden';
  autoSizingTextareaRafId = requestAnimationFrame(() => {
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
  if (textareaResizeRafId) {
    return;
  }
  textareaResizeRafId = requestAnimationFrame(() => {
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
  if (viewportLayoutRafId) {
    return;
  }
  viewportLayoutRafId = requestAnimationFrame(() => {
    viewportLayoutRafId = null;
    handleViewportResize();
  });
}

let composerDockRafId = null;
let composerResizeObserver = null;
let textareaResizeObserver = null;

function updateComposerDock() {
  if (chatViewDisposed) return;
  if (composerDockRafId) {
    cancelAnimationFrame(composerDockRafId);
  }
  composerDockRafId = requestAnimationFrame(() => {
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
  if (composerDockRafId) {
    cancelAnimationFrame(composerDockRafId);
    composerDockRafId = null;
  }
  if (autoSizingTextareaRafId) {
    cancelAnimationFrame(autoSizingTextareaRafId);
    autoSizingTextareaRafId = null;
  }
  if (viewportLayoutRafId) {
    cancelAnimationFrame(viewportLayoutRafId);
    viewportLayoutRafId = null;
  }
  if (textareaResizeRafId) {
    cancelAnimationFrame(textareaResizeRafId);
    textareaResizeRafId = null;
  }
}

const latestAssistantMessage = computed(() => {
  return [...messages.value].reverse().find((m) => m.role === 'assistant') || null;
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
  closeAccessoryPanels();
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
    :data-chat-scope="conversation?.id || 'active'"
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
      @reload-sidebar="loadSidebarData"
      @open-settings="openSettings"
    />

    <ChatSettingsDrawer
      :open="settingsDrawerOpen"
      :conversation="conversation"
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
      @close="closeSettings"
      @save-appearance="saveConversationAppearanceChanges"
      @update:chat-lorebook-id="(val) => chatLorebookId = val"
      @reset-appearance="syncConversationAppearance(conversation?.settings)"
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

    <section class="deep-chat-main" :style="chatMainStyle">
      <ChatHeader
        :show-economy-feature="showEconomyFeature"
        :show-npc-feature="showNpcFeature"
        :theme="theme"
        @navigate="(page) => emit('navigate', page)"
        @toggle-theme="emit('toggle-theme')"
        @open-sidebar="openSidebar"
        @open-economy="openEconomyPanel"
        @open-npc="openNpcPanel"
        @open-saves="openSavePanel"
      />

      <div
        ref="messageScroller"
        class="deep-message-scroll"
        aria-live="polite"
        @scroll.passive="handleMessageScroll"
        @wheel.passive="handleWheelScrollIntent"
        @touchstart.passive="handleTouchStart"
        @touchmove.passive="handleTouchMove"
      >
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
        <template
          v-for="message in messages"
          :key="message.id"
        >
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
            :render-plugins="activeRenderPlugins()"
            :swipe-display="getSwipeDisplay(message)"
            :swipe-can-prev="canSwipePrev(message)"
            :swipe-can-next="message.role === 'assistant'"
            :swipe-loading="swipeLoading.has(message.id)"
            :branch-busy="branchBusy"
            @toggle-reasoning="toggleReasoning"
            @begin-edit="beginEditMessage"
            @cancel-edit="cancelEditMessage"
            @save-edit="saveMessageEdit"
            @delete="removeMessage"
            @copy="copyMessage"
            @update:editing-message-content="(val) => editingMessageContent = val"
            @swipe-prev="swipeMessagePrev"
            @swipe-next="(item) => swipeMessageNext(item, route.params.id)"
            @branch="createBranchFromMessage"
          />
          <div v-if="hasStatusBarVisible && message === latestAssistantMessage" class="status-bar-wrapper">
            <StatusBar
              :status-bar="statusBar"
              :template-config="statusBarTemplateConfig"
              :update-status="statusBarUpdateStatus"
              @quick-reply="handleStatusBarQuickReply"
            />
          </div>
        </template>
      </div>

      <ChatComposer
        ref="composerWrap"
        :input="input"
        :sending="sending"
        :can-send="canSend"
        :use-stream="useStream"
        :thinking-enabled="thinkingEnabled"
        :can-toggle-thinking="canToggleThinking"
        :chat-viewport-is-phone="chatViewportIsPhone"
        :show-scroll-bottom-button="showScrollBottomButton"
        :usage="usage"
        :preset-list="presetList"
        :selected-preset-id="selectedPresetId"
        :current-model="provider?.model || ''"
        @update:input="(val) => input = val"
        @submit="handleComposerEnterFromComposer"
        @stop="stop"
        @toggle-stream="toggleUseStream"
        @toggle-thinking="toggleThinking"
        @open-model-switcher="openModelSwitcher"
        @scroll-to-bottom="scrollToBottom()"
        @update:selected-preset-id="(val) => selectedPresetId = val"
      />
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
    </section>

    <EconomyPanel
      v-if="conversation?.id && showEconomyFeature"
      :conversation-id="conversation.id"
      :open="economyPanelOpen"
      @close="closeEconomyPanel"
    />
    <NpcPanel
      v-if="conversation?.id && showNpcFeature"
      :conversation-id="conversation.id"
      :open="npcPanelOpen"
      :refresh-key="npcRefreshKey"
      :update-status="npcUpdateStatus"
      @update:open="handleNpcPanelOpenUpdate"
      @npcs-loaded="handleNpcPanelLoaded"
      @close="closeNpcPanel"
    />
    <SaveLoadPanel
      v-if="conversation?.id"
      :conversation-id="conversation.id"
      :open="savePanelOpen"
      @close="closeSavePanel"
      @loaded="onSavesLoaded"
    />
  </section>
</template>
