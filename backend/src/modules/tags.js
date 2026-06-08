import { newId, nowIso } from '../security.js';
import { withSavepoint } from './savepoint.js';

// ── Tag CRUD ──

const MAX_TAG_LIST_LIMIT = 500;
const MAX_CHARACTER_TAG_NAMES = 12;

export function listTags(database, userId, options = {}) {
  const limit = normalizeTagListLimit(options.limit);
  const params = [userId];
  let query = `SELECT tags.*,
        (SELECT COUNT(*)
         FROM character_tags
         JOIN characters ON characters.id = character_tags.character_id
         WHERE character_tags.tag_id = tags.id AND characters.user_id = tags.user_id) AS usage_count
       FROM tags
       WHERE tags.user_id = ?
       ORDER BY usage_count DESC, tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`;
  if (limit) {
    query += ' LIMIT ?';
    params.push(limit);
  }
  return database
    .prepare(query)
    .all(...params)
    .map(toTag);
}

export function createTag(database, userId, payload) {
  const name = normalizeTagName(payload.name);
  const color = normalizeColor(payload.color);
  const existing = database.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, name);
  if (existing) {
    throw new Error('标签名已存在');
  }

  const id = newId();
  const timestamp = nowIso();
  database
    .prepare('INSERT INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, name, color, timestamp);

  return { id, name, color, usageCount: 0, createdAt: timestamp };
}

export function deleteTag(database, userId, tagId) {
  const result = database.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(tagId, userId);
  return result.changes > 0;
}

// ── Character-Tag Association ──

export function setCharacterTags(database, userId, characterId, tagNames) {
  const character = database.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(characterId, userId);
  if (!character) {
    return;
  }

  withSavepoint(database, 'sp_set_character_tags', () => {
    // Remove all existing associations
    database.prepare('DELETE FROM character_tags WHERE character_id = ?').run(characterId);

    if (Array.isArray(tagNames) && tagNames.length > 0) {
      const names = [];
      const seenNames = new Set();
      for (const tagName of tagNames) {
        const name = String(tagName).trim();
        if (!name || seenNames.has(name)) {
          continue;
        }
        seenNames.add(name);
        names.push(name);
        if (names.length >= MAX_CHARACTER_TAG_NAMES) {
          break;
        }
      }
      const insertTag = database.prepare(
        'INSERT OR IGNORE INTO tags (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      const insertLink = database.prepare(
        'INSERT OR IGNORE INTO character_tags (character_id, tag_id) VALUES (?, ?)'
      );
      const findTag = database.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?');

      for (const name of names) {
        const normalized = normalizeTagName(name);
        let tag = findTag.get(userId, normalized);
        if (!tag) {
          const id = newId();
          insertTag.run(id, userId, normalized, '', nowIso());
          tag = findTag.get(userId, normalized);
        }
        if (tag) {
          insertLink.run(characterId, tag.id);
        }
      }
    }
  });
}

export function getCharacterTagNames(database, characterId, userId = '') {
  const params = [characterId];
  let userFilter = '';
  if (userId) {
    userFilter = ' AND tags.user_id = ?';
    params.push(userId);
  }
  return database
    .prepare(
      `SELECT tags.name FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ?${userFilter}
       ORDER BY tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`
    )
    .all(...params)
    .map((row) => row.name);
}

// ── Helpers ──

function normalizeTagName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 30) {
    throw new Error('标签名长度需为 1-30 个字符');
  }
  return value;
}

function normalizeColor(color) {
  const value = String(color || '').trim();
  if (value && !/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return '';
  }
  return value;
}

function normalizeTagListLimit(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.min(Math.floor(limit), MAX_TAG_LIST_LIMIT);
}

function toTag(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color || '',
    usageCount: Number(row.usage_count ?? 0),
    createdAt: row.created_at
  };
}
