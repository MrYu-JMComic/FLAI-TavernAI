import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(backendRoot, 'src', 'tests');
const mode = String(process.argv[2] || 'all');
const coverage = process.argv.includes('--coverage');

if (!['all', 'backend', 'contracts'].includes(mode)) {
  throw new Error(`Unknown test mode: ${mode}`);
}

const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .filter((name) => mode === 'all' || (mode === 'contracts') === isContractTest(name))
  .sort()
  .map((name) => path.join('src', 'tests', name));

const args = ['--test'];
if (coverage) {
  args.push('--experimental-test-coverage');
}
args.push(...testFiles);

// `src/db.js` opens a database at module load, and `services/backup.js` resolves
// its storage root the same way; both fall back to backend/data/flai.sqlite when
// FLAI_DB_PATH is unset. Any test that imports either module therefore migrates
// the real user database as an import side effect.
//
// Setting the variable in the child's environment beats that regardless of how a
// test imports: the value is present before the child process starts, so
// config.js reads it during its own module load. Doing it inside a test file
// cannot work, because static imports are hoisted above the assignment.
const throwawayRoot = process.env.FLAI_DB_PATH ? '' : mkdtempSync(path.join(os.tmpdir(), 'flai-test-db-'));
const testEnvironment = throwawayRoot
  ? { ...process.env, FLAI_DB_PATH: path.join(throwawayRoot, 'flai.sqlite') }
  : process.env;

try {
  const result = spawnSync(process.execPath, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    env: testEnvironment
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (throwawayRoot) {
    rmSync(throwawayRoot, { recursive: true, force: true });
  }
}

function isContractTest(name) {
  return name.startsWith('frontend')
    || name === 'pixelIcons.test.js'
    || name === 'source-hygiene.test.js'
    || name === 'test-hygiene.test.js'
    || name === 'validation-scripts.test.js';
}
