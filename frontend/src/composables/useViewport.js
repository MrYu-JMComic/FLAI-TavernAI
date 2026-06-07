import { ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * Shared viewport detection composable.
 * Replaces the duplicated isPhoneViewport() in ChatView and useChatAppearance.
 *
 * @param {object} options
 * @param {string} options.breakpoint - CSS media query (default: '(max-width: 760px)')
 * @returns {{ isPhone: import('vue').Ref<boolean> }}
 */
export function useViewport(options = {}) {
  const breakpoint = options.breakpoint || '(max-width: 760px)';
  const isPhone = ref(readBreakpointMatch(breakpoint));
  let mediaQuery = null;
  let unsubscribe = null;
  let resizeRafId = null;

  function check() {
    isPhone.value = readBreakpointMatch(breakpoint, mediaQuery);
  }

  function scheduleCheck() {
    if (resizeRafId !== null) return;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      resizeRafId = window.requestAnimationFrame(() => {
        resizeRafId = null;
        check();
      });
      return;
    }
    check();
  }

  function cancelScheduledCheck() {
    if (resizeRafId !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(resizeRafId);
    }
    resizeRafId = null;
  }

  function handleMediaChange(event) {
    isPhone.value = Boolean(event?.matches);
  }

  onMounted(() => {
    if (typeof window === 'undefined') {
      return;
    }
    mediaQuery = typeof window.matchMedia === 'function' ? window.matchMedia(breakpoint) : null;
    check();
    if (typeof mediaQuery?.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
      unsubscribe = () => mediaQuery?.removeEventListener('change', handleMediaChange);
    } else if (typeof mediaQuery?.addListener === 'function') {
      mediaQuery.addListener(handleMediaChange);
      unsubscribe = () => mediaQuery?.removeListener(handleMediaChange);
    } else {
      window.addEventListener('resize', scheduleCheck);
      unsubscribe = () => {
        window.removeEventListener('resize', scheduleCheck);
        cancelScheduledCheck();
      };
    }
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
    mediaQuery = null;
  });

  return { isPhone, check };
}

function readBreakpointMatch(query, mediaQuery = null) {
  if (typeof window === 'undefined') {
    return false;
  }
  if (mediaQuery) {
    return mediaQuery.matches;
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(query).matches;
  }
  const maxWidthMatch = String(query || '').trim().match(/^\(max-width:\s*(\d+(?:\.\d+)?)px\)$/);
  if (maxWidthMatch) {
    return window.innerWidth <= Number(maxWidthMatch[1]);
  }
  const minWidthMatch = String(query || '').trim().match(/^\(min-width:\s*(\d+(?:\.\d+)?)px\)$/);
  if (minWidthMatch) {
    return window.innerWidth >= Number(minWidthMatch[1]);
  }
  return false;
}

/**
 * Stateless version for use outside of Vue component setup (e.g. in composables).
 */
export function isPhoneViewport() {
  return readBreakpointMatch('(max-width: 760px)');
}

export function isViewportMatch(query) {
  return readBreakpointMatch(query);
}
