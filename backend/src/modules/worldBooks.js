import { newId, nowIso } from '../security.js';

// ── World Book CRUD ──

export function listWorldBooks(database, userId) {
  return database
    .prepare(
      `SELECT wb.*,
        (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
       FROM world_books wb
       WHERE wb.user_id = ?
       ORDER BY wb.updated_at DESC`
    )
    .all(userId)
    .map(toWorldBook);
}

export function getWorldBook(database, userId, bookId) {
  const row = database
    .prepare(
      `SELECT wb.*,
        (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
       FROM world_books wb
       WHERE wb.id = ? AND wb.user_id = ?`
    )
    .get(bookId, userId);
  if (!row) {
    return null;
  }

  return {
    ...toWorldBook(row),
    entries: listEntries(database, bookId)
  };
}

export function createWorldBook(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const name = normalizeName(payload.name);
  const description = String(payload.description || '').trim().slice(0, 2000);
  const characterId = String(payload.characterId || '').trim() || null;

  database
    .prepare(
      `INSERT INTO world_books (id, user_id, name, description, character_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, name, description, characterId, timestamp, timestamp);

  return getWorldBook(database, userId, id);
}

export function updateWorldBook(database, userId, bookId, payload) {
  const existing = getOwnedWorldBook(database, userId, bookId);
  if (!existing) {
    return null;
  }

  const name = normalizeName(payload.name ?? existing.name);
  const description = String(payload.description ?? existing.description).trim().slice(0, 2000);
  const characterId = payload.characterId !== undefined
    ? (String(payload.characterId || '').trim() || null)
    : existing.characterId;

  database
    .prepare(
      `UPDATE world_books
       SET name = ?, description = ?, character_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(name, description, characterId, nowIso(), bookId, userId);

  return getWorldBook(database, userId, bookId);
}

export function deleteWorldBook(database, userId, bookId) {
  const result = database
    .prepare('DELETE FROM world_books WHERE id = ? AND user_id = ?')
    .run(bookId, userId);
  return result.changes > 0;
}

// ── Entry CRUD ──

export function createEntry(database, userId, bookId, payload) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return null;
  }

  const id = newId();
  const timestamp = nowIso();
  const data = normalizeEntryPayload(payload);
  const maxOrder = database
    .prepare('SELECT MAX(order_index) AS max_order FROM world_book_entries WHERE world_book_id = ?')
    .get(bookId);
  const orderIndex = Number(maxOrder?.max_order ?? -1) + 1;

  database
    .prepare(
      `INSERT INTO world_book_entries (
        id, world_book_id, name, trigger_keys, content, position, enabled, order_index, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, bookId, data.name, data.triggerKeys, data.content, data.position, data.enabled ? 1 : 0, orderIndex, timestamp);

  touchWorldBook(database, bookId);
  return getEntry(database, id);
}

export function updateEntry(database, userId, bookId, entryId, payload) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return null;
  }

  const existing = getEntry(database, entryId);
  if (!existing || existing.worldBookId !== bookId) {
    return null;
  }

  const data = normalizeEntryPayload({ ...existing, ...payload });

  database
    .prepare(
      `UPDATE world_book_entries
       SET name = ?, trigger_keys = ?, content = ?, position = ?, enabled = ?, order_index = ?
       WHERE id = ? AND world_book_id = ?`
    )
    .run(data.name, data.triggerKeys, data.content, data.position, data.enabled ? 1 : 0, data.orderIndex, entryId, bookId);

  touchWorldBook(database, bookId);
  return getEntry(database, entryId);
}

export function deleteEntry(database, userId, bookId, entryId) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return false;
  }

  const result = database
    .prepare('DELETE FROM world_book_entries WHERE id = ? AND world_book_id = ?')
    .run(entryId, bookId);
  if (result.changes > 0) {
    touchWorldBook(database, bookId);
  }
  return result.changes > 0;
}

// ── Trigger Injection Logic ──

export function matchWorldBookEntries(database, characterId, text) {
  if (!characterId || !text) {
    return [];
  }

  const books = database
    .prepare('SELECT id FROM world_books WHERE character_id = ?')
    .all(characterId);

  if (!books.length) {
    return [];
  }

  const bookIds = books.map((b) => b.id);
  const placeholders = bookIds.map(() => '?').join(',');
  const entries = database
    .prepare(
      `SELECT * FROM world_book_entries
       WHERE world_book_id IN (${placeholders}) AND enabled = 1
       ORDER BY order_index ASC`
    )
    .all(...bookIds);

  const lowerText = text.toLowerCase();
  const matched = [];

  for (const entry of entries) {
    const keys = String(entry.trigger_keys || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (keys.length === 0) {
      continue;
    }

    const hit = keys.some((key) => lowerText.includes(key));
    if (hit) {
      matched.push({
        name: entry.name,
        content: entry.content,
        position: entry.position
      });
    }
  }

  return matched;
}

export function buildWorldBookContext(entries) {
  if (!entries.length) {
    return '';
  }

  const beforeChar = entries.filter((e) => e.position === 'before_char').map((e) => e.content);
  const afterChar = entries.filter((e) => e.position === 'after_char').map((e) => e.content);
  const atStart = entries.filter((e) => e.position === 'at_start').map((e) => e.content);

  return [...atStart, ...beforeChar, ...afterChar].join('\n\n');
}

// ── Internal Helpers ──

function listEntries(database, bookId) {
  return database
    .prepare(
      `SELECT * FROM world_book_entries
       WHERE world_book_id = ?
       ORDER BY order_index ASC`
    )
    .all(bookId)
    .map(toEntry);
}

function getEntry(database, entryId) {
  const row = database
    .prepare('SELECT * FROM world_book_entries WHERE id = ?')
    .get(entryId);
  return row ? toEntry(row) : null;
}

function getOwnedWorldBook(database, userId, bookId) {
  const row = database
    .prepare('SELECT * FROM world_books WHERE id = ? AND user_id = ?')
    .get(bookId, userId);
  return row || null;
}

function touchWorldBook(database, bookId) {
  database
    .prepare('UPDATE world_books SET updated_at = ? WHERE id = ?')
    .run(nowIso(), bookId);
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 80) {
    throw new Error('世界书名称长度需为 1-80 个字符');
  }
  return value;
}

function normalizeEntryPayload(payload = {}) {
  const name = String(payload.name || '').trim().slice(0, 120);
  const triggerKeys = String(payload.triggerKeys || '').trim().slice(0, 2000);
  const content = String(payload.content || '').slice(0, 10000);
  const position = ['before_char', 'after_char', 'at_start'].includes(payload.position)
    ? payload.position
    : 'before_char';
  const enabled = payload.enabled !== false;
  const orderIndex = Number.isFinite(Number(payload.orderIndex)) ? Number(payload.orderIndex) : 0;

  return { name, triggerKeys, content, position, enabled, orderIndex };
}

function toWorldBook(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    characterId: row.character_id || null,
    entryCount: Number(row.entry_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toEntry(row) {
  return {
    id: row.id,
    worldBookId: row.world_book_id,
    name: row.name || '',
    triggerKeys: row.trigger_keys || '',
    content: row.content || '',
    position: row.position || 'before_char',
    enabled: Boolean(row.enabled),
    orderIndex: row.order_index,
    createdAt: row.created_at
  };
}
