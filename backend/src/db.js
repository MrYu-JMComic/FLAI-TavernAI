import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, '..');
export const dataDir = path.join(backendRoot, 'data');
const uploadsDir = path.join(backendRoot, 'uploads');
export const avatarUploadDir = path.join(uploadsDir, 'avatars');

export function ensureStorageDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}

export function createAppDatabase(filename = path.join(dataDir, 'flai.sqlite')) {
  ensureStorageDirs();
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
      character_id TEXT NOT NULL,
      label TEXT NOT NULL,
      pattern TEXT NOT NULL,
      replacement TEXT NOT NULL DEFAULT '',
      flags TEXT NOT NULL DEFAULT 'g',
      scope TEXT NOT NULL DEFAULT 'input',
      enabled INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      group_name TEXT NOT NULL DEFAULT '全局',
      priority INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
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

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
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
}

export const db = createAppDatabase(process.env.FLAI_DB_PATH || path.join(dataDir, 'flai.sqlite'));

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
