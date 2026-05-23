<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, triggerRef, watch } from 'vue';
import {
  Brain,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Home,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
  Zap
} from '@lucide/vue';
import {
  createConversation,
  deleteConversation,
  deleteConversations,
  deleteMessage,
  fetchCharacters,
  fetchConversationMessages,
  fetchConversations,
  sendMessage,
  streamMessage,
  updateMessage
} from '../api';
import MarkdownContent from '../components/MarkdownContent.vue';

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

const conversation = ref(null);
const conversations = ref([]);
const characters = ref([]);
const messages = ref([]);
const input = ref('');
const useStream = ref(readLocalBoolean('flai-chat-use-stream', true));
const thinkingEnabled = ref(readLocalBoolean('flai-chat-thinking-enabled', false));
const sidebarOpen = ref(typeof window === 'undefined' ? true : window.innerWidth > 980);
const historySearch = ref('');
const loading = ref(false);
const sending = ref(false);
const error = ref('');
const usage = ref(null);
const providerMeta = ref(null);
const controller = ref(null);
const messageScroller = ref(null);
const composerTextarea = ref(null);
const isScrollPinned = ref(true);
const distanceToBottom = ref(0);
const expandedReasoning = ref(new Set());
const editingMessageId = ref('');
const editingMessageContent = ref('');
const messageActionBusy = ref('');
const conversationActionBusy = ref(false);
const selectedConversationIds = ref(new Set());
const actionNotice = ref('');
let stoppingByUser = false;
let scrollSaveTimer = null;
let actionNoticeTimer = null;
let lastManualScrollIntentAt = 0;
let touchStartY = 0;
let lastTouchY = 0;
let userPausedAutoScroll = false;
const streamIdleTimeoutMs = 60000;
const streamFastChunkLength = 120;
const streamMediumChunkLength = 48;
const streamPunctuationPauseMs = 58;
const scrollStickThreshold = 120;
const scrollButtonDistanceThreshold = 360;
const manualScrollIntentCooldownMs = 1400;
let graphemeSegmenter = null;

const canSend = computed(() => input.value.trim() && !sending.value);
const showScrollBottomButton = computed(() => {
  return !isScrollPinned.value && distanceToBottom.value > scrollButtonDistanceThreshold;
});
const canToggleThinking = computed(() => props.provider?.providerType === 'deepseek');
const needsProviderFix = computed(() => {
  return /API Key|SK|密钥|供应商|网关|模型/.test(error.value);
});
const filteredConversations = computed(() => {
  const query = historySearch.value.trim().toLowerCase();
  if (!query) {
    return conversations.value;
  }
  return conversations.value.filter((item) => {
    return `${item.title} ${item.character?.name || ''}`.toLowerCase().includes(query);
  });
});
const visibleConversationIds = computed(() => filteredConversations.value.map((item) => item.id));
const selectedConversationCount = computed(() => selectedConversationIds.value.size);
const allVisibleConversationsSelected = computed(() => {
  return visibleConversationIds.value.length > 0
    && visibleConversationIds.value.every((id) => selectedConversationIds.value.has(id));
});
const currentProviderLabel = computed(() => {
  return providerMeta.value?.provider || props.provider?.gatewayName || 'Local Mock';
});
const currentModelLabel = computed(() => {
  return providerMeta.value?.model || props.provider?.model || '未配置模型';
});

onMounted(async () => {
  await loadConversation();
  await loadSidebarData();
  resizeComposerTextarea();
  window.addEventListener('resize', handleViewportResize);
});

onBeforeUnmount(() => {
  saveMessageScrollPosition();
  if (scrollSaveTimer) {
    window.clearTimeout(scrollSaveTimer);
  }
  if (actionNoticeTimer) {
    window.clearTimeout(actionNoticeTimer);
  }
  window.removeEventListener('resize', handleViewportResize);
});

watch(useStream, (value) => {
  writeLocalBoolean('flai-chat-use-stream', value);
});

watch(thinkingEnabled, (value) => {
  writeLocalBoolean('flai-chat-thinking-enabled', value);
});

watch(input, () => {
  nextTick(() => resizeComposerTextarea());
});

