import { newId } from '../security.js';

export function applyStartupMigrations(database, { getCachedTableColumns }) {
  ensureSchemaMeta(database);
  removeRegexCharacterForeignKey(database);
  migrateTagsToUserScoped(database, getCachedTableColumns);
  migrateSceneItemsToOwnedItems(database);
  repairLegacyOrphanWorldItems(database);
}

function migrateSceneItemsToOwnedItems(database) {
  const columns = new Set();
  for (const row of database.prepare('PRAGMA table_info(scene_items)').all()) {
    columns.add(row.name);
  }
  if (!columns.size || columns.has('owner_type')) {
    return;
  }

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec(`
      CREATE TABLE scene_items_new (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        node_id TEXT,
        item_code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        state_json TEXT NOT NULL DEFAULT '{}',
        position_json TEXT NOT NULL DEFAULT '{}',
        movable INTEGER NOT NULL DEFAULT 0,
        owner_type TEXT NOT NULL DEFAULT 'world',
        owner_name TEXT NOT NULL DEFAULT '',
        item_kind TEXT NOT NULL DEFAULT 'item',
        quantity INTEGER NOT NULL DEFAULT 1,
        clothing_slot TEXT NOT NULL DEFAULT '',
        equipped INTEGER NOT NULL DEFAULT 0,
        coverage_json TEXT NOT NULL DEFAULT '[]',
        icon_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (node_id) REFERENCES scene_nodes(id) ON DELETE SET NULL,
        UNIQUE(conversation_id, item_code)
      );
      INSERT INTO scene_items_new (
        id, conversation_id, node_id, item_code, name, description,
        state_json, position_json, movable, created_at, updated_at
      )
      SELECT
        id, conversation_id, node_id, item_code, name, description,
        state_json, position_json, movable, created_at, updated_at
      FROM scene_items;
      DROP TABLE scene_items;
      ALTER TABLE scene_items_new RENAME TO scene_items;
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function repairLegacyOrphanWorldItems(database) {
  const table = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scene_items'"
  ).get();
  if (!table) return;
  const conversations = database.prepare(
    `SELECT DISTINCT conversation_id FROM scene_items
     WHERE owner_type = 'world' AND node_id IS NULL`
  ).all();
  const timestamp = new Date().toISOString();
  for (const row of conversations) {
    let node = database.prepare(
      `SELECT id FROM scene_nodes
       WHERE conversation_id = ? AND node_type = 'map' AND name = '未定位物品区'
       LIMIT 1`
    ).get(row.conversation_id);
    if (!node) {
      node = { id: newId() };
      database.prepare(
        `INSERT INTO scene_nodes (
           id, conversation_id, parent_id, node_type, name, description,
           layout_json, tags_json, permanent, created_at, updated_at
         ) VALUES (?, ?, NULL, 'map', '未定位物品区', ?, ?, ?, 0, ?, ?)`
      ).run(
        node.id,
        row.conversation_id,
        '系统迁移暂存失去原地点的世界物品；请重新确认实际位置。',
        JSON.stringify({ x: 50, y: 50, iconKey: 'map.district', unresolved: true }),
        JSON.stringify(['system', 'unresolved-items']),
        timestamp,
        timestamp
      );
    }
    database.prepare(
      `UPDATE scene_items SET node_id = ?, updated_at = ?
       WHERE conversation_id = ? AND owner_type = 'world' AND node_id IS NULL`
    ).run(node.id, timestamp, row.conversation_id);
  }
}

function ensureSchemaMeta(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getSchemaVersion(database, key) {
  const row = database.prepare('SELECT value FROM _schema_meta WHERE key = ?').get(key);
  return row?.value || '';
}

function setSchemaVersion(database, key, value) {
  database.prepare('INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (?, ?)').run(key, value);
}

function removeRegexCharacterForeignKey(database) {
  if (getSchemaVersion(database, 'regex_fk_removed') === '1') {
    return;
  }

  const regexTableInfo = database
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'regex_rules' AND type = 'table'")
    .get();
  if (regexTableInfo && regexTableInfo.sql.includes('FOREIGN KEY (character_id)')) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS regex_rules_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        character_id TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        pattern TEXT NOT NULL,
        replacement TEXT NOT NULL DEFAULT '',
        flags TEXT NOT NULL DEFAULT 'g',
        scope TEXT NOT NULL DEFAULT 'input',
        enabled INTEGER NOT NULL DEFAULT 1,
        order_index INTEGER NOT NULL DEFAULT 0,
        group_name TEXT NOT NULL DEFAULT '\u5168\u5c40',
        priority INTEGER NOT NULL DEFAULT 0,
        script_mode INTEGER NOT NULL DEFAULT 0,
        js_script TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO regex_rules_new SELECT id, user_id, character_id, label, pattern, replacement, flags, scope, enabled, order_index, group_name, priority, COALESCE(script_mode, 0), COALESCE(js_script, '') FROM regex_rules;
      DROP TABLE regex_rules;
      ALTER TABLE regex_rules_new RENAME TO regex_rules;
    `);
  }
  setSchemaVersion(database, 'regex_fk_removed', '1');
}

