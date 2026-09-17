export function migrateConversationWorldBookState(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_world_book_clock (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0)
    );
    CREATE TABLE IF NOT EXISTS conversation_world_book_state (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES world_book_entries(id) ON DELETE CASCADE,
      last_activated_message INTEGER NOT NULL DEFAULT 0,
      last_deactivated_message INTEGER NOT NULL DEFAULT 0,
      first_seen_message INTEGER NOT NULL DEFAULT 0,
      sticky_remaining INTEGER NOT NULL DEFAULT 0,
      was_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (conversation_id, entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_world_book_entry
      ON conversation_world_book_state(entry_id);
  `);
}
