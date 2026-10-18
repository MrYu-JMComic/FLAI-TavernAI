// Guards the test suite against migrating the user's real database.
//
// `src/db.js` opens a database at module load and `services/backup.js` resolves
// its storage root the same way; both fall back to backend/data/flai.sqlite when
// FLAI_DB_PATH is unset. A test that imports either module therefore runs
// applyStartupMigrations against real user data — which happened on 2026-09-30,
// with no same-day backup. AGENTS.md also forbids writing to backend/data.
//
// Two complementary guards, both asserted here:
//   1. the runner exports FLAI_DB_PATH into the child process (durable: it beats
//      import hoisting and covers test files nobody has written yet);
//   2. no test statically imports `../db.js`, whose module body opens the
//      singleton (a static import is hoisted above any env assignment in the
//      test body, so per-file opt-in cannot work).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = fileURLToPath(new URL('./', import.meta.url));
const runnerSource = readFileSync(new URL('../../scripts/run-tests.mjs', import.meta.url), 'utf8');

test('the test runner points every child process at a throwaway database', () => {
  // The child must be spawned with an explicit env, not an inherited one.
  assert.match(runnerSource, /FLAI_DB_PATH/);
  assert.match(runnerSource, /env: testEnvironment/);
  assert.match(runnerSource, /mkdtempSync/);
  // A caller that set FLAI_DB_PATH deliberately keeps it.
  assert.match(runnerSource, /process\.env\.FLAI_DB_PATH \?/);
});

test('no test statically imports the module that opens the real database', () => {
  const staticDbImport = /^\s*import\s[^;]*from\s+'\.\.\/db\.js'/m;
  const violations = [];

  for (const name of readdirSync(testDir)) {
    if (!name.endsWith('.test.js') && !name.endsWith('.js')) continue;
    const source = readFileSync(path.join(testDir, name), 'utf8');
    if (staticDbImport.test(source)) violations.push(name);
  }

  assert.deepEqual(
    violations,
    [],
    'Import createAppDatabase from ../db/runtime.js instead: ../db.js opens backend/data/flai.sqlite at module load.'
  );
});
