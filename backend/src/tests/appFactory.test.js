import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { appConfig } from '../config.js';
import { createAppDatabase } from '../db/runtime.js';
import { createApp, isAllowedClientOrigin } from '../app.js';
import { createSession, hashPassword, hashSessionToken } from '../security.js';
import { startServer } from '../server.js';
import { consumeDailyRequest, getDailyUsage, updateUserQuota } from '../services/quotas.js';
import { insertUser, withServer } from './routeTestUtils.js';

test('importing the app factory does not open SQLite, start timers, or listen', () => {
  const databasePath = path.join(os.tmpdir(), `flai-app-import-${randomUUID()}.sqlite`);
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "await import('./src/app.js');"
  ], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_SECRET: 'app-factory-import-test-secret',
      FLAI_DB_PATH: databasePath
    },
    timeout: 5000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(databasePath), false);
});

test('application factory exposes lightweight health and redacts unknown production errors', async () => {
  const database = createAppDatabase(':memory:');
  const logs = [];
  const config = {
    ...appConfig,
    isProduction: true,
    clientOrigins: ['https://client.example'],
    allowPrivateNetworkOrigins: false
  };
  const app = createApp({
    db: database,
    config,
    logger: {
      error: (event, fields) => logs.push({ event, fields }),
      warn() {},
      info() {},
      debug() {}
    },
    registerAdditionalRoutes(application) {
      application.get('/api/test-error', () => {
        throw new Error('SQLITE /secret/path provider-token-123');
      });
    }
  });
  try {
    await withServer(app, async (baseUrl) => {
      const live = await fetch(`${baseUrl}/health/live`, {
        headers: { Origin: 'https://client.example' }
      });
      const health = await live.json();
      assert.equal(live.status, 200);
      assert.equal(health.ok, true);
      assert.equal('runtime' in health, false);
      assert.equal('checks' in health, false);

      const failed = await fetch(`${baseUrl}/api/test-error`, {
        headers: { Origin: 'https://client.example' }
      });
      const body = await failed.json();
      assert.equal(failed.status, 500);
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.equal(JSON.stringify(body).includes('/secret/path'), false);
      assert.equal(logs[0].fields.message.includes('/secret/path'), true);
    });
  } finally {
    database.close();
  }
});

test('authentication and root admin recovery stay available after daily quota exhaustion', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'quota-admin', {
    isRootAdmin: 1,
    passwordHash: await hashPassword('quota-admin-password')
  });
  const sessionId = createSession(database, 'quota-admin');
  updateUserQuota(database, 'quota-admin', { maxDailyRequests: 1 });
  consumeDailyRequest(database, 'quota-admin');
  const app = createApp({
    db: database,
    logger: { error() {}, warn() {}, info() {}, debug() {} }
  });

  try {
    await withServer(app, async (baseUrl) => {
      let sessionCookie = `flai_session=${sessionId}`;
      const blocked = await fetch(`${baseUrl}/api/presets`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, 'DAILY_REQUEST_QUOTA_EXCEEDED');

      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(meResponse.status, 200);
      assert.equal((await meResponse.json()).user.isRootAdmin, true);

      const loginCsrfResponse = await fetch(`${baseUrl}/api/csrf-token`, {
        headers: { Cookie: sessionCookie }
      });
      const loginCsrfToken = (await loginCsrfResponse.json()).csrfToken;
      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Cookie: `${sessionCookie}; flai_csrf=${loginCsrfToken}`,
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginCsrfToken
        },
        body: JSON.stringify({ username: 'quota-admin', password: 'quota-admin-password' })
      });
      assert.equal(loginResponse.status, 200);
      assert.equal((await loginResponse.json()).user.isRootAdmin, true);
      const rotatedSessionId = /flai_session=([^;,]+)/.exec(loginResponse.headers.get('set-cookie') || '')?.[1];
      assert.ok(rotatedSessionId);
      sessionCookie = `flai_session=${rotatedSessionId}`;
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?')
          .get(hashSessionToken(sessionId)).count,
        0
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
          .get('quota-admin').count,
        1
      );
      assert.equal(getDailyUsage(database, 'quota-admin').requestCount, 1);

      const usageResponse = await fetch(`${baseUrl}/api/admin/users/quota-admin/usage`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(usageResponse.status, 200);

      const adminCsrfResponse = await fetch(`${baseUrl}/api/csrf-token`, {
        headers: { Cookie: sessionCookie }
      });
      const adminCsrfToken = (await adminCsrfResponse.json()).csrfToken;
      const adminMutationHeaders = {
        Cookie: `${sessionCookie}; flai_csrf=${adminCsrfToken}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': adminCsrfToken
      };
      const quotaResponse = await fetch(`${baseUrl}/api/admin/users/quota-admin/quota`, {
        method: 'PUT',
        headers: adminMutationHeaders,
        body: JSON.stringify({ maxConcurrentAiJobs: 3 })
      });
      assert.equal(quotaResponse.status, 200);
      assert.equal((await quotaResponse.json()).maxConcurrentAiJobs, 3);
      assert.equal(getDailyUsage(database, 'quota-admin').requestCount, 1);

      const resetResponse = await fetch(`${baseUrl}/api/admin/users/quota-admin/usage/requests/reset`, {
        method: 'POST',
        headers: adminMutationHeaders
      });

      assert.equal(resetResponse.status, 200);
      assert.equal((await resetResponse.json()).requestCount, 0);
      assert.equal(getDailyUsage(database, 'quota-admin').requestCount, 0);

      const recovered = await fetch(`${baseUrl}/api/presets`, {
        headers: { Cookie: sessionCookie }
      });
      assert.equal(recovered.status, 200);
      assert.deepEqual(await recovered.json(), []);
      assert.equal(getDailyUsage(database, 'quota-admin').requestCount, 1);
    });
  } finally {
    database.close();
  }
});

test('CORS defaults only trust configured origins', () => {
  const config = {
    ...appConfig,
    clientOrigins: ['https://client.example'],
    allowPrivateNetworkOrigins: false
  };
  assert.equal(isAllowedClientOrigin('https://client.example', config), true);
  assert.equal(isAllowedClientOrigin('http://192.168.1.20:5173', config), false);
  assert.equal(isAllowedClientOrigin('https://attacker.example', config), false);
});

test('server lifecycle stops HTTP tasks before closing SQLite', async () => {
  const database = createAppDatabase(':memory:');
  const runtime = await startServer({
    db: database,
    databasePath: ':memory:',
    config: { ...appConfig, port: 0 },
    backupOnStartup: false,
    logger: { error() {}, warn() {}, info() {}, debug() {} }
  });
  assert.ok(runtime.server.address().port > 0);
  await runtime.close('test');
  assert.throws(() => database.prepare('SELECT 1'), /not open|closed/i);
});
