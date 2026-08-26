export function migrateOperationalControls(database) {
  database.exec('SAVEPOINT migration_0008_operational_controls');
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_quotas (
        user_id TEXT PRIMARY KEY,
        max_concurrent_ai_jobs INTEGER NOT NULL DEFAULT 2,
        max_upload_bytes INTEGER NOT NULL DEFAULT 104857600,
        max_daily_requests INTEGER NOT NULL DEFAULT 10000,
        max_daily_cost_micros INTEGER NOT NULL DEFAULT 5000000,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS user_daily_usage (
        user_id TEXT NOT NULL,
        usage_date TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_micros INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, usage_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS provider_route_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        job_id TEXT NOT NULL DEFAULT '',
        task_type TEXT NOT NULL,
        route_role TEXT NOT NULL CHECK (route_role IN ('primary', 'fallback')),
        provider_type TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_micros INTEGER NOT NULL DEFAULT 0,
        duration_ms REAL NOT NULL DEFAULT 0,
        error_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS automation_audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        operation TEXT NOT NULL,
        subject_type TEXT NOT NULL DEFAULT '',
        subject_id TEXT NOT NULL DEFAULT '',
        source_message_id TEXT NOT NULL DEFAULT '',
        job_id TEXT NOT NULL DEFAULT '',
        provider_type TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        plan_summary TEXT NOT NULL DEFAULT '',
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        rollback_of_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS import_audit_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        envelope_kind TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1)),
        conflict_strategy TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        report_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_daily_usage_date_cost
        ON user_daily_usage(usage_date, cost_micros DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_routes_user_created
        ON provider_route_events(user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_routes_job
        ON provider_route_events(job_id, id);
      CREATE INDEX IF NOT EXISTS idx_automation_audit_user_created
        ON automation_audit_events(user_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_automation_audit_subject
        ON automation_audit_events(user_id, domain, subject_type, subject_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_import_reports_user_created
        ON import_audit_reports(user_id, created_at DESC, id DESC);
    `);
    database.exec('RELEASE SAVEPOINT migration_0008_operational_controls');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0008_operational_controls');
    database.exec('RELEASE SAVEPOINT migration_0008_operational_controls');
    throw error;
  }
}
