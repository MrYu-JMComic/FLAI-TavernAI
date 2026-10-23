export function migrateCharacterAssistantSessions(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS character_assistant_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      character_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      character_json TEXT NOT NULL DEFAULT '{}',
      messages_json TEXT NOT NULL DEFAULT '[]',
      state_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_assistant_sessions_user_character
      ON character_assistant_sessions(user_id, character_id, updated_at DESC);
  `);
}
