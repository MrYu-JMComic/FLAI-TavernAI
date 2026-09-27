import fs from 'node:fs';
import path from 'node:path';

export default async function globalTeardown(config) {
  const databasePath = process.env.FLAI_E2E_DATABASE_PATH || config?.metadata?.e2eDatabasePath;
  if (!databasePath) {
    return;
  }
  const runtimeDir = path.resolve(path.dirname(databasePath));
  const resolved = path.resolve(databasePath);
  const relative = path.relative(runtimeDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove an E2E database outside .runtime-check');
  }
  for (const suffix of ['', '-wal', '-shm']) {
    await removeWithRetry(`${resolved}${suffix}`);
  }

  // Remove stale randomized databases left by interrupted local runs. The
  // prefix and resolved parent keep this cleanup strictly inside the runtime
  // artifact directory.
  try {
    for (const name of fs.readdirSync(runtimeDir)) {
      if (!/^e2e-[A-Za-z0-9_-]+\.sqlite(?:-(?:wal|shm))?$/.test(name)) {
        continue;
      }
      await removeWithRetry(path.join(runtimeDir, name));
    }
  } catch (cleanupError) {
    // Best effort; a future run still uses a fresh path.
    void cleanupError;
  }
}

async function removeWithRetry(target) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.promises.rm(target, { force: true });
      return;
    } catch (error) {
      if (attempt === 11) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      void error;
    }
  }
}
