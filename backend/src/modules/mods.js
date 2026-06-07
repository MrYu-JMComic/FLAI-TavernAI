import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { parseJson } from '../utils/json.js';
import { normalizeFiniteNumber } from '../utils/number.js';

const VALID_TYPES = ['prompt_inject', 'style_enhance', 'custom'];
const VALID_SCOPES = ['global', 'all_characters', 'characters'];
const MAX_CHARACTER_BINDINGS = 100;

export function listMods(database, userId) {
  return database
    .prepare(
      `SELECT id, user_id, name, description, type, content, enabled, scope, character_ids, order_index, created_at
       FROM mods
       WHERE user_id = ?
       ORDER BY order_index ASC, created_at DESC, rowid DESC`
    )
    .all(userId)
    .map(toMod);
}

export function getMod(database, userId, modId) {
  const row = database
    .prepare('SELECT * FROM mods WHERE id = ? AND user_id = ?')
    .get(modId, userId);
  return row ? toMod(row) : null;
}

export function createMod(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const normalized = normalizeModPayload(payload);

  const maxOrder = database
    .prepare('SELECT MAX(order_index) AS max_order FROM mods WHERE user_id = ?')
    .get(userId);
  const orderIndex = Number(maxOrder?.max_order ?? -1) + 1;

  database
    .prepare(
      `INSERT INTO mods (id, user_id, name, description, type, content, enabled, scope, character_ids, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      normalized.name,
      normalized.description,
      normalized.type,
      normalized.content,
      normalized.enabled ? 1 : 0,
      normalized.scope,
      JSON.stringify(normalized.characterIds),
      orderIndex,
      timestamp
    );

  return getMod(database, userId, id);
}

export function updateMod(database, userId, modId, payload) {
  const existing = database
    .prepare('SELECT * FROM mods WHERE id = ? AND user_id = ?')
    .get(modId, userId);
  if (!existing) {
    return null;
  }

  const normalized = normalizeModPayload(payload, existing);

  database
    .prepare(
      `UPDATE mods SET
        name = ?, description = ?, type = ?, content = ?, enabled = ?, scope = ?, character_ids = ?, order_index = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(
      normalized.name,
      normalized.description,
      normalized.type,
      normalized.content,
      normalized.enabled ? 1 : 0,
      normalized.scope,
      JSON.stringify(normalized.characterIds),
      normalized.orderIndex,
      modId,
      userId
    );

  return getMod(database, userId, modId);
}

export function deleteMod(database, userId, modId) {
  const result = database
    .prepare('DELETE FROM mods WHERE id = ? AND user_id = ?')
    .run(modId, userId);
  return result.changes > 0;
}

export function reorderMods(database, userId, orderedIds) {
  const current = database
    .prepare(
      `SELECT id
       FROM mods
       WHERE user_id = ?
       ORDER BY order_index ASC, created_at DESC, rowid DESC`
    )
    .all(userId);
  const existingIds = new Set(current.map((row) => row.id));
  const seen = new Set();
  const nextIds = [];

  for (const rawId of Array.isArray(orderedIds) ? orderedIds : []) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id) || !existingIds.has(id)) {
      continue;
    }
    seen.add(id);
    nextIds.push(id);
  }

  for (const row of current) {
    if (!seen.has(row.id)) {
      nextIds.push(row.id);
    }
  }

  const statement = database.prepare(
    'UPDATE mods SET order_index = ? WHERE id = ? AND user_id = ?'
  );
  for (let i = 0; i < nextIds.length; i++) {
    statement.run(i, nextIds[i], userId);
  }
  return listMods(database, userId);
}

export function getEnabledModsForUser(database, userId, options = {}) {
  const characterId = typeof options === 'string'
    ? options
    : String(options?.characterId || '').trim();
  return database
    .prepare(
      `SELECT id, user_id, name, description, type, content, enabled, scope, character_ids, order_index, created_at
       FROM mods
       WHERE user_id = ? AND enabled = 1
       ORDER BY order_index ASC, created_at DESC, rowid DESC`
    )
    .all(userId)
    .map(toMod)
    .filter((mod) => modAppliesToCharacter(mod, characterId));
}