async function loadConversation() {
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMessages(props.route.params.id);
    conversation.value = result.conversation;
    messages.value = result.messages;
    await nextTick();
    restoreMessageScrollPosition();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadSidebarData() {
  const currentCharacterId = conversation.value?.characterId;
  const [history, characterList] = await Promise.all([
    fetchConversations({ characterId: currentCharacterId }).catch(() => []),
    fetchCharacters().catch(() => [])
  ]);
  conversations.value = history;
  characters.value = characterList;
  pruneSelectedConversations();
}

async function startNewConversation() {
  error.value = '';
  const characterId = conversation.value?.characterId || characters.value[0]?.id;
  if (!characterId) {
    emit('navigate', 'home');
    return;
  }

  try {
    const created = await createConversation(characterId);
    await loadSidebarData();
    emit('navigate', 'chat', { id: created.id });
  } catch (err) {
    error.value = err.message;
  }
}

async function submit() {
  const content = input.value.trim();
  if (!content || sending.value) {
    return;
  }

  error.value = '';
  input.value = '';
  await nextTick();
  resizeComposerTextarea();
  const localUserDraft = {
    id: `local-user-${Date.now()}`,
    role: 'user',
    content,
    reasoning: '',
    createdAt: new Date().toISOString()
  };
  const assistantDraft = {
    id: `local-assistant-${Date.now()}`,
    role: 'assistant',
    content: '',
    reasoning: '',
    createdAt: new Date().toISOString(),
    streaming: true,
    reasoningStreaming: false,
    contentStreaming: false
  };
  messages.value.push(localUserDraft, assistantDraft);
  const localUser = messages.value[messages.value.length - 2];
  const assistant = messages.value[messages.value.length - 1];
  sending.value = true;
  await nextTick();
  stickToBottomIfNeeded(true);

  const requestPayload = {
    content,
    thinkingEnabled: canToggleThinking.value ? thinkingEnabled.value : true
  };
  let streamFinished = false;
  let streamTimedOut = false;
  let streamTimer = null;

  const clearStreamTimer = () => {
    if (streamTimer) {
      window.clearTimeout(streamTimer);
      streamTimer = null;
    }
  };
  const refreshStreamTimer = () => {
    clearStreamTimer();
    streamTimer = window.setTimeout(() => {
      streamTimedOut = true;
      controller.value?.abort();
    }, streamIdleTimeoutMs);
  };

  try {
    if (useStream.value) {
      controller.value = new AbortController();
      refreshStreamTimer();
      const streamResult = await streamMessage(
        props.route.params.id,
        requestPayload,
        {
          meta(data) {
            providerMeta.value = data;
            refreshStreamTimer();
          },
          async reasoning(data) {
            if (!assistant.reasoning) {
              expandReasoning(assistant.id);
            }
            assistant.reasoningStreaming = true;
            refreshStreamTimer();
            await appendStreamText(assistant, 'reasoning', data.text);
            await nextTick();
            stickToBottomIfNeeded();
          },
          async content(data) {
            assistant.reasoningStreaming = false;
            assistant.contentStreaming = true;
            refreshStreamTimer();
            await appendStreamText(assistant, 'content', data.text);
            await nextTick();
            stickToBottomIfNeeded();
          },
          async done(data) {
            streamFinished = true;
            clearStreamTimer();
            if (stoppingByUser || !assistant.streaming) {
              return;
            }
            finalizeStreamedAssistant(assistant, data.assistantMessage);
            usage.value = data.usage || data.assistantMessage?.usage || null;
            providerMeta.value = {
              ...(providerMeta.value || {}),
              provider: data.provider || providerMeta.value?.provider
            };
          },
          error(data) {
            streamFinished = true;
            clearStreamTimer();
            finishAssistantDraft(assistant);
            if (!stoppingByUser) {
              showError(data.error || '生成失败');
            }
          }
        },
        controller.value.signal
      );
      clearStreamTimer();
      if (streamResult?.aborted || !streamFinished) {
        finishAssistantDraft(assistant);
        if (streamTimedOut && !stoppingByUser) {
          showError('模型响应超时，请检查网络、余额或模型状态后重试。');
        } else if (!stoppingByUser && !streamFinished && !assistant.content && !assistant.reasoning) {
          showError(error.value || '连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。');
        }
      }
    } else {
      const result = await sendMessage(props.route.params.id, requestPayload);
      Object.assign(localUser, result.userMessage);
      Object.assign(assistant, result.assistantMessage, { streaming: false });
      usage.value = result.usage || null;
      providerMeta.value = { provider: result.provider };
    }
    await loadSidebarData();
  } catch (err) {
    clearStreamTimer();
    if (streamTimedOut && !stoppingByUser) {
      showError('模型响应超时，请检查网络、余额或模型状态后重试。');
    } else if (err.name !== 'AbortError' && !stoppingByUser) {
      showError(err.message);
    }
    if (err.data?.accepted === false) {
      messages.value = messages.value.filter((message) => message.id !== localUser.id);
    }
    finishAssistantDraft(assistant);
  } finally {
    clearStreamTimer();
    sending.value = false;
    controller.value = null;
    stoppingByUser = false;
  }
}

function stop() {
  stoppingByUser = true;
  controller.value?.abort();
  sending.value = false;
  const last = [...messages.value].reverse().find((message) => message.streaming);
  if (last) {
    finishAssistantDraft(last);
  }
}

function finishAssistantDraft(message) {
  message.streaming = false;
  message.reasoningStreaming = false;
  message.contentStreaming = false;
  if (!message.content && !message.reasoning) {
    messages.value = messages.value.filter((item) => item.id !== message.id);
  }
  triggerRef(messages);
}

function showError(message) {
  error.value = message;
  nextTick(() => stickToBottomIfNeeded(true));
}

async function appendStreamText(message, field, text) {
  const value = String(text || '');
  if (!value) {
    return;
  }

  let buffer = value;
  while (buffer && message.streaming) {
    const chunk = takeTypingChunk(buffer);
    buffer = buffer.slice(chunk.length);
    message[field] += chunk;
    triggerRef(messages);
    await nextTick();
    stickToBottomIfNeeded(false);
    await waitTypingCadence(chunk, buffer.length, value.length);
  }
}

function takeTypingChunk(text) {
  const segments = splitGraphemes(text);
  if (segments.length > streamFastChunkLength) {
    return segments.slice(0, 3).join('');
  }
  if (segments.length > streamMediumChunkLength) {
    return segments.slice(0, 2).join('');
  }
  return segments[0] || '';
}

function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    graphemeSegmenter ||= new Intl.Segmenter('zh', { granularity: 'grapheme' });
    return Array.from(graphemeSegmenter.segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

async function waitTypingCadence(chunk, remainingLength, originalLength) {
  let delay = 22;
  if (originalLength > streamFastChunkLength || remainingLength > streamFastChunkLength) {
    delay = 10;
  } else if (originalLength > streamMediumChunkLength || remainingLength > streamMediumChunkLength) {
    delay = 15;
  }

  if (/[\u3002\uff01\uff1f!?\uff1b;\uff1a:\uff0c,\u3001\u2026]$/.test(chunk.trim())) {
    delay += streamPunctuationPauseMs;
  }
  await waitMs(delay);
}

function waitMs(duration) {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function finalizeStreamedAssistant(message, serverMessage = {}) {
  const streamedContent = message.content;
  const streamedReasoning = message.reasoning;
  Object.assign(message, serverMessage, {
    content: streamedContent || serverMessage.content || '',
    reasoning: streamedReasoning || serverMessage.reasoning || '',
    streaming: false,
    reasoningStreaming: false,
    contentStreaming: false
  });
  triggerRef(messages);
}

function isReasoningTyping(message) {
  return message.role === 'assistant' && message.reasoningStreaming === true;
}

function isContentTyping(message) {
  return message.role === 'assistant' && message.contentStreaming === true;
}

function readLocalBoolean(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const value = window.localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }
  return value === 'true';
}

function writeLocalBoolean(key, value) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(key, String(Boolean(value)));
}

function toggleReasoning(messageId) {
  const next = new Set(expandedReasoning.value);
  if (next.has(messageId)) {
    next.delete(messageId);
  } else {
    next.add(messageId);
  }
  expandedReasoning.value = next;
}

function expandReasoning(messageId) {
  if (expandedReasoning.value.has(messageId)) {
    return;
  }
  const next = new Set(expandedReasoning.value);
  next.add(messageId);
  expandedReasoning.value = next;
}

function reasoningOpen(messageId) {
  return expandedReasoning.value.has(messageId);
}

function messagePlaceholder(message) {
  if (!message.streaming) {
    return '';
  }
  if (message.reasoning && !message.content) {
    return '正在思考，答案马上开始...';
  }
  return '正在生成...';
}

function activeCharacter() {
  return conversation.value?.character
    || characters.value.find((item) => item.id === conversation.value?.characterId)
    || null;
}

function messageAuthorName(message) {
  if (message.role === 'assistant') {
    return activeCharacter()?.name || 'AI';
  }
  if (message.role === 'user') {
    return props.user?.username || 'User';
  }
  return message.role || 'Message';
}

function messageAuthorInitial(message) {
  const name = messageAuthorName(message).trim();
  return [...name][0]?.toUpperCase() || '?';
}

function messageAvatarUrl(message) {
  if (message.role === 'assistant') {
    return activeCharacter()?.avatarUrl || '';
  }
  return '';
}

function openConversation(conversationId) {
  if (conversationId === props.route.params.id) {
    return;
  }
  emit('navigate', 'chat', { id: conversationId });
}

function toggleConversationSelection(conversationId) {
  const next = new Set(selectedConversationIds.value);
  if (next.has(conversationId)) {
    next.delete(conversationId);
  } else {
    next.add(conversationId);
  }
  selectedConversationIds.value = next;
}

function toggleAllVisibleConversations() {
  if (allVisibleConversationsSelected.value) {
    selectedConversationIds.value = new Set(
      [...selectedConversationIds.value].filter((id) => !visibleConversationIds.value.includes(id))
    );
    return;
  }
  selectedConversationIds.value = new Set([...selectedConversationIds.value, ...visibleConversationIds.value]);
}

async function deleteOneConversation(item) {
  if (conversationActionBusy.value || !item?.id) {
    return;
  }
  if (!window.confirm(`删除会话「${item.title}」？不会删除其他会话。`)) {
    return;
  }

  conversationActionBusy.value = true;
  try {
    await deleteConversation(item.id);
    removeDeletedConversations([item.id]);
    showActionNotice('会话已删除');
  } catch (err) {
    showError(err.message);
  } finally {
    conversationActionBusy.value = false;
  }
}

async function deleteSelectedConversations() {
  const ids = [...selectedConversationIds.value].filter((id) => visibleConversationIds.value.includes(id));
  if (!ids.length || conversationActionBusy.value) {
    return;
  }
  if (!window.confirm(`删除选中的 ${ids.length} 个会话？不会影响未选中的会话。`)) {
    return;
  }

  conversationActionBusy.value = true;
  try {
    const result = await deleteConversations(ids);
    removeDeletedConversations(result.deletedIds || ids);
    showActionNotice(`已删除 ${result.deletedIds?.length || ids.length} 个会话`);
  } catch (err) {
    showError(err.message);
  } finally {
    conversationActionBusy.value = false;
  }
}

function removeDeletedConversations(ids) {
  const deleted = new Set(ids);
  conversations.value = conversations.value.filter((item) => !deleted.has(item.id));
  selectedConversationIds.value = new Set([...selectedConversationIds.value].filter((id) => !deleted.has(id)));

  if (deleted.has(props.route.params.id)) {
    const nextConversation = conversations.value[0];
    if (nextConversation) {
      emit('navigate', 'chat', { id: nextConversation.id });
    } else {
      emit('navigate', 'home');
    }
  }
}

function pruneSelectedConversations() {
  const valid = new Set(conversations.value.map((item) => item.id));
  selectedConversationIds.value = new Set([...selectedConversationIds.value].filter((id) => valid.has(id)));
}

function canEditMessage(message) {
  return canPersistMessage(message) && !messageActionBusy.value;
}

function canDeleteMessage(message) {
  return canPersistMessage(message) && !messageActionBusy.value;
}

function canPersistMessage(message) {
  return Boolean(message?.id) && !message.streaming && !String(message.id).startsWith('local-');
}

async function beginEditMessage(message) {
  if (!canEditMessage(message)) {
    return;
  }
  await withMessageScrollAnchor(message.id, async () => {
    editingMessageId.value = message.id;
    editingMessageContent.value = message.content || '';
  });
  focusMessageEditor(message.id);
}

async function cancelEditMessage(message = null) {
  const messageId = message?.id || editingMessageId.value;
  await withMessageScrollAnchor(messageId, async () => {
    clearMessageEdit();
  });
}

function clearMessageEdit() {
  editingMessageId.value = '';
  editingMessageContent.value = '';
}

async function saveMessageEdit(message) {
  const content = editingMessageContent.value.trim();
  if (!content) {
    showActionNotice('消息内容不能为空');
    return;
  }
  if (!canEditMessage(message)) {
    return;
  }

  messageActionBusy.value = message.id;
  try {
    const updated = await updateMessage(props.route.params.id, message.id, { content });
    await withMessageScrollAnchor(message.id, async () => {
      Object.assign(message, updated);
      clearMessageEdit();
      triggerRef(messages);
    });
    showActionNotice('消息已更新');
    await loadSidebarData();
  } catch (err) {
    showError(err.message);
  } finally {
    messageActionBusy.value = '';
  }
}

async function removeMessage(message) {
  if (!canDeleteMessage(message)) {
    return;
  }
  if (!window.confirm('删除这条消息？不会删除前后关联的其他消息。')) {
    return;
  }

  messageActionBusy.value = message.id;
  try {
    const deletion = await deleteMessage(props.route.params.id, message.id);
    await withMessageScrollAnchor(message.id, async () => {
      messages.value = messages.value.filter((item) => item.id !== message.id);
      if (editingMessageId.value === message.id) {
        clearMessageEdit();
      }
    });
    showActionNotice(deletion?.deletedReasoning ? '消息和思考已删除' : '消息已删除');
    await loadSidebarData();
  } catch (err) {
    showError(err.message);
  } finally {
    messageActionBusy.value = '';
  }
}

async function copyMessage(message) {
  const text = messageTextForCopy(message);
  if (!text) {
    showActionNotice('没有可复制的内容');
    return;
  }

  try {
    await requestClipboardPermission();
    await writeClipboardText(text);
    showActionNotice('已复制到剪贴板');
  } catch (err) {
    showActionNotice(err.message || '复制失败，请检查浏览器权限');
  }
}

function messageTextForCopy(message) {
  return String(message?.content || message?.reasoning || '').trim();
}

async function requestClipboardPermission() {
  const permissions = window.navigator?.permissions;
  if (!permissions?.query) {
    return;
  }

  try {
    const status = await permissions.query({ name: 'clipboard-write' });
    if (status.state === 'denied') {
      throw new Error('剪贴板权限被拒绝');
    }
  } catch (err) {
    if (/denied|拒绝/.test(err.message || '')) {
      throw err;
    }
  }
}

async function writeClipboardText(text) {
  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('复制失败，请手动复制');
  }
}

