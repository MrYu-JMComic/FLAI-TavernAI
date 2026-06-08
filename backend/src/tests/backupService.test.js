import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { getBackupFileNamesNewestFirst } = await import('../services/backup.js');
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
