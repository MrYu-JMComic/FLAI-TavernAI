import { readdirSync } from 'node:fs';
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

const result = spawnSync(process.execPath, args, {
  cwd: backendRoot,
  stdio: 'inherit'
});
process.exitCode = result.status ?? 1;

function isContractTest(name) {
  return name.startsWith('frontend')
    || name === 'pixelIcons.test.js'
    || name === 'source-hygiene.test.js'
    || name === 'test-hygiene.test.js'
    || name === 'validation-scripts.test.js';
}
