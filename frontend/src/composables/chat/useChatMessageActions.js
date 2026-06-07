import { nextTick, reactive, ref, triggerRef } from 'vue';
import { deleteMessage, updateMessage, fetchMessageSwipes, createMessageSwipe, branchConversation, fetchConversationBranches } from '../../api.js';

export function useChatMessageActions({
  messages,
  messageScroller,
  route,
  user,
  activeCharacter,
  loadSidebarData,
  showActionNotice,
  showError
}) {
  const expandedReasoning = ref(new Set());
  const editingMessageId = ref('');
  const editingMessageContent = ref('');
  const messageActionBusy = ref('');
  let disposed = false;
  let messageActionToken = 0;
  let focusEditorRafId = null;

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

  function isReasoningTyping(message) {
    return message.role === 'assistant' && message.reasoningStreaming === true;
  }

  function isContentTyping(message) {
    return message.role === 'assistant' && message.contentStreaming === true;
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

  function messageAuthorName(message) {
    if (message.role === 'assistant') {
      return activeCharacter()?.name || 'AI';
    }
    if (message.role === 'user') {
      return user.value?.displayName || user.value?.accountName || user.value?.username || 'User';
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
    return user.value?.avatarUrl || '';
  }

  function canEditMessage(message) {
    return canPersistMessage(message) && !messageActionBusy.value;
  }

  function canDeleteMessage(message) {
    return canPersistMessage(message) && !messageActionBusy.value;
  }

  function canPersistMessage(message) {
    return !disposed && Boolean(message?.id) && !message.streaming && !String(message.id).startsWith('local-');
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
    if (messageActionBusy.value) {
      return;
    }
    const messageId = message?.id || editingMessageId.value;
    await withMessageScrollAnchor(messageId, async () => {
      clearMessageEdit();
    });
  }

  function setEditingMessageContent(value) {
    if (messageActionBusy.value) {
      return;
    }
    editingMessageContent.value = value;
  }

  function clearMessageEdit() {
    editingMessageId.value = '';
    editingMessageContent.value = '';
  }

  async function saveMessageEdit(message) {
    const content = editingMessageContent.value.trim();
    if (!content) {
      showActionNotice('消息内容不能为空', 'warning');
      return;
    }
    if (!canEditMessage(message)) {
      return;
    }

    const conversationId = route.params.id;
    const actionToken = ++messageActionToken;
    messageActionBusy.value = message.id;
    try {
      const updated = await updateMessage(conversationId, message.id, { content });
      if (!isCurrentMessageAction(actionToken, conversationId)) {
        return;
      }
      await withMessageScrollAnchor(message.id, async () => {
        Object.assign(message, updated);
        clearMessageEdit();
        triggerRef(messages);
      });
      if (!isCurrentMessageAction(actionToken, conversationId)) {
        return;
      }
      showActionNotice('消息已更新');
      if (isCurrentMessageAction(actionToken, conversationId)) {
        await loadSidebarData();
      }
    } catch (err) {
      if (isCurrentMessageAction(actionToken, conversationId)) {
        showError(err.message);
      }
    } finally {
      if (isLatestMessageAction(actionToken)) {
        messageActionBusy.value = '';
      }
    }
  }

  async function removeMessage(message) {
    if (!canDeleteMessage(message)) {
      return;
    }
    if (!window.confirm('删除这条消息？不会删除前后关联的其他消息。')) {
      return;
    }

    const conversationId = route.params.id;
    const actionToken = ++messageActionToken;
    messageActionBusy.value = message.id;
    try {
      const deletion = await deleteMessage(conversationId, message.id);
      if (!isCurrentMessageAction(actionToken, conversationId)) {
        return;
      }
      await withMessageScrollAnchor(message.id, async () => {
        messages.value = messages.value.filter((item) => item.id !== message.id);
        if (editingMessageId.value === message.id) {
          clearMessageEdit();
        }
      });
      if (!isCurrentMessageAction(actionToken, conversationId)) {
        return;
      }
      showActionNotice(deletion?.deletedReasoning ? '消息和思考已删除' : '消息已删除');
      if (isCurrentMessageAction(actionToken, conversationId)) {
        await loadSidebarData();
      }
    } catch (err) {
      if (isCurrentMessageAction(actionToken, conversationId)) {
        showError(err.message);
      }
    } finally {
      if (isLatestMessageAction(actionToken)) {
        messageActionBusy.value = '';
      }
    }
  }

  async function copyMessage(message) {
    const text = messageTextForCopy(message);
    if (!text) {
      showActionNotice('没有可复制的内容', 'warning');
      return;
    }

    try {
      await requestClipboardPermission();
      await writeClipboardText(text);
      if (disposed) {
        return;
      }
      showActionNotice('已复制到剪贴板');
    } catch (err) {
      if (!disposed) {
        showActionNotice(err.message || '复制失败，请检查浏览器权限', 'warning');
      }
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
    if (disposed) {
      return undefined;
    }
    const anchor = captureMessageScrollAnchor(messageId);
    const result = await callback();
    if (disposed) {
      return result;
    }
    await nextTick();
    if (disposed) {
      return result;
    }
    await waitForFrame();
    if (disposed) {
      return result;
    }
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
    if (disposed || !scroller || !anchor) {
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
  }

  function findMessageElement(messageId) {
    if (disposed || !messageId || !messageScroller.value) {
      return null;
    }
    return [...messageScroller.value.querySelectorAll('.deep-message')]
      .find((element) => element.dataset.messageId === String(messageId)) || null;
  }

  async function waitForFrame() {
    if (disposed || typeof window === 'undefined') {
      return;
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  function focusMessageEditor(messageId) {
    if (disposed || typeof window === 'undefined') {
      return;
    }
    if (focusEditorRafId) {
      window.cancelAnimationFrame(focusEditorRafId);
    }
    focusEditorRafId = window.requestAnimationFrame(() => {
      focusEditorRafId = null;
      if (disposed) {
        return;
      }
      const textarea = findMessageElement(messageId)?.querySelector('.message-edit-box textarea');
      textarea?.focus?.({ preventScroll: true });
    });
  }

  function isCurrentMessageAction(actionToken, conversationId) {
    return !disposed && actionToken === messageActionToken && route.params.id === conversationId;
  }

  function isLatestMessageAction(actionToken) {
    return !disposed && actionToken === messageActionToken;
  }

  // ── Swipe ──
  const messageSwipeState = reactive({});
  const swipeLoading = ref(new Set());
  let swipeInitToken = 0;

  function resetMessageSwipeState({ invalidate = true } = {}) {
    if (invalidate) {
      swipeInitToken += 1;
    }
    for (const key of Object.keys(messageSwipeState)) {
      delete messageSwipeState[key];
    }
    swipeLoading.value = new Set();
  }

  async function initMessageSwipes(conversationId) {
    if (disposed) return;
    const requestToken = ++swipeInitToken;
    resetMessageSwipeState({ invalidate: false });
    for (const msg of messages.value) {
      if (msg.role === 'assistant') {
        try {
          const swipes = await fetchMessageSwipes(conversationId, msg.id);
          if (!isCurrentSwipeInit(requestToken, conversationId, msg.id)) {
            return;
          }
          messageSwipeState[msg.id] = {
            swipes: swipes || [],
            activeIndex: 0,
            swipeCount: (swipes?.length || 0) + 1
          };
        } catch {
          if (!isCurrentSwipeInit(requestToken, conversationId, msg.id)) {
            return;
          }
          messageSwipeState[msg.id] = { swipes: [], activeIndex: 0, swipeCount: 1 };
        }
      }
    }
  }

  async function swipeMessagePrev(message) {
    if (disposed) return;
    if (swipeLoading.value.has(message.id)) return;
    const state = messageSwipeState[message.id];
    if (!state || state.activeIndex <= 0) return;
    state.activeIndex--;
    if (state.activeIndex > 0) {
      const swipe = state.swipes[state.activeIndex - 1];
      message.content = swipe.content;
      message.reasoning = swipe.reasoning || '';
    }
  }

  async function swipeMessageNext(message, conversationId) {
    if (disposed) return;
    const state = messageSwipeState[message.id];
    if (!state) return;
    if (swipeLoading.value.has(message.id)) return;
    if (state.activeIndex < state.swipeCount - 1) {
      state.activeIndex++;
      const swipe = state.swipes[state.activeIndex - 1];
      message.content = swipe.content;
      message.reasoning = swipe.reasoning || '';
    } else {
      swipeLoading.value.add(message.id);
      try {
        const result = await createMessageSwipe(conversationId, message.id, {
          content: message.content || '',
          reasoning: message.reasoning || '',
          usage: message.usage || null
        });
        if (!isCurrentConversationMessage(conversationId, message.id)) {
          return;
        }
        if (result) {
          state.swipes.push(result);
          state.swipeCount = state.swipes.length + 1;
          state.activeIndex = state.swipeCount - 1;
          message.content = result.content;
          message.reasoning = result.reasoning || '';
        }
      } finally {
        if (!disposed && route.params.id === conversationId) {
          swipeLoading.value.delete(message.id);
        }
      }
    }
  }

  function isCurrentSwipeInit(requestToken, conversationId, messageId) {
    return requestToken === swipeInitToken && isCurrentConversationMessage(conversationId, messageId);
  }

  function isCurrentConversationMessage(conversationId, messageId) {
    return !disposed && route.params.id === conversationId && messages.value.some((item) => item.id === messageId);
  }

  function getSwipeDisplay(message) {
    const state = messageSwipeState[message.id];
    if (!state || state.swipeCount <= 1) return '';
    return `${state.activeIndex + 1}/${state.swipeCount}`;
  }

  // ── Branch ──
  const conversationBranches = ref([]);
  const branchBusy = ref(false);
  let branchLoadToken = 0;
  let branchActionToken = 0;

  async function loadConversationBranches(conversationId) {
    if (disposed || !conversationId) return;
    const requestToken = ++branchLoadToken;
    try {
      const branches = await fetchConversationBranches(conversationId);
      if (!isCurrentBranchLoad(requestToken, conversationId)) {
        return;
      }
      conversationBranches.value = branches;
    } catch {
      if (!isCurrentBranchLoad(requestToken, conversationId)) {
        return;
      }
      conversationBranches.value = [];
    }
  }

  async function handleBranchMessage(message, conversationId, onBranched) {
    if (disposed || branchBusy.value) {
      return;
    }
    const requestToken = ++branchActionToken;
    branchBusy.value = true;
    try {
      const result = await branchConversation(conversationId, message.id);
      if (disposed || route.params.id !== conversationId) {
        return;
      }
      if (result?.id && onBranched) {
        await onBranched(result.id);
      }
    } finally {
      if (!disposed && requestToken === branchActionToken) {
        branchBusy.value = false;
      }
    }
  }

  function isCurrentBranchLoad(requestToken, conversationId) {
    return !disposed && requestToken === branchLoadToken && route.params.id === conversationId;
  }

  function resetMessageUiState() {
    messageActionToken += 1;
    branchLoadToken += 1;
    branchActionToken += 1;
    clearMessageEdit();
    expandedReasoning.value = new Set();
    messageActionBusy.value = '';
    branchBusy.value = false;
    conversationBranches.value = [];
    resetMessageSwipeState();
    if (focusEditorRafId) {
      window.cancelAnimationFrame(focusEditorRafId);
      focusEditorRafId = null;
    }
  }

  function cleanup() {
    disposed = true;
    messageActionToken += 1;
    swipeInitToken += 1;
    branchLoadToken += 1;
    branchActionToken += 1;
    if (focusEditorRafId) {
      window.cancelAnimationFrame(focusEditorRafId);
      focusEditorRafId = null;
    }
    messageActionBusy.value = '';
    branchBusy.value = false;
    swipeLoading.value = new Set();
  }

  return {
    expandedReasoning,
    editingMessageId,
    editingMessageContent,
    messageActionBusy,
    toggleReasoning,
    expandReasoning,
    reasoningOpen,
    isReasoningTyping,
    isContentTyping,
    messagePlaceholder,
    messageAuthorName,
    messageAuthorInitial,
    messageAvatarUrl,
    canEditMessage,
    canDeleteMessage,
    beginEditMessage,
    cancelEditMessage,
    setEditingMessageContent,
    clearMessageEdit,
    saveMessageEdit,
    removeMessage,
    copyMessage,
    messageSwipeState,
    swipeLoading,
    initMessageSwipes,
    swipeMessagePrev,
    swipeMessageNext,
    getSwipeDisplay,
    conversationBranches,
    branchBusy,
    loadConversationBranches,
    handleBranchMessage,
    resetMessageUiState,
    cleanup
  };
}
