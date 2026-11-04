/** Derived vector metadata is portable SQLite; native tables are provisioned lazily. */
export function migrateMemoryEmbeddings(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_embedding_indexes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions IN (256,512,768,1024)),
      source_revision INTEGER NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('building','active','superseded','failed','stale')),
      document_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_embedding_active
      ON memory_embedding_indexes(conversation_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_scope
      ON memory_embedding_indexes(user_id,conversation_id,fingerprint,status);
    CREATE TABLE IF NOT EXISTS memory_embedding_documents (
      id TEXT PRIMARY KEY,
      index_id TEXT NOT NULL REFERENCES memory_embedding_indexes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      dimensions INTEGER NOT NULL CHECK(dimensions IN (256,512,768,1024)),
      text_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(index_id,source_kind,source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_document_source
      ON memory_embedding_documents(user_id,conversation_id,source_kind,source_id);
    CREATE TABLE IF NOT EXISTS memory_embedding_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('ingest','query','rebuild')),
      model TEXT NOT NULL,
      region TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      cost_cny REAL,
      currency TEXT NOT NULL DEFAULT 'CNY',
      price_version TEXT NOT NULL,
      quota_usd_per_cny REAL,
      quota_cost_micros INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_embedding_usage_scope
      ON memory_embedding_usage(user_id,conversation_id,created_at);
  `);
}
