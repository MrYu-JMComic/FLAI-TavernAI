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
  const isPhone = ref(false);
  let mediaQuery = null;
  let unsubscribe = null;

  function check() {
    if (typeof window === 'undefined') {
      isPhone.value = false;
      return;
    }
    isPhone.value = (mediaQuery || window.matchMedia(breakpoint)).matches;
  }

  function handleMediaChange(event) {
    isPhone.value = event.matches;
  }

  onMounted(() => {
    if (typeof window === 'undefined') {
      return;
    }
    mediaQuery = window.matchMedia(breakpoint);
    check();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
      unsubscribe = () => mediaQuery?.removeEventListener('change', handleMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleMediaChange);
      unsubscribe = () => mediaQuery?.removeListener(handleMediaChange);
    } else {
      window.addEventListener('resize', check);
      unsubscribe = () => window.removeEventListener('resize', check);
    }
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
    mediaQuery = null;
  });

  return { isPhone, check };
}

/**
 * Stateless version for use outside of Vue component setup (e.g. in composables).
 */
export function isPhoneViewport() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(max-width: 760px)').matches;
}
