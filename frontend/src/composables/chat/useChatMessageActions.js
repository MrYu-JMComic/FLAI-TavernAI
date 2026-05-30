import { nextTick, ref, triggerRef } from 'vue';
import { deleteMessage, updateMessage } from '../../api';

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
      showActionNotice('消息内容不能为空', 'warning');
      return;
    }
    if (!canEditMessage(message)) {
      return;
    }

    messageActionBusy.value = message.id;
    try {
      const updated = await updateMessage(route.params.id, message.id, { content });
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
      const deletion = await deleteMessage(route.params.id, message.id);
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
      showActionNotice('没有可复制的内容', 'warning');
      return;
    }

    try {
      await requestClipboardPermission();
      await writeClipboardText(text);
      showActionNotice('已复制到剪贴板');
    } catch (err) {
      showActionNotice(err.message || '复制失败，请检查浏览器权限', 'warning');
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
    clearMessageEdit,
    saveMessageEdit,
    removeMessage,
    copyMessage
  };
}
