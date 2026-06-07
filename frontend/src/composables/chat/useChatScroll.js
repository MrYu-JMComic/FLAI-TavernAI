import { computed, ref } from 'vue';

export function useChatScroll({ messageScroller, conversationId }) {
  const isScrollPinned = ref(true);
  const distanceToBottom = ref(0);

  const scrollStickThreshold = 120;
  const scrollButtonDistanceThreshold = 360;
  const manualScrollIntentCooldownMs = 1400;

  let scrollSaveTimer = null;
  let lastManualScrollIntentAt = 0;
  let touchStartY = 0;
  let lastTouchY = 0;
  let userPausedAutoScroll = false;
  let disposed = false;
  let scrollToBottomRafId = null;
  let restoreScrollRafId = null;
  let scrollStateRafId = null;
  let smoothScrollStateTimer = null;

  const showScrollBottomButton = computed(() => {
    return !isScrollPinned.value && distanceToBottom.value > scrollButtonDistanceThreshold;
  });

  function handleMessageScroll() {
    scheduleScrollStateUpdate();
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
    if (disposed) {
      return;
    }
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

  function scheduleScrollStateUpdate() {
    if (disposed || scrollStateRafId) {
      return;
    }
    if (typeof requestAnimationFrame !== 'function') {
      updateScrollState();
      return;
    }
    scrollStateRafId = requestAnimationFrame(() => {
      scrollStateRafId = null;
      updateScrollState();
    });
  }

  function isPinnedToBottom() {
    if (disposed) {
      return false;
    }
    const el = messageScroller.value;
    if (!el) {
      return isScrollPinned.value;
    }
    if (userPausedAutoScroll || hasRecentManualScrollIntent()) {
      return false;
    }
    return isScrollPinned.value || getDistanceToBottom(el) <= scrollStickThreshold;
  }

  function hasUserPausedAutoScroll() {
    return userPausedAutoScroll || hasRecentManualScrollIntent();
  }

  function stickToBottomIfNeeded(smooth = false) {
    if (disposed) {
      return;
    }
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
    if (disposed) {
      return;
    }
    if (keepPinned) {
      lastManualScrollIntentAt = 0;
      userPausedAutoScroll = false;
      isScrollPinned.value = true;
    }
    if (scrollToBottomRafId) {
      cancelAnimationFrame(scrollToBottomRafId);
    }
    scrollToBottomRafId = requestAnimationFrame(() => {
      scrollToBottomRafId = null;
      if (disposed) {
        return;
      }
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
        scheduleSmoothScrollStateUpdate();
      }
      scheduleSaveMessageScrollPosition();
    });
  }

  function scrollToMessage(messageId, options = {}) {
    if (disposed || !messageId) {
      return false;
    }

    const el = messageScroller.value;
    const target = findMessageElement(messageId);
    if (!el || !target) {
      return false;
    }

    if (scrollToBottomRafId) {
      cancelAnimationFrame(scrollToBottomRafId);
      scrollToBottomRafId = null;
    }

    const {
      smooth = true,
      block = 'end',
      padding = 18,
      keepPinned = false
    } = options;

    if (keepPinned) {
      lastManualScrollIntentAt = 0;
      userPausedAutoScroll = false;
      isScrollPinned.value = true;
    }

    const targetTop = getMessageScrollTop(el, target, { block, padding });
    if (!Number.isFinite(targetTop)) {
      return false;
    }

    if (typeof el.scrollTo === 'function') {
      el.scrollTo({
        top: targetTop,
        behavior: smooth ? 'smooth' : 'auto'
      });
    } else {
      el.scrollTop = targetTop;
    }

    if (!smooth) {
      updateScrollState();
    } else if (typeof window !== 'undefined') {
      scheduleSmoothScrollStateUpdate();
    }
    scheduleSaveMessageScrollPosition();
    return true;
  }

  function getMessageScrollTop(el, target, { block, padding }) {
    const scrollerRect = el.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const insets = getScrollerInsets(el);
    const visibleTop = scrollerRect.top + insets.top;
    const visibleBottom = scrollerRect.bottom - insets.bottom;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    let top;

    if (block === 'start') {
      top = el.scrollTop + targetRect.top - visibleTop - padding;
    } else if (block === 'center') {
      const visibleCenter = visibleTop + Math.max(0, visibleBottom - visibleTop) / 2;
      const targetCenter = targetRect.top + targetRect.height / 2;
      top = el.scrollTop + targetCenter - visibleCenter;
    } else {
      top = el.scrollTop + targetRect.bottom - visibleBottom + padding;
    }

    return Math.min(maxScrollTop, Math.max(0, top));
  }

  function getScrollerInsets(el) {
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
      return { top: 0, bottom: 0 };
    }
    const style = window.getComputedStyle(el);
    return {
      top: Number.parseFloat(style.paddingTop) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0
    };
  }

  function findMessageElement(messageId) {
    const el = messageScroller.value;
    if (!el) {
      return null;
    }
    return [...el.querySelectorAll('.deep-message')]
      .find((element) => element.dataset.messageId === String(messageId)) || null;
  }

  function restoreMessageScrollPosition(messages) {
    if (disposed) {
      return;
    }
    if (restoreScrollRafId) {
      cancelAnimationFrame(restoreScrollRafId);
    }
    restoreScrollRafId = requestAnimationFrame(() => {
      restoreScrollRafId = null;
      if (disposed) {
        return;
      }
      const el = messageScroller.value;
      if (!el) {
        return;
      }

      const saved = readScrollSnapshot();
      if (!saved) {
        if (messages && messages.value.length === 1 && messages.value[0]?.role === 'assistant') {
          el.scrollTop = 0;
          updateScrollState();
          scheduleSaveMessageScrollPosition();
          return;
        }
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
    if (disposed || typeof window === 'undefined') {
      return;
    }
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
    }
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = null;
      if (disposed) {
        return;
      }
      saveMessageScrollPosition();
    }, 120);
  }

  function saveMessageScrollPosition() {
    if (disposed || typeof window === 'undefined') {
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
    return `flai-chat-scroll:${conversationId.value || 'active'}`;
  }

  function scheduleSmoothScrollStateUpdate() {
    if (disposed || typeof window === 'undefined') {
      return;
    }
    if (smoothScrollStateTimer) {
      window.clearTimeout(smoothScrollStateTimer);
    }
    smoothScrollStateTimer = window.setTimeout(() => {
      smoothScrollStateTimer = null;
      updateScrollState();
    }, 360);
  }

  function cleanup() {
    disposed = true;
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = null;
    }
    if (smoothScrollStateTimer) {
      window.clearTimeout(smoothScrollStateTimer);
      smoothScrollStateTimer = null;
    }
    if (scrollToBottomRafId) {
      cancelAnimationFrame(scrollToBottomRafId);
      scrollToBottomRafId = null;
    }
    if (restoreScrollRafId) {
      cancelAnimationFrame(restoreScrollRafId);
      restoreScrollRafId = null;
    }
    if (scrollStateRafId) {
      cancelAnimationFrame(scrollStateRafId);
      scrollStateRafId = null;
    }
  }

  return {
    isScrollPinned,
    distanceToBottom,
    showScrollBottomButton,
    handleMessageScroll,
    handleWheelScrollIntent,
    handleTouchStart,
    handleTouchMove,
    isPinnedToBottom,
    hasUserPausedAutoScroll,
    stickToBottomIfNeeded,
    scrollToBottom,
    scrollToMessage,
    restoreMessageScrollPosition,
    saveMessageScrollPosition,
    updateScrollState,
    cleanup
  };
}
