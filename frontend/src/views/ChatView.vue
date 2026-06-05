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
import ChatComposer from '../components/chat/ChatComposer.vue';
import { fetchConversationMessages } from '../api';
import { useNotify } from '../composables/useNotify';
import { useChatConversation } from '../composables/chat/useChatConversation';
import { useChatAccessory } from '../composables/chat/useChatAccessory';
import { useChatAppearance } from '../composables/chat/useChatAppearance';
import { useChatMessageActions } from '../composables/chat/useChatMessageActions';
import { useChatScroll } from '../composables/chat/useChatScroll';
import { useChatSubmit } from '../composables/chat/useChatSubmit';
import { useProviderModels } from '../composables/useProviderModels';
import { isPhoneViewport } from '../composables/useViewport';

const props = defineProps({
  route: { type: Object, required: true },
  user: { type: Object, default: null },
  provider: { type: Object, default: null }
});
const emit = defineEmits(['navigate']);
const notify = useNotify();

const chatShellRef = ref(null);
const messageScroller = ref(null);
const composerWrap = ref(null);
const composerTextarea = ref(null);
const npcRefreshKey = ref(0);
let conversationLoadToken = 0;

function showError(message) {
  const needsFix = /API Key|SK|密钥|供应商|网关|模型/.test(message);
  notify.error(message, {
    actionLabel: needsFix ? '去设置' : '',
    action: needsFix ? () => emit('navigate', 'settings') : null,
    duration: needsFix ? 8000 : undefined
  });
}

function showActionNotice(message, type = 'success') {
  const method = notify[type] || notify.info;
  method(message);
}

const {
  conversation, conversations, characters, messages,
  loading, error, historySearch, sidebarOpen, settingsDrawerOpen,
  selectedConversationIds, conversationActionBusy,
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
  formatConversationUsage
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
  addQuickReply, removeQuickReply
} = useChatAccessory({ conversation, showActionNotice, showError });

const {
  chatAppearanceForm, authorChatAppearance, chatViewportIsPhone, appearanceSaving,
  chatLorebookId, worldBooks, worldBooksLoading,
  effectiveChatAppearance, activeChatBackgroundUrl, chatMainStyle, chatScopeSelector,
  activeCharacter, activeRenderPlugins,
  syncConversationAppearance, saveConversationAppearanceChanges,
  applyConversationAppearance, cleanupConversationAppearance,
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
  branchBusy, loadConversationBranches, handleBranchMessage
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
  syncStatusBarForm, handleSkillResult,
  loadStatusBar,
  loadSidebarData, loadEconomyBalance,
  onAccessoryRefresh: refreshAccessoryPanels,
  stickToBottomIfNeeded, expandReasoning, showError
});
const { providerModels } = useProviderModels(computed(() => props.provider));

async function loadConversation() {
  const conversationId = props.route.params.id;
  if (!conversationId) return;
  const requestToken = ++conversationLoadToken;
  if (conversation.value?.id && conversation.value.id !== conversationId) {
    conversation.value = null;
    messages.value = [];
    statusBar.value = null;
    syncAccessorySkills();
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
  nextTick(() => {
    const el = composerWrap.value?.textareaRef || composerTextarea.value;
    if (el) {
      el.focus();
      resizeComposerTextarea();
    }
  });
}

function handleNpcPanelOpenUpdate(value) {
  if (value) {
    openNpcPanel();
  } else {
    closeNpcPanel();
  }
}

function refreshAccessoryPanels() {
  if (npcPanelOpen.value) {
    npcRefreshKey.value += 1;
  }
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

function resizeComposerTextarea() {
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
    isAutoSizingTextarea = false;
    autoSizingTextareaRafId = null;
  });
  updateComposerDock();
}

function handleTextareaResize() {
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

function resetUserResize() {
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
  chatViewportIsPhone.value = isPhoneViewport();
  resizeComposerTextarea();
  updateComposerDock();
}

let composerDockRafId = null;
let composerResizeObserver = null;
let textareaResizeObserver = null;

function updateComposerDock() {
  if (composerDockRafId) {
    cancelAnimationFrame(composerDockRafId);
  }
  composerDockRafId = requestAnimationFrame(() => {
    const shell = chatShellRef.value;
    const wrap = composerWrap.value?.wrapRef || composerWrap.value;
    if (!shell || !wrap) {
      return;
    }

    shell.style.setProperty('--chat-composer-height', `${Math.ceil(wrap.getBoundingClientRect().height)}px`);

    if (!isPhoneViewport() || !window.visualViewport) {
      shell.style.setProperty('--chat-keyboard-inset', '0px');
      return;
    }

    const viewport = window.visualViewport;
    const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    shell.style.setProperty('--chat-keyboard-inset', `${Math.round(keyboardInset)}px`);
  });
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
  await loadSidebarData();
  await loadEconomyBalance();
  resizeComposerTextarea();
  updateComposerDock();
  window.addEventListener('resize', handleViewportResize);
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('pointerdown', handleGlobalPointerDown, true);
  window.addEventListener('click', handleGlobalClick, true);
  window.addEventListener('focusin', handleViewportResize);
  window.addEventListener('focusout', handleViewportResize);
  window.visualViewport?.addEventListener('resize', handleViewportResize);
  window.visualViewport?.addEventListener('scroll', handleViewportResize);
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
      handleTextareaResize();
    });
    textareaResizeObserver.observe(textareaEl);
  }
});

onBeforeUnmount(() => {
  conversationLoadToken += 1;
  saveMessageScrollPosition();
  cleanupSubmit();
  cleanupConversationAppearance();
  cleanupScroll();
  window.removeEventListener('resize', handleViewportResize);
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
  window.removeEventListener('click', handleGlobalClick, true);
  window.removeEventListener('focusin', handleViewportResize);
  window.removeEventListener('focusout', handleViewportResize);
  window.visualViewport?.removeEventListener('resize', handleViewportResize);
  window.visualViewport?.removeEventListener('scroll', handleViewportResize);
  if (composerResizeObserver) {
    composerResizeObserver.disconnect();
    composerResizeObserver = null;
  }
  if (textareaResizeObserver) {
    textareaResizeObserver.disconnect();
    textareaResizeObserver = null;
  }
  if (autoSizingTextareaRafId) {
    cancelAnimationFrame(autoSizingTextareaRafId);
    autoSizingTextareaRafId = null;
  }
});

watch(input, (newVal) => {
  if (!newVal) {
    resetUserResize();
  }
  nextTick(() => {
    resizeComposerTextarea();
    updateComposerDock();
  });
});

watch(settingsDrawerOpen, (isOpen) => {
  if (isOpen && worldBooks.value.length === 0) {
    loadWorldBooks();
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
      :filtered-conversations="filteredConversations"
      :selected-conversation-ids="selectedConversationIds"
      :all-visible-conversations-selected="allVisibleConversationsSelected"
      :selected-conversation-count="selectedConversationCount"
      :conversation-action-busy="conversationActionBusy"
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
        @navigate="(page) => emit('navigate', page)"
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
        <p v-if="loading" class="deep-muted">正在加载对话...</p>
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
            <StatusBar :status-bar="statusBar" :template-config="statusBarTemplateConfig" @quick-reply="handleStatusBarQuickReply" />
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
        @update:input="(val) => input = val"
        @submit="handleComposerEnterFromComposer"
        @stop="stop"
        @toggle-stream="toggleUseStream"
        @toggle-thinking="toggleThinking"
        @scroll-to-bottom="scrollToBottom()"
        @update:selected-preset-id="(val) => selectedPresetId = val"
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
      @update:open="handleNpcPanelOpenUpdate"
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
