import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';

const { createBackup, getBackupFileNamesNewestFirst } = await import('../services/backup.js');
const { createAppDatabase, performDatabaseMaintenance } = await import('../db/runtime.js');
const { runBackupRestoreDrill } = await import('../services/backupRestoreDrill.js');
const { latestSchemaVersion } = await import('../db/migrations.js');
const { getCachedTableColumns } = await import('../db/schema.js');

function withTemporaryDatabase(prefix, callback) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(temporaryRoot, 'flai.sqlite');
  const database = createAppDatabase(databasePath);
  try {
    return callback({ database, databasePath, temporaryRoot });
  } finally {
    try {
      database.close();
    } catch {
      // Some cases close the database themselves before asserting.
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

test('restore drill migrates a backup copy and reports the schema it reached', () => {
  withTemporaryDatabase('flai-drill-ok-', ({ database, databasePath }) => {
    const backup = createBackup({ database, databasePath, label: 'drill', withMetadata: true });
    assert.ok(backup.filename);

    const result = runBackupRestoreDrill({ databasePath });
    assert.equal(result.ok, true);
    assert.equal(result.backup, backup.filename);
    assert.equal(result.migratedTo, latestSchemaVersion);
    assert.equal(result.sha256, backup.sha256);
    assert.ok(result.migrationsApplied > 0);
  });
});

test('restore drill leaves the live column cache untouched', () => {
  withTemporaryDatabase('flai-drill-cache-', ({ database, databasePath }) => {
    createBackup({ database, databasePath, label: 'drill-cache' });
    // Warm the process-wide cache the running server relies on.
    const before = getCachedTableColumns(database, 'users');
    assert.ok(before.has('username'));

    runBackupRestoreDrill({ databasePath });

    const after = getCachedTableColumns(database, 'users');
    assert.equal(after, before, 'drill must not reset the shared column cache');
  });
});

test('restore drill refuses in-memory databases and empty backup directories', () => {
  assert.throws(() => runBackupRestoreDrill({ databasePath: ':memory:' }), (error) => error.code === 'DRILL_DATABASE_REQUIRED');
  assert.throws(() => runBackupRestoreDrill({ databasePath: '' }), (error) => error.code === 'DRILL_DATABASE_REQUIRED');

  withTemporaryDatabase('flai-drill-empty-', ({ databasePath }) => {
    assert.throws(() => runBackupRestoreDrill({ databasePath }), (error) => error.code === 'DRILL_NO_BACKUPS');
  });
});

test('restore drill reports a corrupted backup instead of succeeding', () => {
  withTemporaryDatabase('flai-drill-corrupt-', ({ database, databasePath, temporaryRoot }) => {
    const backup = createBackup({ database, databasePath, label: 'drill-corrupt', withMetadata: true });
    writeFileSync(path.join(temporaryRoot, 'backups', backup.filename), 'not a database');

    assert.throws(
      () => runBackupRestoreDrill({ databasePath }),
      (error) => error.code === 'DRILL_PREFLIGHT_FAILED' || error.code === 'DRILL_INTEGRITY_FAILED'
    );
  });
});

function listBackupFileNames(backupDir) {
  return getBackupFileNamesNewestFirst(readdirSync(backupDir));
}

test('backup retention enforces both the count limit and the age limit', () => {
  withTemporaryDatabase('flai-retention-', ({ database, databasePath, temporaryRoot }) => {
    const backupDir = path.join(temporaryRoot, 'backups');
    // Seed real backup files, then age one of them past the day limit.
    for (const label of ['a', 'b', 'c']) {
      createBackup({ database, databasePath, label, retention: { maxCount: 99, maxAgeDays: 3650 } });
    }
    const seeded = listBackupFileNames(backupDir);
    assert.ok(seeded.length >= 2, `expected seeded backups, got ${seeded.join(', ')}`);
    const stalePath = path.join(backupDir, seeded.at(-1));
    const staleSeconds = Date.now() / 1000 - 40 * 24 * 60 * 60;
    utimesSync(stalePath, staleSeconds, staleSeconds);

    createBackup({ database, databasePath, label: 'retention', retention: { maxCount: 2, maxAgeDays: 30 } });

    const remaining = listBackupFileNames(backupDir);
    assert.ok(remaining.length <= 2, `expected at most 2 backups, got ${remaining.join(', ')}`);
    assert.ok(!remaining.includes(path.basename(stalePath)), 'age-expired backup should be pruned');
  });
});

test('backup retention never deletes the only remaining backup', () => {
  withTemporaryDatabase('flai-retention-last-', ({ database, databasePath, temporaryRoot }) => {
    const backupDir = path.join(temporaryRoot, 'backups');
    const retention = { maxCount: 1, maxAgeDays: 1 };
    const backup = createBackup({ database, databasePath, label: 'retention-last', withMetadata: true, retention });
    const staleSeconds = Date.now() / 1000 - 400 * 24 * 60 * 60;
    utimesSync(path.join(backupDir, backup.filename), staleSeconds, staleSeconds);

    // Pruning runs again on the next backup; even with every file past the age
    // limit the newest one has to survive.
    createBackup({ database, databasePath, label: 'retention-last-2', retention });

    assert.ok(listBackupFileNames(backupDir).length >= 1, 'retention must leave at least one backup');
  });
});

test('database maintenance truncates the WAL and reports the checkpoint', () => {
  withTemporaryDatabase('flai-maintenance-', ({ database }) => {
    database.exec("CREATE TABLE maintenance_marker (value TEXT); INSERT INTO maintenance_marker VALUES ('x')");

    const result = performDatabaseMaintenance(database);
    assert.equal(typeof result.checkpointed, 'number');
    assert.equal(typeof result.walFrames, 'number');

    const skipped = performDatabaseMaintenance(database, { checkpoint: false });
    assert.equal(skipped.checkpointed, null);
    assert.equal(skipped.walFrames, null);
    // The database is still usable after both maintenance modes.
    assert.equal(database.prepare('SELECT value FROM maintenance_marker').get().value, 'x');
  });
});