function migrateTagsToUserScoped(database, getCachedTableColumns) {
  const columns = getCachedTableColumns(database, 'tags');
  if (columns.has('user_id')) {
    normalizeUnsafeTagIds(database);
    return;
  }

  const users = database.prepare('SELECT id FROM users ORDER BY created_at ASC, id ASC').all();
  const fallbackUserId = users[0]?.id || '';

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    database.exec(`
      CREATE TABLE tags_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, name)
      );

      CREATE TABLE character_tags_new (
        character_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (character_id, tag_id),
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags_new(id) ON DELETE CASCADE
      );
    `);

    const insertTag = database.prepare(
      'INSERT OR IGNORE INTO tags_new (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertLink = database.prepare(
      'INSERT OR IGNORE INTO character_tags_new (character_id, tag_id) VALUES (?, ?)'
    );
    const scopedTagIds = new Map();
    const ensureScopedTag = (row, userId) => {
      if (!userId) return '';
      const key = `${userId}\u0000${row.name}`;
      if (scopedTagIds.has(key)) {
        return scopedTagIds.get(key);
      }
      const tagId = newId();
      insertTag.run(tagId, userId, row.name, row.color || '', row.created_at);
      scopedTagIds.set(key, tagId);
      return tagId;
    };

    const linkedRows = database
      .prepare(
        `SELECT tags.id, tags.name, tags.color, tags.created_at, character_tags.character_id, characters.user_id
         FROM tags
         JOIN character_tags ON character_tags.tag_id = tags.id
         JOIN characters ON characters.id = character_tags.character_id
         ORDER BY tags.created_at ASC, tags.name COLLATE NOCASE ASC`
      )
      .all();

    for (const row of linkedRows) {
      const tagId = ensureScopedTag(row, row.user_id);
      if (tagId) {
        insertLink.run(row.character_id, tagId);
      }
    }

    if (fallbackUserId) {
      const unusedRows = database
        .prepare(
          `SELECT tags.id, tags.name, tags.color, tags.created_at
           FROM tags
           WHERE NOT EXISTS (SELECT 1 FROM character_tags WHERE character_tags.tag_id = tags.id)
           ORDER BY tags.created_at ASC, tags.name COLLATE NOCASE ASC`
        )
        .all();
      for (const row of unusedRows) {
        ensureScopedTag(row, fallbackUserId);
      }
    }

    database.exec(`
      DROP TABLE character_tags;
      DROP TABLE tags;
      ALTER TABLE tags_new RENAME TO tags;
      ALTER TABLE character_tags_new RENAME TO character_tags;
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function normalizeUnsafeTagIds(database) {
  const unsafeRows = database
    .prepare("SELECT id FROM tags WHERE id LIKE '%?%' OR id LIKE '%#%' OR id LIKE '%/%'")
    .all();
  if (!unsafeRows.length) {
    return;
  }

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    const updateTag = database.prepare('UPDATE tags SET id = ? WHERE id = ?');
    const updateLinks = database.prepare('UPDATE character_tags SET tag_id = ? WHERE tag_id = ?');
    for (const row of unsafeRows) {
      const nextId = newId();
      updateTag.run(nextId, row.id);
      updateLinks.run(nextId, row.id);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}
