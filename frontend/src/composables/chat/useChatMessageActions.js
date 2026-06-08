import { computed, nextTick, reactive, ref, triggerRef } from 'vue';
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
  const copyBusy = ref(false);
  const assistantMessageIdentity = computed(() => {
    const character = typeof activeCharacter === 'function' ? activeCharacter() : null;
    return buildMessageIdentity(character?.name || 'AI', character?.avatarUrl || '');
  });
  const userMessageIdentity = computed(() => {
    const currentUser = user.value || {};
    return buildMessageIdentity(
      currentUser.displayName || currentUser.accountName || currentUser.username || 'User',
      currentUser.avatarUrl || ''
    );
  });
  const messageListIndex = computed(() => {
    const index = new Map();
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    for (const item of messageList) {
      const itemId = normalizeMessageUiId(item?.id);
      if (itemId && !index.has(itemId)) {
        index.set(itemId, item);
      }
    }
    return index;
  });
  let disposed = false;
  let messageActionToken = 0;
  let copyActionToken = 0;
  let focusEditorRafId = null;

  function toggleReasoning(messageId) {
    const stateId = normalizeMessageUiId(messageId);
    if (!stateId) {
      return;
    }
    const next = new Set(expandedReasoning.value);
    if (next.has(stateId)) {
      next.delete(stateId);
    } else {
      next.add(stateId);
    }
    expandedReasoning.value = next;
  }

  function expandReasoning(messageId) {
    const stateId = normalizeMessageUiId(messageId);
    if (!stateId || expandedReasoning.value.has(stateId)) {
      return;
    }
    const next = new Set(expandedReasoning.value);
    next.add(stateId);
    expandedReasoning.value = next;
  }

  function reasoningOpen(messageId) {
    const stateId = normalizeMessageUiId(messageId);
    return Boolean(stateId && expandedReasoning.value.has(stateId));
  }

  function normalizeMessageUiId(messageId) {
    return String(messageId ?? '').trim();
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

  function buildMessageIdentity(name, avatarUrl = '') {
    const normalizedName = String(name || '').trim() || 'Message';
    return {
      name: normalizedName,
      initial: [...normalizedName][0]?.toUpperCase() || '?',
      avatarUrl: String(avatarUrl || '')
    };
  }

  function getMessageIdentity(message) {
    if (message.role === 'assistant') {
      return assistantMessageIdentity.value;
    }
    if (message.role === 'user') {
      return userMessageIdentity.value;
    }
    return buildMessageIdentity(message.role || 'Message');
  }

  function messageAuthorName(message) {
    return getMessageIdentity(message).name;
  }

  function messageAuthorInitial(message) {
    return getMessageIdentity(message).initial;
  }

  function messageAvatarUrl(message) {
    return getMessageIdentity(message).avatarUrl;
  }

  function canEditMessage(message) {
    return canPersistMessage(message) && !isMessageMutationLocked();
  }

  function canDeleteMessage(message) {
    return canPersistMessage(message) && !isMessageMutationLocked();
  }

  function canBranchMessage(message) {
    return canPersistMessage(message) && !isMessageMutationLocked();
  }

  function canPersistMessage(message) {
    return Boolean(getPersistedMessageActionId(message));
  }

  function isMessageMutationLocked() {
    return Boolean(messageActionBusy.value || branchBusy.value);
  }

  function getPersistedMessageActionId(message) {
    const messageId = normalizeMessageUiId(message?.id);
    if (disposed || !messageId || messageId.startsWith('local-')) {
      return '';
    }
    const currentMessage = findMessageListItem(messageId);
    if (!currentMessage || currentMessage.streaming) {
      return '';
    }
    return messageId;
  }

  function getPersistedMessageListItemId(message) {
    const messageId = normalizeMessageUiId(message?.id);
    if (disposed || !messageId || messageId.startsWith('local-') || message?.streaming) {
      return '';
    }
    return messageId;
  }

  function findMessageListItem(messageId) {
    const targetId = normalizeMessageUiId(messageId);
    if (!targetId) {
      return null;
    }
    return messageListIndex.value.get(targetId) || null;
  }

  async function beginEditMessage(message) {
    if (!canEditMessage(message)) {
      return;
    }
    const messageId = getPersistedMessageActionId(message);
    const currentMessage = findMessageListItem(messageId);
    if (!messageId || !currentMessage) {
      return;
    }
    await withMessageScrollAnchor(messageId, async () => {
      editingMessageId.value = messageId;
      editingMessageContent.value = currentMessage?.content || '';
    });
    focusMessageEditor(messageId);
  }

  async function cancelEditMessage(message = null) {
    if (isMessageMutationLocked()) {
      return;
    }
    const messageId = message?.id || editingMessageId.value;
    await withMessageScrollAnchor(messageId, async () => {
      clearMessageEdit();
    });
  }

  function setEditingMessageContent(value) {
    if (isMessageMutationLocked()) {
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
    const messageId = getPersistedMessageActionId(message);
    const currentMessage = findMessageListItem(messageId);
    if (!messageId || !currentMessage) {
      return;
    }
    if (content === String(currentMessage.content || '').trim()) {
      await withMessageScrollAnchor(messageId, async () => {
        clearMessageEdit();
      });
      return;
    }

    const conversationId = route.params.id;
    const actionToken = ++messageActionToken;
    messageActionBusy.value = messageId;
    try {
      const updated = await updateMessage(conversationId, messageId, { content });
      if (!isCurrentMessageActionTarget(actionToken, conversationId, messageId, currentMessage)) {
        return;
      }
      await withMessageScrollAnchor(messageId, async () => {
        Object.assign(currentMessage, updated);
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
    const messageId = getPersistedMessageActionId(message);
    if (!messageId) {
      return;
    }
    const currentMessage = findMessageListItem(messageId);
    if (!currentMessage) {
      return;
    }
    if (!window.confirm('删除这条消息？不会删除前后关联的其他消息。')) {
      return;
    }

    const conversationId = route.params.id;
    const actionToken = ++messageActionToken;
    messageActionBusy.value = messageId;
    try {
      const deletion = await deleteMessage(conversationId, messageId);
      if (!isCurrentMessageActionTarget(actionToken, conversationId, messageId, currentMessage)) {
        return;
      }
      await withMessageScrollAnchor(messageId, async () => {
        removeMessageFromListIfPresent(messageId);
        if (editingMessageId.value === messageId) {
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

  function removeMessageFromListIfPresent(messageId) {
    const targetId = normalizeMessageUiId(messageId);
    if (!targetId) {
      return false;
    }
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    const nextMessages = [];
    let removed = false;
    for (const item of messageList) {
      if (normalizeMessageUiId(item?.id) === targetId) {
        removed = true;
      } else {
        nextMessages.push(item);
      }
    }
    if (!removed) {
      return false;
    }
    messages.value = nextMessages;
    return true;
  }

  async function copyMessage(message) {
    if (copyBusy.value) {
      return;
    }
    const text = messageTextForCopy(message);
    if (!text) {
      showActionNotice('没有可复制的内容', 'warning');
      return;
    }

    const actionToken = ++copyActionToken;
    copyBusy.value = true;
    try {
      await requestClipboardPermission();
      await writeClipboardText(text);
      if (!isCurrentCopyAction(actionToken)) {
        return;
      }
      showActionNotice('已复制到剪贴板');
    } catch (err) {
      if (isCurrentCopyAction(actionToken)) {
        showActionNotice(err.message || '复制失败，请检查浏览器权限', 'warning');
      }
    } finally {
      if (isLatestCopyAction(actionToken)) {
        copyBusy.value = false;
      }
    }
  }

  function messageTextForCopy(message) {
    return String(message?.content || message?.reasoning || '').trim();
  }

  function isCurrentCopyAction(actionToken) {
    return !disposed && actionToken === copyActionToken;
  }

  function isLatestCopyAction(actionToken) {
    return actionToken === copyActionToken;
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
    const targetId = String(messageId);
    const elements = messageScroller.value.querySelectorAll('.deep-message');
    for (const element of elements) {
      if (element.dataset.messageId === targetId) {
        return element;
      }
    }
    return null;
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

  function isCurrentMessageActionTarget(actionToken, conversationId, messageId, currentMessage) {
    return isCurrentMessageAction(actionToken, conversationId)
      && findMessageListItem(messageId) === currentMessage;
  }

  function isLatestMessageAction(actionToken) {
    return !disposed && actionToken === messageActionToken;
  }

  // ── Swipe ──
  const messageSwipeState = reactive({});
  const swipeLoading = ref(new Set());
  let swipeInitToken = 0;

  function clearSetRef(setRef) {
    if (!setRef.value.size) {
      return;
    }
    setRef.value = new Set();
  }

  function addSetRefItem(setRef, item) {
    if (setRef.value.has(item)) {
      return false;
    }
    const next = new Set(setRef.value);
    next.add(item);
    setRef.value = next;
    return true;
  }

  function deleteSetRefItem(setRef, item) {
    if (!setRef.value.has(item)) {
      return false;
    }
    const next = new Set(setRef.value);
    next.delete(item);
    setRef.value = next;
    return true;
  }

  function resetMessageSwipeState({ invalidate = true } = {}) {
    if (invalidate) {
      swipeInitToken += 1;
    }
    for (const key in messageSwipeState) {
      if (Object.prototype.hasOwnProperty.call(messageSwipeState, key)) {
        delete messageSwipeState[key];
      }
    }
    clearSetRef(swipeLoading);
  }

  async function initMessageSwipes(conversationId) {
    if (disposed || route.params.id !== conversationId) return;
    const requestToken = ++swipeInitToken;
    if (!isCurrentSwipeInitRun(requestToken, conversationId)) {
      return;
    }
    resetMessageSwipeState({ invalidate: false });
    const swipeLoads = [];
    for (const message of messages.value) {
      const messageId = getPersistedMessageListItemId(message);
      if (message.role === 'assistant' && messageId) {
        swipeLoads.push(initMessageSwipe(conversationId, messageId, requestToken));
      }
    }
    await Promise.all(swipeLoads);
  }

  async function initMessageSwipe(conversationId, messageId, requestToken) {
    const swipeMessageId = normalizeMessageUiId(messageId);
    if (!swipeMessageId) {
      return;
    }
    try {
      const swipes = await fetchMessageSwipes(conversationId, swipeMessageId);
      const currentMessage = getCurrentSwipeInitMessage(requestToken, conversationId, swipeMessageId);
      if (!currentMessage) {
        return;
      }
      messageSwipeState[swipeMessageId] = {
        original: snapshotSwipeContent(currentMessage),
        swipes: swipes || [],
        activeIndex: 0,
        swipeCount: (swipes?.length || 0) + 1
      };
    } catch {
      const currentMessage = getCurrentSwipeInitMessage(requestToken, conversationId, swipeMessageId);
      if (!currentMessage) {
        return;
      }
      messageSwipeState[swipeMessageId] = {
        original: snapshotSwipeContent(currentMessage),
        swipes: [],
        activeIndex: 0,
        swipeCount: 1
      };
    }
  }

  async function swipeMessagePrev(message) {
    if (disposed) return;
    const target = getCurrentSwipeTarget(message);
    if (!target || isSwipeActionLocked(target.messageId)) return;
    const { currentMessage, state } = target;
    if (!state || state.activeIndex <= 0) return;
    state.activeIndex--;
    applySwipeIndexToMessage(currentMessage, state);
  }

  async function swipeMessageNext(message, conversationId) {
    if (disposed) return;
    const target = getCurrentSwipeTarget(message);
    if (!target || isSwipeActionLocked(target.messageId)) return;
    const { messageId, currentMessage, state } = target;
    if (state.activeIndex < state.swipeCount - 1) {
      state.activeIndex++;
      applySwipeIndexToMessage(currentMessage, state);
    } else {
      addSetRefItem(swipeLoading, messageId);
      try {
        const result = await createMessageSwipe(conversationId, messageId, {
          content: currentMessage.content || '',
          reasoning: currentMessage.reasoning || '',
          usage: currentMessage.usage || null
        });
        if (!isCurrentSwipeGeneration(conversationId, messageId, currentMessage, state)) {
          return;
        }
        if (result) {
          state.swipes.push(result);
          state.swipeCount = state.swipes.length + 1;
          state.activeIndex = state.swipeCount - 1;
          applySwipeContentToMessage(currentMessage, result);
        }
      } finally {
        if (!disposed && route.params.id === conversationId) {
          deleteSetRefItem(swipeLoading, messageId);
        }
      }
    }
  }

  function getCurrentSwipeTarget(message) {
    const messageId = getPersistedMessageActionId(message);
    if (!messageId) {
      return null;
    }
    const currentMessage = findMessageListItem(messageId);
    const state = messageSwipeState[messageId];
    if (!currentMessage || !state) {
      return null;
    }
    return { messageId, currentMessage, state };
  }

  function isSwipeActionLocked(messageId) {
    const stateId = normalizeMessageUiId(messageId);
    return Boolean(messageActionBusy.value || branchBusy.value || swipeLoading.value.has(stateId));
  }

  function snapshotSwipeContent(message) {
    return {
      content: message?.content || '',
      reasoning: message?.reasoning || ''
    };
  }

  function applySwipeIndexToMessage(message, state) {
    const swipe = state.activeIndex > 0
      ? state.swipes[state.activeIndex - 1]
      : state.original;
    if (!swipe) {
      return false;
    }
    return applySwipeContentToMessage(message, swipe);
  }

  function applySwipeContentToMessage(message, swipe = {}) {
    const nextContent = swipe?.content || '';
    const nextReasoning = swipe?.reasoning || '';
    if (String(message.content || '') === nextContent && String(message.reasoning || '') === nextReasoning) {
      return false;
    }
    message.content = nextContent;
    message.reasoning = nextReasoning;
    triggerRef(messages);
    return true;
  }

  function getCurrentSwipeInitMessage(requestToken, conversationId, messageId) {
    if (!isCurrentSwipeInitRun(requestToken, conversationId)) {
      return null;
    }
    return findMessageListItem(messageId);
  }

  function isCurrentSwipeInitRun(requestToken, conversationId) {
    return !disposed && requestToken === swipeInitToken && route.params.id === conversationId;
  }

  function isCurrentSwipeGeneration(conversationId, messageId, currentMessage, state) {
    return !disposed
      && route.params.id === conversationId
      && findMessageListItem(messageId) === currentMessage
      && messageSwipeState[messageId] === state;
  }

  function getSwipeDisplay(message) {
    const state = messageSwipeState[normalizeMessageUiId(message?.id)];
    if (!state || state.swipeCount <= 1) return '';
    return `${state.activeIndex + 1}/${state.swipeCount}`;
  }

  // ── Branch ──
  const branchComparisonFields = ['id', 'title', 'branchedFromMessageId', 'createdAt', 'characterName'];
  const conversationBranches = ref([]);
  const branchBusy = ref(false);
  let branchLoadToken = 0;
  let branchActionToken = 0;

  function setConversationBranches(branches) {
    const nextBranches = Array.isArray(branches) ? branches : [];
    if (sameConversationBranches(conversationBranches.value, nextBranches)) {
      return;
    }
    conversationBranches.value = nextBranches;
  }

  function sameConversationBranches(currentBranches, nextBranches) {
    if (currentBranches === nextBranches) {
      return true;
    }
    if (currentBranches.length !== nextBranches.length) {
      return false;
    }
    for (let index = 0; index < currentBranches.length; index += 1) {
      if (!sameConversationBranch(currentBranches[index], nextBranches[index])) {
        return false;
      }
    }
    return true;
  }

  function sameConversationBranch(currentBranch = {}, nextBranch = {}) {
    for (let index = 0; index < branchComparisonFields.length; index += 1) {
      const field = branchComparisonFields[index];
      if (currentBranch?.[field] !== nextBranch?.[field]) {
        return false;
      }
    }
    return true;
  }

  async function loadConversationBranches(conversationId) {
    if (disposed || !conversationId) return;
    const requestToken = ++branchLoadToken;
    try {
      const branches = await fetchConversationBranches(conversationId);
      if (!isCurrentBranchLoad(requestToken, conversationId)) {
        return;
      }
      setConversationBranches(branches);
    } catch {
      if (!isCurrentBranchLoad(requestToken, conversationId)) {
        return;
      }
      setConversationBranches([]);
    }
  }

  async function handleBranchMessage(message, conversationId, onBranched) {
    if (disposed || !conversationId || !canBranchMessage(message)) {
      return;
    }
    const messageId = getPersistedMessageActionId(message);
    if (!messageId) {
      return;
    }
    const currentMessage = findMessageListItem(messageId);
    if (!currentMessage) {
      return;
    }
    const requestToken = ++branchActionToken;
    branchBusy.value = true;
    const isCurrentBranchContext = () => isCurrentBranchActionTarget(
      requestToken,
      conversationId,
      messageId,
      currentMessage
    );
    try {
      const result = await branchConversation(conversationId, messageId);
      if (!isCurrentBranchContext()) {
        return;
      }
      if (result?.id && onBranched) {
        await onBranched(result.id, isCurrentBranchContext);
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

  function isCurrentBranchAction(requestToken, conversationId) {
    return !disposed && requestToken === branchActionToken && route.params.id === conversationId;
  }

  function isCurrentBranchActionTarget(requestToken, conversationId, messageId, currentMessage) {
    return isCurrentBranchAction(requestToken, conversationId)
      && findMessageListItem(messageId) === currentMessage;
  }

  function resetMessageUiState() {
    messageActionToken += 1;
    branchLoadToken += 1;
    branchActionToken += 1;
    copyActionToken += 1;
    clearMessageEdit();
    clearSetRef(expandedReasoning);
    messageActionBusy.value = '';
    copyBusy.value = false;
    branchBusy.value = false;
    setConversationBranches([]);
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
    copyActionToken += 1;
    if (focusEditorRafId) {
      window.cancelAnimationFrame(focusEditorRafId);
      focusEditorRafId = null;
    }
    messageActionBusy.value = '';
    copyBusy.value = false;
    branchBusy.value = false;
    clearSetRef(swipeLoading);
  }

  return {
    expandedReasoning,
    editingMessageId,
    editingMessageContent,
    messageActionBusy,
    copyBusy,
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
    canBranchMessage,
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
