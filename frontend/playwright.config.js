import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendDir, '..');
const backendDir = path.join(repoRoot, 'backend');
const runtimeDir = path.join(repoRoot, '.runtime-check');

fs.mkdirSync(runtimeDir, { recursive: true });
cleanupStaleE2eDatabases(runtimeDir);

const backendPort = Number(process.env.FLAI_E2E_BACKEND_PORT || 3211);
const frontendPort = Number(process.env.FLAI_E2E_FRONTEND_PORT || 5174);
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const runId = String(process.env.FLAI_E2E_RUN_ID || `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  .replace(/[^a-zA-Z0-9_-]/g, '-');
const e2eDatabasePath = path.join(runtimeDir, `e2e-${runId}.sqlite`);
process.env.FLAI_E2E_DATABASE_PATH = e2eDatabasePath;

export default defineConfig({
  globalTeardown: './e2e/global-teardown.js',
  metadata: { e2eDatabasePath },
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 12_000
  },
  outputDir: path.join(runtimeDir, 'playwright-results'),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: path.join(runtimeDir, 'playwright-report') }]]
    : 'list',
  use: {
    baseURL: frontendBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm run start',
      cwd: backendDir,
      url: `${backendBaseUrl}/api/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        APP_SECRET: 'flai-e2e-secret',
        AUTH_RATE_LIMIT_MAX: '10000',
        API_RATE_LIMIT_MAX: '10000',
        AUTHENTICATED_API_RATE_LIMIT_MAX: '10000',
        CLIENT_ORIGIN: frontendBaseUrl,
        // Each Playwright run gets a fresh isolated process-local database;
        // using SQLite memory storage avoids Windows file locks during server
        // teardown while retaining the run-specific metadata/path above.
        FLAI_DB_PATH: ':memory:',
        FLAI_ENABLE_MOCK_PROVIDER: 'true',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        PORT: String(backendPort)
      }
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      cwd: frontendDir,
      url: frontendBaseUrl,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VITE_API_PROXY_TARGET: backendBaseUrl
      }
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
});

function cleanupStaleE2eDatabases(directory) {
  for (const name of fs.readdirSync(directory)) {
    if (!/^e2e-[A-Za-z0-9_-]+\.sqlite(?:-(?:wal|shm))?$/.test(name)) {
      continue;
    }
    const target = path.resolve(directory, name);
    const relative = path.relative(path.resolve(directory), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    try {
      fs.rmSync(target, { force: true });
    } catch (cleanupError) {
      // An overlapping run may still hold its database; leave it for the next
      // startup cleanup pass.
      void cleanupError;
    }
  }
}
