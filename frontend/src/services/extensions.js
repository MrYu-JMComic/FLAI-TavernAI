/**
 * Extension runtime system for FLAI-TavernAI.
 * Manages extension lifecycle, registration, and coordination with the hook system.
 * @module services/extensions
 */

import { registerHook, unregisterHook, HOOK_TYPES } from './extensionHooks.js';

/** @type {Map<string, ExtensionEntry>} */
const extensions = new Map();

/**
 * @typedef {Object} ExtensionManifest
 * @property {string} name - Unique extension identifier
 * @property {string} version - Semver version string
 * @property {string} description - Human-readable description
 * @property {string[]} hooks - Hook types this extension registers for
 */

/**
 * @typedef {Object} ExtensionModule
 * @property {function(ExtensionContext):Promise<void>|void} [onLoad] - Called when extension is initialized
 * @property {function(ExtensionContext):Promise<void>|void} [onUnload] - Called when extension is shut down
 * @property {function(Object, ExtensionContext):Promise<Object|false>|Object|false} [onMessageSend] - Transform outgoing messages
 * @property {function(Object, ExtensionContext):Promise<Object|false>|Object|false} [onMessageReceive] - Transform incoming messages
 */

/**
 * @typedef {Object} ExtensionContext
 * @property {ExtensionManifest} manifest - The extension's manifest
 * @property {boolean} enabled - Whether the extension is currently enabled
 */

/**
 * @typedef {Object} ExtensionEntry
 * @property {ExtensionManifest} manifest
 * @property {ExtensionModule} module
 * @property {boolean} enabled
 * @property {boolean} loaded
 */

/**
 * Register an extension with the runtime.
 * @param {ExtensionManifest} manifest - Extension manifest
 * @param {ExtensionModule} module - Extension module with lifecycle hooks
 * @throws {Error} If manifest.name is missing or already registered
 */
export function registerExtension(manifest, module) {
  if (!manifest || !manifest.name) {
    throw new Error('Extension manifest must include a name');
  }
  if (extensions.has(manifest.name)) {
    throw new Error(`Extension "${manifest.name}" is already registered`);
  }

  extensions.set(manifest.name, {
    manifest,
    module,
    enabled: true,
    loaded: false,
  });
}

/**
 * Unregister an extension and clean up its hooks.
 * @param {string} name - Extension name
 * @returns {boolean} True if the extension was found and removed
 */
export function unregisterExtension(name) {
  const entry = extensions.get(name);
  if (!entry) return false;

  if (entry.loaded && entry.module.onUnload) {
    const ctx = createContext(entry);
    entry.module.onUnload(ctx);
  }

  // Remove all hooks registered by this extension
  for (const hookType of Object.values(HOOK_TYPES)) {
    unregisterHook(hookType, name);
  }

  extensions.delete(name);
  return true;
}

/**
 * Get an extension entry by name.
 * @param {string} name - Extension name
 * @returns {ExtensionEntry|undefined}
 */
export function getExtension(name) {
  return extensions.get(name);
}

/**
 * List all registered extensions.
 * @returns {ExtensionEntry[]}
 */
export function getAllExtensions() {
  return Array.from(extensions.values());
}

/**
 * Enable a registered extension.
 * @param {string} name - Extension name
 * @returns {boolean} True if the extension was found and enabled
 */
export function enableExtension(name) {
  const entry = extensions.get(name);
  if (!entry) return false;
  entry.enabled = true;
  return true;
}

/**
 * Disable a registered extension. Hooks for disabled extensions are skipped during execution.
 * @param {string} name - Extension name
 * @returns {boolean} True if the extension was found and disabled
 */
export function disableExtension(name) {
  const entry = extensions.get(name);
  if (!entry) return false;
  entry.enabled = false;
  return true;
}

/**
 * Load all registered extensions: wire up hooks and call onLoad for each enabled extension.
 * Extensions are loaded in registration order.
 * @returns {Promise<void>}
 */
export async function initializeExtensions() {
  for (const entry of extensions.values()) {
    if (!entry.enabled || entry.loaded) continue;

    // Register lifecycle hooks declared in the manifest
    const hookList = entry.manifest.hooks || [];
    for (const hookType of hookList) {
      if (!Object.values(HOOK_TYPES).includes(hookType)) continue;

      const handler = entry.module[hookType];
      if (typeof handler === 'function') {
        const wrappedPayload = (payload, context) => {
          if (!entry.enabled) return payload;
          return handler(payload, context);
        };
        registerHook(hookType, wrappedPayload, entry.manifest.name);
      }
    }

    if (entry.module.onLoad) {
      const ctx = createContext(entry);
      await entry.module.onLoad(ctx);
    }

    entry.loaded = true;
  }
}

/**
 * Unload all extensions: call onUnload and remove hooks.
 * @returns {Promise<void>}
 */
export async function shutdownExtensions() {
  for (const entry of extensions.values()) {
    if (!entry.loaded) continue;

    if (entry.module.onUnload) {
      const ctx = createContext(entry);
      await entry.module.onUnload(ctx);
    }

    for (const hookType of Object.values(HOOK_TYPES)) {
      unregisterHook(hookType, entry.manifest.name);
    }

    entry.loaded = false;
  }
}

/**
 * Create a read-only context object for an extension.
 * @param {ExtensionEntry} entry
 * @returns {ExtensionContext}
 */
function createContext(entry) {
  return {
    manifest: { ...entry.manifest },
    enabled: entry.enabled,
  };
}

// ── Shared Extension Context ────────────────────────────────────────────────

/** @type {{ conversation: Object|null, character: Object|null, user: Object|null, settings: Object|null, messages: Object[] }} */
const sharedContext = {
  conversation: null,
  character: null,
  user: null,
  settings: null,
  messages: [],
};

/**
 * Merge partial updates into the shared extension context.
 * @param {Partial<typeof sharedContext>} partial - Fields to merge
 */
export function updateContext(partial) {
  if (!partial || typeof partial !== 'object') return;
  Object.assign(sharedContext, partial);
}

/**
 * Get a shallow copy of the current shared extension context.
 * @returns {{ conversation: Object|null, character: Object|null, user: Object|null, settings: Object|null, messages: Object[] }}
 */
export function getContext() {
  return { ...sharedContext, messages: [...sharedContext.messages] };
}