async function withMessageScrollAnchor(messageId, callback) {
  const anchor = captureMessageScrollAnchor(messageId);
  const result = await callback();
  await nextTick();
  await waitForFrame();
  restoreMessageScrollAnchor(anchor);
  return result;
}

function captureMessageScrollAnchor(messageId) {
  const scroller = messageScroller.value;
  if (!scroller) {
    return null;
  }

  const element = findMessageElement(messageId);
  return {
    messageId,
    top: element ? element.getBoundingClientRect().top : null,
    scrollTop: scroller.scrollTop
  };
}

function restoreMessageScrollAnchor(anchor) {
  const scroller = messageScroller.value;
  if (!scroller || !anchor) {
    return;
  }

  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const element = findMessageElement(anchor.messageId);
  if (element && anchor.top !== null) {
    const delta = element.getBoundingClientRect().top - anchor.top;
    scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, scroller.scrollTop + delta));
  } else {
    scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, anchor.scrollTop));
  }
  updateScrollState();
  scheduleSaveMessageScrollPosition();
}

function findMessageElement(messageId) {
  if (!messageId || !messageScroller.value) {
    return null;
  }
  return [...messageScroller.value.querySelectorAll('.deep-message')]
    .find((element) => element.dataset.messageId === String(messageId)) || null;
}

