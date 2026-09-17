export function migrateConversationTimeline(database) {
  const ensure = (table, column, definition) => {
    if (!database.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensure('conversations', 'timeline_revision', 'INTEGER NOT NULL DEFAULT 1');
  ensure('conversations', 'state_status', "TEXT NOT NULL DEFAULT 'legacy'");
  ensure('conversations', 'active_generation_id', "TEXT NOT NULL DEFAULT ''");
  ensure('conversations', 'generation_expires_at', 'INTEGER');
  ensure('messages', 'revision', 'INTEGER NOT NULL DEFAULT 1');
  ensure('messages', 'postprocess_state', "TEXT NOT NULL DEFAULT 'untracked'");
  ensure('jobs', 'serial_key', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_checkpoints (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      anchor_message_id TEXT NOT NULL DEFAULT '',
      anchor_revision INTEGER NOT NULL DEFAULT 0,
      history_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_anchor
      ON conversation_checkpoints(conversation_id, anchor_message_id, created_at);
    CREATE TABLE IF NOT EXISTS job_steps (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      status TEXT NOT NULL,
      before_json TEXT NOT NULL,
      result_json TEXT,
      attempt INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(job_id, step_key)
    );
    CREATE TABLE IF NOT EXISTS ai_tool_executions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      step_key TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL DEFAULT 1,
      tool_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      effect TEXT NOT NULL,
      idempotency TEXT NOT NULL,
      status TEXT NOT NULL,
      arguments_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_job ON ai_tool_executions(job_id, step_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_serial ON jobs(user_id, serial_key, status, created_at);
    CREATE TRIGGER IF NOT EXISTS conversation_message_revision
    AFTER UPDATE OF content, attachments_json, role ON messages
    WHEN OLD.content IS NOT NEW.content OR OLD.attachments_json IS NOT NEW.attachments_json OR OLD.role IS NOT NEW.role
    BEGIN
      UPDATE messages SET revision = OLD.revision + 1, postprocess_state = 'stale' WHERE id = NEW.id;
      UPDATE conversations SET timeline_revision = timeline_revision + 1, state_status = 'stale'
        WHERE id = NEW.conversation_id;
    END;
    CREATE TRIGGER IF NOT EXISTS conversation_message_deleted
    AFTER DELETE ON messages
    BEGIN
      UPDATE conversations SET timeline_revision = timeline_revision + 1, state_status = 'stale'
        WHERE id = OLD.conversation_id;
    END;
  `);
}
