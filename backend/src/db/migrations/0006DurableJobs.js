export function migrateDurableJobs(database) {
  database.exec('SAVEPOINT migration_0006_durable_jobs');
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        payload_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        idempotency_key TEXT NOT NULL DEFAULT '',
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        lease_owner TEXT NOT NULL DEFAULT '',
        lease_expires_at INTEGER,
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_type_idempotency
        ON jobs(user_id, type, idempotency_key) WHERE idempotency_key <> '';
      CREATE INDEX IF NOT EXISTS idx_jobs_claim
        ON jobs(status, cancel_requested, created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_user_created
        ON jobs(user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_job_events_job_cursor
        ON job_events(job_id, id);
    `);
    ensureTownIdempotencyColumn(database);
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_town_worlds_user_idempotency
        ON town_worlds(user_id, idempotency_key) WHERE idempotency_key <> '';
    `);
    database.exec('RELEASE SAVEPOINT migration_0006_durable_jobs');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0006_durable_jobs');
    database.exec('RELEASE SAVEPOINT migration_0006_durable_jobs');
    throw error;
  }
}

function ensureTownIdempotencyColumn(database) {
  const columns = database.prepare('PRAGMA table_info(town_worlds)').all();
  if (!columns.some((column) => column.name === 'idempotency_key')) {
    database.exec("ALTER TABLE town_worlds ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT ''");
  }
}
