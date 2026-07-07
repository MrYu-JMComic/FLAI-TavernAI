import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendDir, '..');
const backendDir = path.join(repoRoot, 'backend');
const runtimeDir = path.join(repoRoot, '.runtime-check');

fs.mkdirSync(runtimeDir, { recursive: true });

const backendPort = Number(process.env.FLAI_E2E_BACKEND_PORT || 3211);
const frontendPort = Number(process.env.FLAI_E2E_FRONTEND_PORT || 5174);
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const e2eDatabasePath = path.join(runtimeDir, 'e2e.sqlite');

export default defineConfig({
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
        FLAI_DB_PATH: e2eDatabasePath,
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
