export function migratePromptTrace(database) {
  const columns = database.prepare('PRAGMA table_info(conversations)').all();
  if (!columns.some((column) => column.name === 'context_budget_json')) {
    database.exec("ALTER TABLE conversations ADD COLUMN context_budget_json TEXT NOT NULL DEFAULT '{}'");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS prompt_traces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      generation_id TEXT NOT NULL,
      timeline_revision INTEGER NOT NULL,
      operation TEXT NOT NULL,
      source_message_id TEXT NOT NULL DEFAULT '',
      source_message_revision INTEGER NOT NULL DEFAULT 0,
      assistant_message_id TEXT NOT NULL DEFAULT '',
      provider_type TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      logical_messages_json TEXT NOT NULL,
      selection_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      usage_json TEXT,
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_traces_conversation
      ON prompt_traces(user_id, conversation_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS prompt_requests (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL REFERENCES prompt_traces(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      redirect_hop INTEGER NOT NULL,
      auth_mode TEXT NOT NULL,
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      host TEXT NOT NULL,
      body_json TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      redactions_json TEXT NOT NULL,
      token_estimate_json TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      finished_at TEXT,
      UNIQUE(trace_id, ordinal)
    );
  `);
}
