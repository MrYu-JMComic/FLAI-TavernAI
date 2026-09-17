export function migrateConversationMemoryReview(database) {
  const ensure = (column, definition) => {
    const columns = database.prepare('PRAGMA table_info(conversation_memories)').all();
    if (!columns.some((entry) => entry.name === column)) {
      database.exec(`ALTER TABLE conversation_memories ADD COLUMN ${column} ${definition}`);
    }
  };

  ensure('pinned', 'INTEGER NOT NULL DEFAULT 0');
  ensure('revision', 'INTEGER NOT NULL DEFAULT 1');
  ensure('invalidated_at', 'TEXT');
  ensure('merged_into_id', 'TEXT');

  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_memory_review_operations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE TABLE IF NOT EXISTS conversation_memory_review_members (
      operation_id TEXT NOT NULL REFERENCES conversation_memory_review_operations(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES conversation_memories(id) ON DELETE CASCADE,
      before_json TEXT NOT NULL,
      after_revision INTEGER NOT NULL,
      PRIMARY KEY (operation_id, memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_memories_review
      ON conversation_memories(user_id, conversation_id, pinned DESC, enabled DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_memory_review_operations
      ON conversation_memory_review_operations(user_id, conversation_id, created_at DESC);
  `);
}
