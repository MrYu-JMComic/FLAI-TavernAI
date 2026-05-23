import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(sourceDir, '..');
export const dataDir = path.join(backendRoot, 'data');
export const uploadsDir = path.join(backendRoot, 'uploads');
export const avatarUploadDir = path.join(uploadsDir, 'avatars');

export function ensureStorageDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}

export function createAppDatabase(filename = path.join(dataDir, 'flai.sqlite')) {
  ensureStorageDirs();
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys = ON');
  initializeDatabase(database);
  return database;
}

export function initializeDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
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
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      title TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
    CREATE INDEX IF NOT EXISTS idx_regex_character ON regex_rules(character_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `);
  ensureColumn(database, 'characters', 'visibility', "TEXT NOT NULL DEFAULT 'private'");
  database.exec("UPDATE characters SET visibility = 'private' WHERE visibility IS NULL OR visibility = ''");
  database.exec('CREATE INDEX IF NOT EXISTS idx_characters_visibility ON characters(visibility)');
}

export const db = createAppDatabase(process.env.FLAI_DB_PATH || path.join(dataDir, 'flai.sqlite'));

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
