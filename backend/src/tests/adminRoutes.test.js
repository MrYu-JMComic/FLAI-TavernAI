import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createAdminRouter } from '../routes/admin.js';
import { submitJob } from '../services/jobs/jobQueue.js';
import { insertUser, withServer } from './routeTestUtils.js';

test('root admin APIs summarize operations without exposing session or provider secrets', async () => {
  const database = createAdminDatabase();
  const app = createAdminApp(database, { id: 'root-user', isRootAdmin: true });
  try {
    await withServer(app, async (baseUrl) => {
      const overviewResponse = await fetch(`${baseUrl}/api/admin/overview`);
      const overview = await overviewResponse.json();
      assert.equal(overviewResponse.status, 200);
      assert.equal(overview.users, 2);
      assert.equal(overview.activeSessions, 1);
      assert.equal(overview.jobs.active, 1);

      const usersResponse = await fetch(`${baseUrl}/api/admin/users?limit=1`);
      const users = await usersResponse.json();
      assert.equal(users.users.length, 1);
      assert.ok(users.nextCursor);
      assert.equal('password_hash' in users.users[0], false);
      const secondUsersResponse = await fetch(
        `${baseUrl}/api/admin/users?limit=1&cursor=${encodeURIComponent(users.nextCursor)}`
      );
      const secondUsers = await secondUsersResponse.json();
      assert.equal(secondUsersResponse.status, 200);
      assert.notEqual(secondUsers.users[0].id, users.users[0].id);

      const sessionsResponse = await fetch(`${baseUrl}/api/admin/sessions`);
      const sessionsText = await sessionsResponse.text();
      const sessions = JSON.parse(sessionsText);
      assert.equal(sessions.sessions[0].id, 'admin-session');
      assert.equal(sessionsText.includes('session-secret-hash'), false);

      const providersResponse = await fetch(`${baseUrl}/api/admin/providers`);
      const providersText = await providersResponse.text();
      const providers = JSON.parse(providersText);
      assert.equal(providers.settings[0].baseUrlHost, 'api.provider.test');
      assert.equal(providers.settings[0].apiKeySet, true);
      assert.equal(providersText.includes('encrypted-provider-secret'), false);

      const quotaResponse = await fetch(`${baseUrl}/api/admin/users/regular-user/quota`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrentAiJobs: 7 })
      });
      const quota = await quotaResponse.json();
      assert.equal(quotaResponse.status, 200);
      assert.equal(quota.maxConcurrentAiJobs, 7);

      const revokeResponse = await fetch(`${baseUrl}/api/admin/sessions/admin-session`, { method: 'DELETE' });
      assert.equal(revokeResponse.status, 200);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    });
  } finally {
    database.close();
  }
});

test('admin router rejects non-root users', async () => {
  const database = createAdminDatabase();
  const app = createAdminApp(database, { id: 'regular-user', isRootAdmin: false });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/admin/overview`);
      assert.equal(response.status, 403);
    });
  } finally {
    database.close();
  }
});

function createAdminDatabase() {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'root-user', { isRootAdmin: 1 });
  insertUser(database, 'regular-user');
  database.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('admin-session', 'regular-user', 'session-secret-hash', Date.now() + 60_000, new Date().toISOString());
  database.prepare(
    `INSERT INTO provider_settings (
       user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
       api_key_hint, supports_reasoning, allow_private_network, extra_body, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'regular-user',
    'openai',
    'Provider',
    'https://api.provider.test/v1',
    'model-one',
    'encrypted-provider-secret',
    'sk-...hint',
    0,
    0,
    '{}',
    new Date().toISOString()
  );
  submitJob(database, 'regular-user', 'memory.extract', {}, { idempotencyKey: 'admin-job' });
  return database;
}

function createAdminApp(database, user) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = { user };
    next();
  });
  app.use('/api/admin', createAdminRouter({
    db: database,
    requireAuth: (_request, _response, next) => next(),
    requireRootAdmin: (request, response, next) => {
      if (!request.auth.user.isRootAdmin) return response.status(403).json({ error: 'forbidden' });
      return next();
    }
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  return app;
}
