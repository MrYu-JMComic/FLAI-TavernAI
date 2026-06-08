/**
 * Hook system for the FLAI-TavernAI extension runtime.
 * Manages hook registration, priority ordering, and execution.
 * @module services/extensionHooks.js
 */

/**
 * Available hook types.
 * @enum {string}
 */
export const HOOK_TYPES = {
  /** Transform or block an outgoing message before it is sent. */
  MESSAGE_SEND: 'onMessageSend',
  /** Transform or block an incoming message before it is displayed. */
  MESSAGE_RECEIVE: 'onMessageReceive',
  /** Inject or modify context when world info entries match. */
  WORLD_INFO_MATCH: 'onWorldInfoMatch',
  /** Run logic when a conversation is loaded. */
  CONVERSATION_LOAD: 'onConversationLoad',
};

/**
 * @typedef {Object} HookEntry
 * @property {string} extensionName - Owning extension name
 * @property {number} priority - Lower numbers run first (default 100)
 * @property {HookCallback} callback - The hook function
 */

/**
 * @callback HookCallback
 * @param {Object} payload - The data being processed
 * @param {HookContext} context - Execution context
 * @returns {Promise<Object|false>|Object|false} Modified payload, or false to block
 */

/**
 * @typedef {Object} HookContext
 * @property {string} hookType - The type of hook being executed
 * @property {string} extensionName - The extension that registered this hook
 */

/** @type {Map<string, HookEntry[]>} */
const hooks = new Map();

/**
 * Register a hook callback for a given hook type.
 * If the extension already has a hook of this type, it is replaced.
 * @param {string} hookType - One of HOOK_TYPES values
 * @param {HookCallback} callback - Hook function
 * @param {string} extensionName - Name of the registering extension
 * @param {number} [priority=100] - Execution order (lower runs first)
 */
export function registerHook(hookType, callback, extensionName, priority = 100) {
  if (!Object.values(HOOK_TYPES).includes(hookType)) {
    throw new Error(`Unknown hook type: ${hookType}`);
  }
  if (typeof callback !== 'function') {
    throw new Error('Hook callback must be a function');
  }

  let entries = hooks.get(hookType);
  if (!entries) {
    entries = [];
    hooks.set(hookType, entries);
  }

  // Remove existing hook from this extension for this type
  const existingIndex = entries.findIndex(e => e.extensionName === extensionName);
  if (existingIndex !== -1) {
    entries.splice(existingIndex, 1);
  }

  entries.push({ extensionName, priority, callback });

  // Keep sorted by priority (ascending)
  entries.sort((a, b) => a.priority - b.priority);
}

/**
 * Remove all hooks registered by an extension for a given hook type.
 * @param {string} hookType - One of HOOK_TYPES values
 * @param {string} extensionName - Extension whose hooks to remove
 * @returns {boolean} True if any hooks were removed
 */
export function unregisterHook(hookType, extensionName) {
  const entries = hooks.get(hookType);
  if (!entries) return false;

  let nextEntries = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.extensionName === extensionName) {
      if (!nextEntries) {
        nextEntries = [];
        for (let copyIndex = 0; copyIndex < index; copyIndex += 1) {
          nextEntries.push(entries[copyIndex]);
        }
      }
      continue;
    }
    if (nextEntries) {
      nextEntries.push(entry);
    }
  }

  if (!nextEntries) return false;

  if (nextEntries.length === 0) {
    hooks.delete(hookType);
  } else {
    hooks.set(hookType, nextEntries);
  }
  return true;
}

/**
 * Execute all hooks for a given type in priority order.
 * Each hook receives the (possibly modified) payload from the previous hook.
 * If any hook returns `false`, execution stops and `false` is returned.
 * @param {string} hookType - One of HOOK_TYPES values
 * @param {Object} payload - Data to pass through the hook chain
 * @returns {Promise<Object|false>} Final payload after all hooks, or false if blocked
 */
export async function executeHooks(hookType, payload) {
  const entries = hooks.get(hookType);
  if (!entries || entries.length === 0) return payload;

  let current = payload;

  for (const entry of entries) {
    const context = {
      hookType,
      extensionName: entry.extensionName,
    };

    const result = await entry.callback(current, context);

    if (result === false) return false;
    if (result !== undefined && result !== null) {
      current = result;
    }
  }

  return current;
}

/**
 * Get all registered hook entries for a given type (for debugging).
 * @param {string} hookType - One of HOOK_TYPES values
 * @returns {HookEntry[]}
 */
export function getHooks(hookType) {
  return [...(hooks.get(hookType) || [])];
}

/**
 * Remove all hooks from all types. Useful for testing.
 */
export function clearAllHooks() {
  hooks.clear();
}
