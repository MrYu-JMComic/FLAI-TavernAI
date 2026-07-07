import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { publicUser, getUserProfile } = await import('../modules/users.js');
const { createAuthRouter } = await import('../routes/auth.js');
const { defaultProviderSettings, normalizeProviderRow } = await import('../services/providers.js');
const { withServer } = await import('./routeTestUtils.js');

test('register route returns a public user and creates default provider settings', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'auth-register-user',
        password: 'auth-register-password'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.user.username, 'auth-register-user');
    assert.equal(body.user.accountName, 'auth-register-user');
    assert.equal(body.user.avatarUrl, '');
    assert.ok(body.user.id);
    assert.match(response.headers.get('set-cookie') || '', /flai_session=/);

    const providerRow = database
      .prepare('SELECT * FROM provider_settings WHERE user_id = ?')
      .get(body.user.id);
    assert.equal(normalizeProviderRow(providerRow).providerType, defaultProviderSettings().providerType);
  });
});

function createAuthRoutesApp(database) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter({
    db: database,
    requireAuth: (request, response, next) => {
      if (!request.auth?.user) {
        response.status(401).json({ error: '请先登录' });
        return;
      }
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    publicUser: (row) => publicUser(database, row),
    getUserProfile: (userId) => getUserProfile(database, userId),
    saveDefaultProvider: (userId) => saveDefaultProvider(database, userId)
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}

function saveDefaultProvider(database, userId) {
  const preset = defaultProviderSettings();
  database.prepare(
    `INSERT OR IGNORE INTO provider_settings (
      user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
      api_key_hint, supports_reasoning, extra_body, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    preset.providerType,
    preset.gatewayName,
    preset.baseUrl,
    preset.model,
    null,
    null,
    preset.supportsReasoning ? 1 : 0,
    JSON.stringify(preset.extraBody),
    new Date().toISOString()
  );
  const row = database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
  return row ? normalizeProviderRow(row) : preset;
}
