import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { newId } from './security.js';
import { resetMessageCounter } from './modules/worldBooks.js';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, '..');
export const dataDir = path.join(backendRoot, 'data');
const uploadsDir = path.join(backendRoot, 'uploads');
export const avatarUploadDir = path.join(uploadsDir, 'avatars');

// ── Cached PRAGMA table_info to avoid 30+ repeated queries per startup ──
const _tableColumnCache = new Map();

function getCachedTableColumns(database, tableName) {
  if (_tableColumnCache.has(tableName)) {
    return _tableColumnCache.get(tableName);
  }
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const nameSet = new Set(columns.map((c) => c.name));
  _tableColumnCache.set(tableName, nameSet);
  return nameSet;
}

export function ensureStorageDirs() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    console.error(`[db] Failed to create data directory: ${dataDir}`, error.message);
    throw new Error(`无法创建数据目录 ${dataDir}: ${error.message}`);
  }
  try {
    fs.mkdirSync(avatarUploadDir, { recursive: true });
  } catch (error) {
    console.error(`[db] Failed to create avatar directory: ${avatarUploadDir}`, error.message);
    throw new Error(`无法创建头像目录 ${avatarUploadDir}: ${error.message}`);
  }
}

export function createAppDatabase(filename = path.join(dataDir, 'flai.sqlite')) {
  ensureStorageDirs();
  // Clear column cache so each database instance starts fresh (prevents
  // cross-instance cache pollution in tests using :memory: databases)
  _tableColumnCache.clear();
  resetMessageCounter();
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA busy_timeout = 5000');
  initializeDatabase(database);
  return database;
}

