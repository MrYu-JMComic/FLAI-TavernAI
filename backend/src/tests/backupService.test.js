import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { latestSchemaVersion } from '../db/migrations.js';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';

const {
  createBackup,
  getBackupFileNamesNewestFirst,
  listBackups,
  preflightBackupRestore,
  restoreBackupOffline,
  resolveBackupStorage
} = await import('../services/backup.js');
const { createAppDatabase } = await import('../db/runtime.js');
const backupServiceSource = readFileSync(new URL('../services/backup.js', import.meta.url), 'utf8');

test('backup service filters and sorts backup database file names newest first', () => {
  const fileNames = [
    'flai-2026-06-06.sqlite',
    'flai-2026-06-08.sqlite',
    'flai-2026-06-08.sqlite-wal',
    'notes.txt',
    'flai-2026-06-07.sqlite',
    'flai-2026-06-05.sqlite-shm',
    'other-2026-06-09.sqlite'
  ];
  const originalFileNames = [...fileNames];

  assert.deepEqual(getBackupFileNamesNewestFirst(fileNames), [
    'flai-2026-06-08.sqlite',
    'flai-2026-06-07.sqlite',
    'flai-2026-06-06.sqlite'
  ]);
  assert.deepEqual(fileNames, originalFileNames);
  assert.match(backupServiceSource, /backupFileNames\.sort\(compareBackupFileNameNewestFirst\);/);
  assert.doesNotMatch(backupServiceSource, /\.sort\(\)\s*\.reverse\(\)/);
});

test('backup storage follows the active database path', () => {
  const sourcePath = path.join(os.tmpdir(), 'flai-e2e', 'e2e.sqlite');

  assert.deepEqual(resolveBackupStorage(sourcePath), {
    sourcePath: path.resolve(sourcePath),
    backupDir: path.join(path.dirname(path.resolve(sourcePath)), 'backups')
  });
});

test('in-memory databases never create or list backups', () => {
  assert.deepEqual(resolveBackupStorage(':memory:'), { sourcePath: '', backupDir: '' });
  assert.equal(createBackup(), null);
  assert.deepEqual(listBackups(), []);
});

test('startup backup captures the database before migration and records integrity metadata', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'flai-startup-backup-'));
  const databasePath = path.join(temporaryRoot, 'legacy.sqlite');
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec('CREATE TABLE legacy_marker (value TEXT); INSERT INTO legacy_marker VALUES (\'before-migration\')');
  legacyDatabase.close();

  let metadata;
  const database = createAppDatabase(databasePath, {
    beforeInitialize(activeDatabase) {
      metadata = createBackup({
        database: activeDatabase,
        databasePath,
        label: 'startup-test',
        withMetadata: true
      });
    }
  });
  try {
    assert.equal(metadata.integrity, 'ok');
    assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
    assert.ok(metadata.size > 0);
    const backup = new DatabaseSync(metadata.path, { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'schema_migrations'").get().count, 0);
      assert.equal(backup.prepare('SELECT value FROM legacy_marker').get().value, 'before-migration');
    } finally {
      backup.close();
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 10);
  } finally {
    database.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('restore preflight verifies metadata and offline restore preserves a rollback copy', () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'flai-offline-restore-'));
  const databasePath = path.join(temporaryRoot, 'flai.sqlite');
  const database = createAppDatabase(databasePath);
  database.exec("CREATE TABLE restore_marker (value TEXT); INSERT INTO restore_marker VALUES ('backup-value')");
  const backup = createBackup({
    database,
    databasePath,
    label: 'restore-source',
    withMetadata: true
  });
  database.prepare('UPDATE restore_marker SET value = ?').run('pre-restore-value');
  database.close();

  try {
    const preflight = preflightBackupRestore({ databasePath, filename: backup.filename });
    assert.equal(preflight.canRestore, true);
    assert.equal(preflight.integrity, 'ok');
    assert.equal(preflight.hashMatches, true);
    assert.equal(preflight.schemaVersion, latestSchemaVersion);
    assert.throws(
      () => preflightBackupRestore({ databasePath, filename: '../flai.sqlite' }),
      (error) => error.code === 'BACKUP_FILENAME_INVALID'
    );
    assert.throws(
      () => restoreBackupOffline({ databasePath, filename: backup.filename }),
      (error) => error.code === 'BACKUP_OFFLINE_CONFIRMATION_REQUIRED'
    );

    const restored = restoreBackupOffline({
      databasePath,
      filename: backup.filename,
      confirmOffline: true
    });
    assert.equal(restored.ok, true);
    assert.match(restored.preRestoreBackup, /pre-restore\.sqlite$/);
    const restoredDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.equal(restoredDatabase.prepare('SELECT value FROM restore_marker').get().value, 'backup-value');
    } finally {
      restoredDatabase.close();
    }
    const rollbackDatabase = new DatabaseSync(
      path.join(temporaryRoot, 'backups', restored.preRestoreBackup),
      { readOnly: true }
    );
    try {
      assert.equal(rollbackDatabase.prepare('SELECT value FROM restore_marker').get().value, 'pre-restore-value');
    } finally {
      rollbackDatabase.close();
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
