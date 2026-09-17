export function migrateConversationRetention(database) {
  const columns = database.prepare('PRAGMA table_info(saves)').all();
  if (!columns.some((column) => column.name === 'kind')) {
    database.exec("ALTER TABLE saves ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'");
  }
  // Automatic recovery points were previously only distinguishable by their fixed labels.
  database.prepare("UPDATE saves SET kind = 'recovery' WHERE kind = 'manual' AND name = ? AND preview = ?")
    .run('历史修改前的恢复点', '自动恢复点');
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_saves_conversation_kind
      ON saves(conversation_id, kind, created_at DESC);
  `);
}
