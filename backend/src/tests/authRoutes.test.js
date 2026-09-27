import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { publicUser, getUserProfile } = await import('../modules/users.js');
const { createAuthRouter } = await import('../routes/auth.js');
const { defaultProviderSettings, normalizeProviderRow } = await import('../services/providers.js');
const { hashSessionToken } = await import('../security.js');
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

test('register route rolls back user provider and session when initialization fails', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, {
    saveDefaultProvider() {
      throw new Error('provider initialization failed');
    }
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'auth-rollback-user',
          password: 'auth-rollback-password'
        })
      });
      assert.equal(response.status, 500);
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM provider_settings').get().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  } finally {
    database.close();
  }
});

test('root bootstrap stores only the session token hash', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, {
    rootAdminUsername: 'bootstrap-admin',
    rootAdminPassword: 'bootstrap-admin-password',
    allowLegacyRootBootstrap: true
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'bootstrap-admin',
          password: 'bootstrap-admin-password'
        })
      });
      const body = await response.json();
      const sessionToken = /flai_session=([^;,]+)/.exec(response.headers.get('set-cookie') || '')?.[1] || '';
      const userRow = database.prepare('SELECT is_root_admin FROM users WHERE id = ?').get(body.user.id);
      const sessionRow = database.prepare('SELECT id, token_hash FROM sessions WHERE user_id = ?').get(body.user.id);

      assert.equal(response.status, 201);
      assert.equal(body.user.isRootAdmin, true);
      assert.equal(userRow.is_root_admin, 1);
      assert.ok(sessionToken);
      assert.notEqual(sessionRow.id, sessionToken);
      assert.equal(sessionRow.token_hash, hashSessionToken(sessionToken));
    });
  } finally {
    database.close();
  }
});

test('register route honors the registration switch without writing data', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, { registrationEnabled: false });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'registration-disabled-user',
          password: 'registration-disabled-password'
        })
      });
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.code, 'REGISTRATION_DISABLED');
    });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  } finally {
    database.close();
  }
});

test('one-time bootstrap token creates root and closes public registration', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, {
    rootAdminUsername: 'token-admin',
    rootAdminBootstrapToken: 'one-time-bootstrap-token'
  });
  try {
    await withServer(app, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'token-admin',
          password: 'normal-login-password',
          bootstrapToken: 'one-time-bootstrap-token'
        })
      });
      const firstBody = await first.json();
      assert.equal(first.status, 201);
      assert.equal(firstBody.user.isRootAdmin, true);

      const second = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'another-user', password: 'another-password' })
      });
      const secondBody = await second.json();
      assert.equal(second.status, 403);
      assert.equal(secondBody.code, 'REGISTRATION_BOOTSTRAP_COMPLETE');
    });
  } finally {
    database.close();
  }
});

test('bootstrap token mode rejects a non-root first registration and preserves the empty bootstrap slot', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, {
    rootAdminUsername: 'token-first-admin',
    rootAdminBootstrapToken: 'token-first-secret'
  });
  try {
    await withServer(app, async (baseUrl) => {
      const wrong = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ordinary-user', password: 'ordinary-password' })
      });
      assert.equal(wrong.status, 403);
      assert.equal((await wrong.json()).code, 'ROOT_BOOTSTRAP_REQUIRED');
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);

      const right = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'token-first-admin',
          password: 'ordinary-password',
          bootstrapToken: 'token-first-secret'
        })
      });
      assert.equal(right.status, 201);
      assert.equal((await right.json()).user.isRootAdmin, true);
    });
  } finally {
    database.close();
  }
});

test('legacy root password bootstrap is disabled unless explicitly enabled', async () => {
  const database = createAppDatabase(':memory:');
  const app = createAuthRoutesApp(database, {
    rootAdminUsername: 'legacy-admin',
    rootAdminPassword: 'legacy-password'
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'legacy-admin', password: 'legacy-password' })
      });
      assert.equal(response.status, 201);
      assert.equal((await response.json()).user.isRootAdmin, false);
    });
  } finally {
    database.close();
  }
});

function createAuthRoutesApp(database, options = {}) {
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
    saveDefaultProvider: options.saveDefaultProvider || ((userId) => saveDefaultProvider(database, userId)),
    registrationEnabled: options.registrationEnabled,
    rootAdminUsername: options.rootAdminUsername,
    rootAdminPassword: options.rootAdminPassword,
    rootAdminBootstrapToken: options.rootAdminBootstrapToken,
    allowLegacyRootBootstrap: options.allowLegacyRootBootstrap
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
