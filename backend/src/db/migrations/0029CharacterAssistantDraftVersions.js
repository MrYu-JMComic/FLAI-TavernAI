export function migrateCharacterAssistantDraftVersions(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS character_assistant_draft_versions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      character_json TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES character_assistant_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_character_assistant_draft_versions_session
      ON character_assistant_draft_versions(session_id, user_id, created_at DESC);
  `);
}