export function initializeDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      permission_group TEXT NOT NULL DEFAULT 'user',
      is_root_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_settings (
      user_id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      gateway_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      api_key_hint TEXT,
      supports_reasoning INTEGER NOT NULL DEFAULT 0,
      extra_body TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS provider_presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      gateway_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      api_key_hint TEXT,
      supports_reasoning INTEGER NOT NULL DEFAULT 0,
      extra_body TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_provider_presets_user ON provider_presets(user_id);

    CREATE TABLE IF NOT EXISTS avatar_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      base64_data TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(owner_type, owner_id)
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      gender TEXT,
      age TEXT,
      background TEXT,
      worldview TEXT,
      persona TEXT,
      opening_message TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      tags TEXT NOT NULL DEFAULT '[]',
      render_plugins TEXT NOT NULL DEFAULT '[]',
      author_advanced_settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regex_rules (
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
      group_name TEXT NOT NULL DEFAULT '全局',
      priority INTEGER NOT NULL DEFAULT 0,
      script_mode INTEGER NOT NULL DEFAULT 0,
      js_script TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      title TEXT NOT NULL,
      desktop_background_url TEXT NOT NULL DEFAULT '',
      mobile_background_url TEXT NOT NULL DEFAULT '',
      custom_css TEXT NOT NULL DEFAULT '',
      custom_js TEXT NOT NULL DEFAULT '',
      user_advanced_settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      usage_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_assets_user ON avatar_assets(user_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_assets_owner ON avatar_assets(owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
    CREATE INDEX IF NOT EXISTS idx_regex_character ON regex_rules(character_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `);
  ensureColumn(database, 'users', 'display_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'users', 'permission_group', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(database, 'users', 'is_root_admin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'characters', 'visibility', "TEXT NOT NULL DEFAULT 'private'");
  ensureColumn(database, 'characters', 'render_plugins', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, 'characters', 'author_advanced_settings', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(database, 'conversations', 'desktop_background_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'mobile_background_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'custom_css', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'custom_js', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'conversations', 'user_advanced_settings', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(database, 'conversations', 'chat_lorebook_id', 'TEXT');
  database.exec(`
    CREATE TABLE IF NOT EXISTS character_likes (
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_likes_character ON character_likes(character_id);

    CREATE TABLE IF NOT EXISTS character_favorites (
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_favorites_character ON character_favorites(character_id);
  `);
  database.exec("UPDATE users SET permission_group = 'user' WHERE permission_group IS NULL OR permission_group = ''");
  database.exec("UPDATE characters SET visibility = 'private' WHERE visibility IS NULL OR visibility = ''");
  database.exec('CREATE INDEX IF NOT EXISTS idx_characters_visibility ON characters(visibility)');

  // Regex rules enhancement: group_name, priority
  ensureColumn(database, 'regex_rules', 'group_name', "TEXT NOT NULL DEFAULT '全局'");
  ensureColumn(database, 'regex_rules', 'priority', 'INTEGER NOT NULL DEFAULT 0');

  // Sprint 2: Regex engine upgrade — script mode + global rules
  ensureColumn(database, 'regex_rules', 'script_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'regex_rules', 'js_script', "TEXT NOT NULL DEFAULT ''");

  // Sprint 3: Message Swipes
  database.exec(`
    CREATE TABLE IF NOT EXISTS message_swipes (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL DEFAULT '',
      usage_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_swipes_message ON message_swipes(message_id);
  `);

  // Sprint 3: Conversation Branching
  ensureColumn(database, 'conversations', 'branched_from_id', 'TEXT');
  ensureColumn(database, 'conversations', 'branched_from_message_id', 'TEXT');
  ensureColumn(database, 'conversations', 'branched_from_title', "TEXT NOT NULL DEFAULT ''");

  // ── Schema version tracking to skip completed migrations ──
  database.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  function getSchemaVersion(key) {
    const row = database.prepare("SELECT value FROM _schema_meta WHERE key = ?").get(key);
    return row?.value || '';
  }
  function setSchemaVersion(key, value) {
    database.prepare("INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (?, ?)").run(key, value);
  }

  // Migration: Remove FOREIGN KEY constraint on regex_rules.character_id
  // This allows global rules where character_id = ''
  if (getSchemaVersion('regex_fk_removed') !== '1') {
    const regexTableInfo = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'regex_rules' AND type = 'table'").get();
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
          group_name TEXT NOT NULL DEFAULT '全局',
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
    setSchemaVersion('regex_fk_removed', '1');
  }

  // Allow global rules (character_id = '') for rules that apply to all characters
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_regex_user_global ON regex_rules(user_id, character_id);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS world_books (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      character_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_books_user ON world_books(user_id);
    CREATE INDEX IF NOT EXISTS idx_world_books_character ON world_books(character_id);

    CREATE TABLE IF NOT EXISTS world_book_entries (
      id TEXT PRIMARY KEY,
      world_book_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      trigger_keys TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT 'before_char',
      enabled INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (world_book_id) REFERENCES world_books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_world_book_entries_book ON world_book_entries(world_book_id);

    CREATE TABLE IF NOT EXISTS character_world_books (
      character_id TEXT NOT NULL,
      world_book_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (character_id, world_book_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (world_book_id) REFERENCES world_books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cwb_character ON character_world_books(character_id);
    CREATE INDEX IF NOT EXISTS idx_cwb_book ON character_world_books(world_book_id);
  `);

  // Sprint 1: World Info deep enhancements (must come AFTER CREATE TABLE world_books)
  ensureColumn(database, 'world_books', 'scan_depth', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'world_books', 'lorebook_context_percent', 'INTEGER NOT NULL DEFAULT 25');
  ensureColumn(database, 'world_book_entries', 'regex_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'always_active', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'depth', 'INTEGER NOT NULL DEFAULT 0');

  // Selective filter for world book entries
  ensureColumn(database, 'world_book_entries', 'selective', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'selective_logic', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'keys_secondary', "TEXT NOT NULL DEFAULT ''");

  // Probability-based activation for world book entries
  ensureColumn(database, 'world_book_entries', 'probability', 'INTEGER NOT NULL DEFAULT 100');
  ensureColumn(database, 'world_book_entries', 'use_probability', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'inclusion_group', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'world_book_entries', 'group_weight', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'world_book_entries', 'role', 'INTEGER NOT NULL DEFAULT 0');

  // Sticky / Cooldown / Delay for world book entries
  ensureColumn(database, 'world_book_entries', 'sticky', 'INTEGER');
  ensureColumn(database, 'world_book_entries', 'cooldown', 'INTEGER');
  ensureColumn(database, 'world_book_entries', 'delay', 'INTEGER');

  database.exec(`
    CREATE TABLE IF NOT EXISTS world_book_entry_state (
      entry_id TEXT PRIMARY KEY,
      last_activated_message INTEGER DEFAULT 0,
      last_deactivated_message INTEGER DEFAULT 0,
      first_seen_message INTEGER DEFAULT 0,
      sticky_remaining INTEGER DEFAULT 0,
      was_active INTEGER DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES world_book_entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS character_tags (
      character_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      PRIMARY KEY (character_id, tag_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_tags_character ON character_tags(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_tags_tag ON character_tags(tag_id);

    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      snapshot TEXT NOT NULL DEFAULT '{}',
      preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_saves_conversation ON saves(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id);

    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '未命名预设',
      system_prompt TEXT NOT NULL DEFAULT '',
      temperature REAL NOT NULL DEFAULT 1.0,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      top_p REAL NOT NULL DEFAULT 1.0,
      frequency_penalty REAL NOT NULL DEFAULT 0,
      presence_penalty REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_presets_user ON presets(user_id);

    CREATE TABLE IF NOT EXISTS status_bars (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '状态栏',
      variables TEXT NOT NULL DEFAULT '[]',
      template TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_status_bars_conversation ON status_bars(conversation_id);

    CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'prompt_inject',
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      scope TEXT NOT NULL DEFAULT 'global',
      character_ids TEXT NOT NULL DEFAULT '[]',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mods_user ON mods(user_id);

    CREATE TABLE IF NOT EXISTS npc_memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'event',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_npc_memories_conversation ON npc_memories(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_memories_npc ON npc_memories(conversation_id, npc_name);

    CREATE TABLE IF NOT EXISTS npc_behaviors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      behavior_type TEXT NOT NULL DEFAULT 'reaction',
      trigger_condition TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_conversation ON npc_behaviors(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_behaviors_npc ON npc_behaviors(conversation_id, npc_name);

    CREATE TABLE IF NOT EXISTS npc_registry (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, npc_name)
    );
    CREATE INDEX IF NOT EXISTS idx_npc_registry_conversation ON npc_registry(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_npc_registry_hidden ON npc_registry(conversation_id, hidden);

    CREATE TABLE IF NOT EXISTS economy_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      currency_type TEXT NOT NULL DEFAULT 'gold',
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, currency_type)
    );
    CREATE INDEX IF NOT EXISTS idx_economy_accounts_conversation ON economy_accounts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_economy_accounts_user ON economy_accounts(user_id);

    CREATE TABLE IF NOT EXISTS economy_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      related_npc TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES economy_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_economy_transactions_account ON economy_transactions(account_id);

    CREATE TABLE IF NOT EXISTS character_images (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      scene_tag TEXT NOT NULL DEFAULT '',
      emotion_tag TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_images_character ON character_images(character_id);

    CREATE TABLE IF NOT EXISTS talent_pools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      talents_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_talent_pools_name ON talent_pools(name);

    CREATE TABLE IF NOT EXISTS character_talents (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      talent_name TEXT NOT NULL,
      talent_rarity TEXT NOT NULL DEFAULT 'common',
      talent_description TEXT NOT NULL DEFAULT '',
      talent_effect TEXT NOT NULL DEFAULT '',
      pool_id TEXT,
      rolled_at TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (pool_id) REFERENCES talent_pools(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_character_talents_character ON character_talents(character_id);
    CREATE INDEX IF NOT EXISTS idx_character_talents_pool ON character_talents(pool_id);
  `);
  ensureColumn(database, 'npc_registry', 'status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(database, 'npc_registry', 'custom_status', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, 'npc_registry', 'aliases', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, 'npc_registry', 'memory_sealed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'mods', 'scope', "TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(database, 'mods', 'character_ids', "TEXT NOT NULL DEFAULT '[]'");

  migrateTagsToUserScoped(database);
}

export const db = createAppDatabase(process.env.FLAI_DB_PATH || path.join(dataDir, 'flai.sqlite'));

function migrateTagsToUserScoped(database) {
  const columns = getCachedTableColumns(database, 'tags');
  if (columns.has('user_id')) {
    normalizeUnsafeTagIds(database);
    database.exec('CREATE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name)');
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
      CREATE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name);
      CREATE INDEX IF NOT EXISTS idx_character_tags_character ON character_tags(character_id);
      CREATE INDEX IF NOT EXISTS idx_character_tags_tag ON character_tags(tag_id);
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

function ensureColumn(database, tableName, columnName, definition) {
  const rawName = columnName.replace(/[`"]/g, '');
  const columnNames = getCachedTableColumns(database, tableName);
  if (columnNames.has(rawName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  // Invalidate cache so subsequent checks on the same table see the new column
  _tableColumnCache.delete(tableName);
}
