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

  function check() {
    if (typeof window === 'undefined') {
      isPhone.value = false;
      return;
    }
    isPhone.value = window.matchMedia(breakpoint).matches;
  }

  onMounted(() => {
    check();
    window.addEventListener('resize', check);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', check);
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
