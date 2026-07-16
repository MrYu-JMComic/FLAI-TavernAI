import { nextTick, ref } from 'vue';

export const CHAT_TOOL_KEYS = Object.freeze([
  'status',
  'npc',
  'scene',
  'economy',
  'saves',
  'context',
  'appearance'
]);

export function useChatWorkspaceUi() {
  const activeTool = ref(null);
  let returnFocusTarget = null;

  function isToolKey(value) {
    for (const key of CHAT_TOOL_KEYS) {
      if (key === value) return true;
    }
    return false;
  }

  function openTool(key, trigger) {
    if (!isToolKey(key)) return false;
    const triggerElement = trigger?.currentTarget || trigger;
    if (triggerElement && typeof triggerElement.focus === 'function') {
      returnFocusTarget = triggerElement;
    }
    activeTool.value = key;
    return true;
  }

  function closeTool(key, options = {}) {
    if (key && activeTool.value !== key) return false;
    activeTool.value = null;
    if (options.restoreFocus !== false) {
      restoreFocus();
    }
    return true;
  }

  function resetTools() {
    activeTool.value = null;
    returnFocusTarget = null;
  }

  function restoreFocus() {
    const target = returnFocusTarget;
    returnFocusTarget = null;
    if (!target?.isConnected) return;
    nextTick(() => target.focus({ preventScroll: true }));
  }

  return {
    activeTool,
    openTool,
    closeTool,
    resetTools
  };
}
