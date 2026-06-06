import { newId, nowIso } from '../security.js';

const VALID_TYPES = ['prompt_inject', 'style_enhance', 'custom'];

export function listMods(database, userId) {
  return database
    .prepare(
      `SELECT id, user_id, name, description, type, content, enabled, order_index, created_at
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
      `INSERT INTO mods (id, user_id, name, description, type, content, enabled, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      normalized.name,
      normalized.description,
      normalized.type,
      normalized.content,
      normalized.enabled ? 1 : 0,
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
        name = ?, description = ?, type = ?, content = ?, enabled = ?, order_index = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(
      normalized.name,
      normalized.description,
      normalized.type,
      normalized.content,
      normalized.enabled ? 1 : 0,
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

export function getEnabledModsForUser(database, userId) {
  return database
    .prepare(
      `SELECT id, name, type, content
       FROM mods
       WHERE user_id = ? AND enabled = 1
       ORDER BY order_index ASC, created_at DESC, rowid DESC`
    )
    .all(userId)
    .map(toMod);
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
  const name = normalizeName(payload.name ?? existing?.name ?? '');
  const description = String(payload.description ?? existing?.description ?? '').trim();
  const type = normalizeType(payload.type ?? existing?.type ?? 'prompt_inject');
  const content = String(payload.content ?? existing?.content ?? '').trim();
  const enabled = Boolean(payload.enabled ?? existing?.enabled ?? true);
  const orderIndex = Number(payload.orderIndex ?? payload.order_index ?? existing?.order_index ?? existing?.orderIndex ?? 0);

  return { name, description, type, content, enabled, orderIndex };
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

function toMod(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    type: row.type,
    content: row.content || '',
    enabled: Boolean(row.enabled),
    orderIndex: Number(row.order_index),
    createdAt: row.created_at
  };
}
