/** Scope talent pools to their creator while preserving legacy pools as
 * read-only system data.  Historical rows cannot be assigned safely to a
 * user, so their nullable user_id remains NULL and owner_type stays system.
 */
export function migrateTalentPoolOwnership(database) {
  database.exec('SAVEPOINT migration_0010_talent_pool_ownership');
  try {
    const columns = new Set(
      database.prepare('PRAGMA table_info(talent_pools)').all().map((row) => row.name)
    );
    if (!columns.has('user_id')) {
      database.exec('ALTER TABLE talent_pools ADD COLUMN user_id TEXT');
    }
    if (!columns.has('owner_type')) {
      database.exec("ALTER TABLE talent_pools ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'system'");
    }
    if (!columns.has('read_only')) {
      database.exec('ALTER TABLE talent_pools ADD COLUMN read_only INTEGER NOT NULL DEFAULT 1');
    }
    database.exec(`
      UPDATE talent_pools
      SET owner_type = CASE WHEN user_id IS NULL THEN 'system' ELSE 'user' END,
          read_only = CASE WHEN user_id IS NULL THEN 1 ELSE 0 END
      WHERE owner_type IS NULL OR owner_type = '' OR read_only IS NULL;
      CREATE INDEX IF NOT EXISTS idx_talent_pools_user_created
        ON talent_pools(user_id, created_at DESC, id);
      CREATE TRIGGER IF NOT EXISTS trg_talent_pools_user_delete
        AFTER DELETE ON users
        WHEN OLD.id IS NOT NULL
        BEGIN
          DELETE FROM talent_pools WHERE user_id = OLD.id;
        END;
    `);
    const quotaColumns = new Set(
      database.prepare('PRAGMA table_info(user_quotas)').all().map((row) => row.name)
    );
    if (!quotaColumns.has('max_structured_storage_bytes')) {
      database.exec(
        'ALTER TABLE user_quotas ADD COLUMN max_structured_storage_bytes INTEGER NOT NULL DEFAULT 268435456'
      );
    }
    database.exec('RELEASE SAVEPOINT migration_0010_talent_pool_ownership');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0010_talent_pool_ownership');
    database.exec('RELEASE SAVEPOINT migration_0010_talent_pool_ownership');
    throw error;
  }
}
