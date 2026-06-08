import { registerExtension, unregisterExtension, getAllExtensions } from './extensions.js';
import { HOOK_TYPES } from './extensionHooks.js';
import { apiRequest } from '../api.js';

export const MOD_EXTENSION_PREFIX = '__mod__';

/**
 * Convert a backend mod object into a registered extension.
 * @param {Object} mod - Backend mod (id, name, description, type, content)
 * @returns {{ manifest: Object, module: Object }}
 */
export function createModExtension(mod) {
  const manifest = {
    name: MOD_EXTENSION_PREFIX + mod.id,
    version: '1.0.0',
    description: mod.description || mod.name,
    hooks: [HOOK_TYPES.MESSAGE_SEND],
  };

  const module = {
    onMessageSend(payload) {
      const modContext = payload.modContext || [];
      if (mod.type === 'prompt_inject') {
        modContext.push(mod.content);
      } else if (mod.type === 'style_enhance') {
        modContext.push(`[文风要求]\n${mod.content}`);
      } else {
        modContext.push(`[Mod: ${mod.name}]\n${mod.content}`);
      }
      return { ...payload, modContext };
    },
  };

  return { manifest, module };
}

/**
 * Synchronise backend mods with the extension registry.
 * Unregisters stale mod extensions, then registers the current set.
 * @param {Object[]} mods - Array of mod objects from the backend
 */
export function syncModsToExtensions(mods, options = {}) {
  const characterId = getCharacterIdOption(options);
  unregisterModExtensions();
  registerApplicableModExtensions(mods, characterId);
}

/**
 * Fetch enabled mods from the backend and synchronise them as extensions.
 * @returns {Promise<Object[]>} The full mod list returned by the API
 */
export async function loadAndSyncMods(options = {}) {
  const characterId = getCharacterIdOption(options);
  const mods = await apiRequest('/api/mods');
  unregisterModExtensions();
  registerApplicableModExtensions(mods, characterId, true);
  return mods;
}

export function modAppliesToCharacter(mod, characterId = '') {
  const characterIds = mod?.characterIds || mod?.character_ids || [];
  const scope = normalizeModScope(mod?.scope, characterIds);
  if (scope === 'global') {
    return true;
  }
  if (!characterId) {
    return false;
  }
  if (scope === 'all_characters') {
    return true;
  }
  return characterIdsInclude(characterIds, characterId);
}

function normalizeModScope(scope, characterIds = []) {
  const value = String(scope || '').trim();
  if (['global', 'all_characters', 'characters'].includes(value)) {
    return value;
  }
  return hasAnyCharacterId(characterIds) ? 'characters' : 'global';
}

function getCharacterIdOption(options) {
  return typeof options === 'string'
    ? options
    : String(options?.characterId || '').trim();
}

function unregisterModExtensions() {
  const existing = getAllExtensions();
  for (const ext of existing) {
    if (ext.manifest.name.startsWith(MOD_EXTENSION_PREFIX)) {
      unregisterExtension(ext.manifest.name);
    }
  }
}

function registerApplicableModExtensions(mods, characterId, enabledOnly = false) {
  for (const mod of mods) {
    if (enabledOnly && !mod?.enabled) {
      continue;
    }
    if (!modAppliesToCharacter(mod, characterId)) {
      continue;
    }
    const { manifest, module } = createModExtension(mod);
    registerExtension(manifest, module);
  }
}

function hasAnyCharacterId(ids = []) {
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId || '').trim();
    if (id) {
      return true;
    }
  }
  return false;
}

function characterIdsInclude(ids = [], characterId = '') {
  for (const rawId of Array.isArray(ids) ? ids : []) {
    if (String(rawId || '').trim() === characterId) {
      return true;
    }
  }
  return false;
}
