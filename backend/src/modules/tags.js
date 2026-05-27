import { newId, nowIso } from '../security.js';

// ── Tag CRUD ──

export function listTags(database) {
  return database
    .prepare(
      `SELECT tags.*,
        (SELECT COUNT(*) FROM character_tags WHERE tag_id = tags.id) AS usage_count
       FROM tags
       ORDER BY usage_count DESC, tags.name COLLATE NOCASE ASC`
    )
    .all()
    .map(toTag);
}

export function createTag(database, payload) {
  const name = normalizeTagName(payload.name);
  const color = normalizeColor(payload.color);
  const existing = database.prepare('SELECT id FROM tags WHERE name = ?').get(name);
  if (existing) {
    throw new Error('标签名已存在');
  }

  const id = newId();
  const timestamp = nowIso();
  database
    .prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, color, timestamp);

  return { id, name, color, usageCount: 0, createdAt: timestamp };
}

export function deleteTag(database, tagId) {
  const result = database.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  return result.changes > 0;
}

export function getTagByName(database, name) {
  const row = database
    .prepare(
      `SELECT tags.*,
        (SELECT COUNT(*) FROM character_tags WHERE tag_id = tags.id) AS usage_count
       FROM tags
       WHERE tags.name = ?`
    )
    .get(name);
  return row ? toTag(row) : null;
}

// ── Character-Tag Association ──

export function setCharacterTags(database, characterId, tagNames) {
  // Remove all existing associations
  database.prepare('DELETE FROM character_tags WHERE character_id = ?').run(characterId);

  if (!Array.isArray(tagNames) || tagNames.length === 0) {
    return;
  }

  const names = [...new Set(tagNames.map((n) => String(n).trim()).filter(Boolean))].slice(0, 12);
  const insertTag = database.prepare(
    'INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)'
  );
  const insertLink = database.prepare(
    'INSERT OR IGNORE INTO character_tags (character_id, tag_id) VALUES (?, ?)'
  );
  const findTag = database.prepare('SELECT id FROM tags WHERE name = ?');

  for (const name of names) {
    const normalized = normalizeTagName(name);
    let tag = findTag.get(normalized);
    if (!tag) {
      const id = `tag:${normalized}`;
      insertTag.run(id, normalized, '', nowIso());
      tag = findTag.get(normalized);
    }
    if (tag) {
      insertLink.run(characterId, tag.id);
    }
  }
}

export function getCharacterTagNames(database, characterId) {
  return database
    .prepare(
      `SELECT tags.name FROM character_tags
       JOIN tags ON tags.id = character_tags.tag_id
       WHERE character_tags.character_id = ?
       ORDER BY tags.name COLLATE NOCASE ASC`
    )
    .all(characterId)
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

function toTag(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color || '',
    usageCount: Number(row.usage_count ?? 0),
    createdAt: row.created_at
  };
}