async function waitForFrame() {
  if (typeof window === 'undefined') {
    return;
  }
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function focusMessageEditor(messageId) {
  requestAnimationFrame(() => {
    const textarea = findMessageElement(messageId)?.querySelector('.message-edit-box textarea');
    textarea?.focus?.({ preventScroll: true });
  });
}

function showActionNotice(message) {
  actionNotice.value = message;
  if (actionNoticeTimer) {
    window.clearTimeout(actionNoticeTimer);
  }
  actionNoticeTimer = window.setTimeout(() => {
    actionNotice.value = '';
  }, 1800);
}

function toggleUseStream() {
  useStream.value = !useStream.value;
}

function toggleThinking() {
  if (!canToggleThinking.value) {
    return;
  }
  thinkingEnabled.value = !thinkingEnabled.value;
}

function resizeComposerTextarea() {
  const el = composerTextarea.value;
  if (!el) {
    return;
  }
  const maxHeight = 180;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function handleViewportResize() {
  resizeComposerTextarea();
}

function formatConversationUsage(item) {
  const usage = item.usage || {};
  return `总 token ${formatTokens(usage.totalTokens)} · 总费用 ${formatCost(usage)}`;
}

function formatTokens(value) {
  const number = Number(value || 0);
  return number.toLocaleString('zh-CN');
}

function formatCost(usage) {
  const cost = Number(usage.totalCostCny);
  if (!Number.isFinite(cost)) {
    return '未计价';
  }

  const digits = cost > 0 && cost < 0.01 ? 6 : 4;
  return `¥${cost.toFixed(digits)}`;
}

function handleMessageScroll() {
  updateScrollState();
  scheduleSaveMessageScrollPosition();
}

function handleWheelScrollIntent(event) {
  if (event.deltaY < -1) {
    pauseAutoScrollForUser();
  }
}

function handleTouchStart(event) {
  const touch = event.touches?.[0];
  touchStartY = touch?.clientY || 0;
  lastTouchY = touchStartY;
}

function handleTouchMove(event) {
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  const currentY = touch.clientY;
  const moved = Math.abs(currentY - lastTouchY) > 4 || Math.abs(currentY - touchStartY) > 10;
  if (moved) {
    pauseAutoScrollForUser();
  }
  lastTouchY = currentY;
}

function pauseAutoScrollForUser() {
  lastManualScrollIntentAt = Date.now();
  userPausedAutoScroll = true;
  isScrollPinned.value = false;
  updateScrollState();
}

function hasRecentManualScrollIntent() {
  return Date.now() - lastManualScrollIntentAt < manualScrollIntentCooldownMs;
}

function updateScrollState() {
  const el = messageScroller.value;
  if (!el) {
    return;
  }
  distanceToBottom.value = getDistanceToBottom(el);
  if (distanceToBottom.value <= 2 && !hasRecentManualScrollIntent()) {
    userPausedAutoScroll = false;
  }
  if (userPausedAutoScroll) {
    isScrollPinned.value = false;
  } else if (distanceToBottom.value <= scrollStickThreshold) {
    isScrollPinned.value = true;
  } else if (distanceToBottom.value > scrollStickThreshold) {
    isScrollPinned.value = false;
  }
}

function getDistanceToBottom(el) {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function stickToBottomIfNeeded(smooth = false) {
  if (hasRecentManualScrollIntent()) {
    updateScrollState();
    scheduleSaveMessageScrollPosition();
    return;
  }
  updateScrollState();
  if (userPausedAutoScroll || !isScrollPinned.value) {
    scheduleSaveMessageScrollPosition();
    return;
  }
  scrollToBottom(smooth, true);
}

function scrollToBottom(smooth = true, keepPinned = true) {
  if (keepPinned) {
    lastManualScrollIntentAt = 0;
    userPausedAutoScroll = false;
    isScrollPinned.value = true;
  }
  requestAnimationFrame(() => {
    const el = messageScroller.value;
    if (!el) {
      return;
    }
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    if (!smooth) {
      updateScrollState();
    } else if (typeof window !== 'undefined') {
      window.setTimeout(() => updateScrollState(), 360);
    }
    scheduleSaveMessageScrollPosition();
  });
}

function restoreMessageScrollPosition() {
  requestAnimationFrame(() => {
    const el = messageScroller.value;
    if (!el) {
      return;
    }

    const saved = readScrollSnapshot();
    if (!saved) {
      scrollToBottom(false, true);
      return;
    }

    if (saved.pinned) {
      scrollToBottom(false, true);
      return;
    }

    el.scrollTop = Math.min(saved.top || 0, Math.max(0, el.scrollHeight - el.clientHeight));
    updateScrollState();
    scheduleSaveMessageScrollPosition();
  });
}

function readScrollSnapshot() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return JSON.parse(window.localStorage.getItem(scrollStorageKey()) || 'null');
  } catch {
    return null;
  }
}

function scheduleSaveMessageScrollPosition() {
  if (typeof window === 'undefined') {
    return;
  }
  if (scrollSaveTimer) {
    window.clearTimeout(scrollSaveTimer);
  }
  scrollSaveTimer = window.setTimeout(() => {
    saveMessageScrollPosition();
  }, 120);
}

function saveMessageScrollPosition() {
  if (typeof window === 'undefined') {
    return;
  }
  const el = messageScroller.value;
  if (!el) {
    return;
  }
  const snapshot = {
    top: Math.round(el.scrollTop),
    pinned: !userPausedAutoScroll && getDistanceToBottom(el) <= scrollStickThreshold,
    savedAt: Date.now()
  };
  window.localStorage.setItem(scrollStorageKey(), JSON.stringify(snapshot));
}

function scrollStorageKey() {
  return `flai-chat-scroll:${props.route.params.id || 'active'}`;
}
</script>

<template>
  <section class="deep-chat-shell" :class="{ 'sidebar-collapsed': !sidebarOpen }">
    <aside class="deep-sidebar" :class="{ collapsed: !sidebarOpen }" aria-label="对话历史">
      <div class="deep-sidebar-top">
        <button class="deep-brand" type="button" @click="emit('navigate', 'home')">
          <span class="deep-logo">F</span>
          <strong>FLAI Tavern</strong>
        </button>
        <button class="deep-icon-button" type="button" title="收起侧边栏" @click="sidebarOpen = !sidebarOpen">
          <PanelLeftClose v-if="sidebarOpen" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
      </div>

      <button class="new-chat-button" type="button" @click="startNewConversation">
        <MessageSquarePlus :size="18" />
        <span>开启新对话</span>
      </button>

      <label class="history-search">
        <Search :size="17" />
        <input v-model.trim="historySearch" placeholder="搜索当前角色的对话" />
      </label>

      <div v-if="filteredConversations.length" class="history-tools">
        <button class="history-tool-button" type="button" @click="toggleAllVisibleConversations">
          <CheckSquare :size="15" />
          <span>{{ allVisibleConversationsSelected ? '取消' : '全选' }}</span>
        </button>
        <button
          class="history-tool-button danger"
          type="button"
          :disabled="!selectedConversationCount || conversationActionBusy"
          @click="deleteSelectedConversations"
        >
          <Trash2 :size="15" />
          <span>批删</span>
          <small v-if="selectedConversationCount">{{ selectedConversationCount }}</small>
        </button>
      </div>

      <div class="history-list">
        <p class="history-group">{{ conversation?.character?.name || '当前角色' }}</p>
        <div
          v-for="item in filteredConversations"
          :key="item.id"
          class="history-row"
          :class="{ active: item.id === route.params.id }"
        >
          <label class="history-check" title="选择会话" @click.stop>
            <input
              type="checkbox"
              :checked="selectedConversationIds.has(item.id)"
              @change="toggleConversationSelection(item.id)"
            />
            <span aria-hidden="true"></span>
          </label>
          <button class="history-item" type="button" @click="openConversation(item.id)">
            <strong>{{ item.title }}</strong>
            <span>{{ item.character?.name || 'AI' }}</span>
            <small class="history-usage" :title="formatConversationUsage(item)">
              {{ formatConversationUsage(item) }}
            </small>
          </button>
          <button
            class="history-delete-button"
            type="button"
            title="删除会话"
            :disabled="conversationActionBusy"
            @click.stop="deleteOneConversation(item)"
          >
            <Trash2 :size="15" />
          </button>
        </div>
        <p v-if="!filteredConversations.length" class="history-empty">暂无会话</p>
      </div>

      <div class="sidebar-footer">
        <button class="sidebar-user" type="button" @click="emit('navigate', 'settings')">
          <UserRound :size="18" />
          <span>{{ user?.username || '用户' }}</span>
        </button>
        <button class="deep-icon-button" type="button" title="返回首页" @click="emit('navigate', 'home')">
          <Home :size="18" />
        </button>
        <button class="deep-icon-button" type="button" title="设置" @click="emit('navigate', 'settings')">
          <Settings :size="18" />
        </button>
      </div>
    </aside>

    <section class="deep-chat-main">
      <header class="deep-chat-header">
        <button class="deep-icon-button mobile-menu" type="button" title="打开侧边栏" @click="sidebarOpen = true">
          <Menu :size="19" />
        </button>
        <div>
          <h1>{{ conversation?.title || '角色对话' }}</h1>
          <p>
            <Zap :size="14" />
            <span>{{ currentProviderLabel }} · {{ currentModelLabel }}</span>
          </p>
        </div>
        <button class="deep-icon-button" type="button" title="返回首页" @click="emit('navigate', 'home')">
          <Home :size="18" />
        </button>
      </header>

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
        <article
          v-for="message in messages"
          :key="message.id"
          class="deep-message"
          :class="message.role"
          :data-message-id="message.id"
        >
          <div v-if="message.role === 'assistant'" class="deep-message-author" aria-hidden="true">
            <span class="deep-message-avatar">
              <img v-if="messageAvatarUrl(message)" :src="messageAvatarUrl(message)" alt="" />
              <span v-else>{{ messageAuthorInitial(message) }}</span>
            </span>
            <small>{{ messageAuthorName(message) }}</small>
          </div>
          <div class="deep-message-content">
            <div class="deep-message-name">{{ messageAuthorName(message) }}</div>
            <div v-if="message.role === 'assistant' && message.reasoning" class="reasoning-block">
              <button class="reasoning-toggle" type="button" @click="toggleReasoning(message.id)">
                <Brain :size="16" />
                <span>{{ isReasoningTyping(message) ? '正在思考' : '已思考' }}</span>
                <small v-if="message.reasoning.length">约 {{ message.reasoning.length }} 字</small>
                <ChevronDown v-if="reasoningOpen(message.id)" :size="16" />
                <ChevronRight v-else :size="16" />
              </button>
              <div
                v-if="reasoningOpen(message.id)"
                class="reasoning-body"
                :class="{ 'is-typing': isReasoningTyping(message) }"
              >
                <MarkdownContent class="typing-text" :text="message.reasoning" />
              </div>
            </div>

            <div
              class="deep-bubble"
              :class="{
                'is-typing': isContentTyping(message),
                'is-waiting': isContentTyping(message) && !message.content,
                'is-editing': editingMessageId === message.id
              }"
            >
              <div v-if="editingMessageId === message.id" class="message-edit-box">
                <textarea
                  v-model="editingMessageContent"
                  rows="4"
                  @keydown.esc.prevent="cancelEditMessage(message)"
                />
                <div class="message-edit-actions">
                  <button type="button" class="message-action-button primary" @click="saveMessageEdit(message)">
                    <Check :size="15" />
                    <span>保存</span>
                  </button>
                  <button type="button" class="message-action-button" @click="cancelEditMessage(message)">
                    <X :size="15" />
                    <span>取消</span>
                  </button>
                </div>
              </div>
              <MarkdownContent v-else class="typing-text" :text="message.content || messagePlaceholder(message)" />
            </div>
            <div class="message-actions" :class="message.role">
              <button
                type="button"
                class="message-action-button"
                title="复制消息"
                @click="copyMessage(message)"
              >
                <Copy :size="14" />
                <span>复制</span>
              </button>
              <button
                type="button"
                class="message-action-button"
                title="编辑消息"
                :disabled="!canEditMessage(message)"
                @click="beginEditMessage(message)"
              >
                <Pencil :size="14" />
                <span>编辑</span>
              </button>
              <button
                type="button"
                class="message-action-button danger"
                title="删除消息"
                :disabled="!canDeleteMessage(message)"
                @click="removeMessage(message)"
              >
                <Trash2 :size="14" />
                <span>删除</span>
              </button>
            </div>
          </div>
          <div v-if="message.role === 'user'" class="deep-message-author user" aria-hidden="true">
            <span class="deep-message-avatar">
              <img v-if="messageAvatarUrl(message)" :src="messageAvatarUrl(message)" alt="" />
              <span v-else>{{ messageAuthorInitial(message) }}</span>
            </span>
            <small>{{ messageAuthorName(message) }}</small>
          </div>
        </article>
        <p v-if="actionNotice" class="chat-action-toast" role="status">{{ actionNotice }}</p>
        <div v-if="error" class="deep-error" role="status">
          <span>{{ error }}</span>
          <button v-if="needsProviderFix" type="button" @click="emit('navigate', 'settings')">
            去设置
          </button>
        </div>
      </div>

      <footer class="deep-composer-wrap">
        <button
          v-if="showScrollBottomButton"
          class="scroll-bottom-button"
          type="button"
          title="滚动到底部"
          @click="scrollToBottom()"
        >
          <ChevronDown :size="18" />
        </button>
        <form class="deep-composer" @submit.prevent="submit">
          <textarea
            ref="composerTextarea"
            v-model="input"
            placeholder="给 AI 发送消息"
            rows="2"
            @input="resizeComposerTextarea"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="composer-actions">
            <button
              class="mode-pill"
              :class="{ active: useStream }"
              type="button"
              :aria-pressed="String(useStream)"
              @click="toggleUseStream"
            >
              <Sparkles :size="16" />
              <span>流式输出</span>
            </button>
            <button
              class="mode-pill"
              :class="{ active: canToggleThinking && thinkingEnabled }"
              type="button"
              :aria-pressed="String(canToggleThinking && thinkingEnabled)"
              :disabled="!canToggleThinking"
              title="DeepSeek thinking.enabled / thinking.disabled"
              @click="toggleThinking"
            >
              <Brain :size="16" />
              <span>{{ thinkingEnabled ? '深度思考' : '普通回复' }}</span>
            </button>
            <span v-if="usage" class="token-chip">tokens {{ usage.total_tokens || usage.totalTokens || '-' }}</span>
            <button v-if="sending" class="round-send stop" type="button" title="停止生成" @click="stop">
              <Square :size="18" />
            </button>
            <button v-else class="round-send" type="submit" title="发送" :disabled="!canSend">
              <Send :size="19" />
            </button>
          </div>
        </form>
      </footer>
    </section>
  </section>
</template>
