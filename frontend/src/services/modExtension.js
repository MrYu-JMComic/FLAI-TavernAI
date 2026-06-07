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
  const characterId = typeof options === 'string'
    ? options
    : String(options?.characterId || '').trim();
  const existing = getAllExtensions();
  for (const ext of existing) {
    if (ext.manifest.name.startsWith(MOD_EXTENSION_PREFIX)) {
      unregisterExtension(ext.manifest.name);
    }
  }

  for (const mod of mods.filter((item) => modAppliesToCharacter(item, characterId))) {
    const { manifest, module } = createModExtension(mod);
    registerExtension(manifest, module);
  }
}

/**
 * Fetch enabled mods from the backend and synchronise them as extensions.
 * @returns {Promise<Object[]>} The full mod list returned by the API
 */
export async function loadAndSyncMods(options = {}) {
  const characterId = typeof options === 'string'
    ? options
    : String(options?.characterId || '').trim();
  const mods = await apiRequest('/api/mods');
  const enabled = mods.filter((mod) => mod.enabled && modAppliesToCharacter(mod, characterId));
  syncModsToExtensions(enabled, { characterId });
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
  return normalizeCharacterIds(characterIds).includes(characterId);
}

function normalizeModScope(scope, characterIds = []) {
  const value = String(scope || '').trim();
  if (['global', 'all_characters', 'characters'].includes(value)) {
    return value;
  }
  return normalizeCharacterIds(characterIds).length ? 'characters' : 'global';
}

function normalizeCharacterIds(ids = []) {
  const seen = new Set();
  const normalized = [];
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}
