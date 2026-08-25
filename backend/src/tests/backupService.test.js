import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';

const {
  createBackup,
  getBackupFileNamesNewestFirst,
  listBackups,
  resolveBackupStorage
} = await import('../services/backup.js');
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
