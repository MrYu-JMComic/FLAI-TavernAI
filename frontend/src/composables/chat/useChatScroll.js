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

  const showScrollBottomButton = computed(() => {
    return !isScrollPinned.value && distanceToBottom.value > scrollButtonDistanceThreshold;
  });

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

  function restoreMessageScrollPosition(messages) {
    requestAnimationFrame(() => {
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
    return `flai-chat-scroll:${conversationId.value || 'active'}`;
  }

  function cleanup() {
    if (scrollSaveTimer) {
      window.clearTimeout(scrollSaveTimer);
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
    stickToBottomIfNeeded,
    scrollToBottom,
    restoreMessageScrollPosition,
    saveMessageScrollPosition,
    updateScrollState,
    cleanup
  };
}