export function buildModSystemPrompt(mods) {
  if (!mods.length) return '';

  const parts = [];
  for (const mod of mods) {
    if (mod.type === 'prompt_inject') {
      parts.push(mod.content);
    } else if (mod.type === 'style_enhance') {
      parts.push(`[文风要求]\n${mod.content}`);
    } else {
      parts.push(`[Mod: ${mod.name}]\n${mod.content}`);
    }
  }

  return parts.join('\n\n');
}

function normalizeModPayload(payload = {}, existing = null) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const hasScopeInput = Object.prototype.hasOwnProperty.call(input, 'scope');
  const hasCharacterIdsInput =
    Object.prototype.hasOwnProperty.call(input, 'characterIds') ||
    Object.prototype.hasOwnProperty.call(input, 'character_ids');
  const name = normalizeName(input.name ?? existing?.name ?? '');
  const description = String(input.description ?? existing?.description ?? '').trim();
  const type = normalizeType(input.type ?? existing?.type ?? 'prompt_inject');
  const content = String(input.content ?? existing?.content ?? '').trim();
  const enabled = normalizeBoolean(input.enabled, normalizeBoolean(existing?.enabled, true));
  const rawCharacterIds = input.characterIds ?? input.character_ids ?? existing?.character_ids ?? existing?.characterIds ?? [];
  const characterIds = normalizeCharacterIds(rawCharacterIds);
  const scope = normalizeScope(input.scope ?? existing?.scope ?? 'global', characterIds);
  const isEditingScope = !existing || hasScopeInput || hasCharacterIdsInput;
  if (scope === 'characters' && !characterIds.length && (isEditingScope || enabled)) {
    throw new Error('指定角色加载至少需要绑定一个角色');
  }
  const currentOrderIndex = normalizeFiniteNumber(existing?.order_index ?? existing?.orderIndex ?? 0);
  const orderIndex = normalizeFiniteNumber(input.orderIndex ?? input.order_index, currentOrderIndex);

  return {
    name,
    description,
    type,
    content,
    enabled,
    scope,
    characterIds: scope === 'characters' ? characterIds : [],
    orderIndex
  };
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value) {
    throw new Error('Mod 名称不能为空');
  }
  if (value.length > 80) {
    return value.slice(0, 80);
  }
  return value;
}

function normalizeType(type) {
  return VALID_TYPES.includes(type) ? type : 'prompt_inject';
}

function normalizeScope(scope, characterIds = []) {
  const value = String(scope || '').trim();
  const normalizedCharacterIds = Array.isArray(characterIds) ? characterIds : normalizeCharacterIds(characterIds);
  if (VALID_SCOPES.includes(value)) {
    return value;
  }
  if (['all', 'all_cards', 'all_characters'].includes(value)) {
    return 'all_characters';
  }
  if (['character', 'character_bound', 'bound'].includes(value)) {
    return 'characters';
  }
  return normalizedCharacterIds.length ? 'characters' : 'global';
}

function normalizeCharacterIds(value) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  const ids = [];
  const seen = new Set();

  for (const rawId of Array.isArray(source) ? source : []) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id.slice(0, 120));
    if (ids.length >= MAX_CHARACTER_BINDINGS) {
      break;
    }
  }

  return ids;
}

export function modAppliesToCharacter(mod, characterId = '') {
  const characterIds = normalizeCharacterIds(mod?.characterIds || mod?.character_ids || []);
  const scope = normalizeScope(mod?.scope, characterIds);
  if (scope === 'global') {
    return true;
  }
  if (!characterId) {
    return false;
  }
  if (scope === 'all_characters') {
    return true;
  }
  return characterIds.includes(characterId);
}

function toMod(row) {
  const characterIds = normalizeCharacterIds(row.character_ids ?? row.characterIds);
  const scope = normalizeScope(row.scope, characterIds);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    type: row.type,
    content: row.content || '',
    enabled: Boolean(row.enabled),
    scope,
    characterIds: scope === 'characters' ? characterIds : [],
    orderIndex: Number(row.order_index),
    createdAt: row.created_at
  };
}
