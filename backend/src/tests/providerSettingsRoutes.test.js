import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createSettingsRouter } = await import('../routes/settings.js');
const { apiKeyHint, decryptSecret } = await import('../security.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('provider settings route preserves encrypted API key when update omits key', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-route-preserve-key-user';
  insertUser(database, userId);

  const app = createProviderSettingsApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const apiKey = 'sk-preserved-route-key-123456';
    const created = await putProviderSettings(baseUrl, {
      providerType: 'deepseek',
      gatewayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey,
      supportsReasoning: true,
      extraBody: { temperature: 0.2 }
    });

    assert.equal(created.apiKeySet, true);
    assert.equal(created.apiKeyHint, apiKeyHint(apiKey));

    const firstRow = getProviderRow(database, userId);
    assert.equal(decryptSecret(firstRow.encrypted_api_key), apiKey);

    const updated = await putProviderSettings(baseUrl, {
      providerType: 'openai',
      gatewayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      supportsReasoning: false,
      extraBody: { metadata: { source: 'route-test' } }
    });

    const updatedRow = getProviderRow(database, userId);
    assert.equal(updated.providerType, 'openai');
    assert.equal(updated.apiKeySet, true);
    assert.equal(updated.apiKeyHint, apiKeyHint(apiKey));
    assert.equal(decryptSecret(updatedRow.encrypted_api_key), apiKey);
    assert.equal(updatedRow.api_key_hint, apiKeyHint(apiKey));
  });
});

test('provider settings route clears encrypted API key when requested', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-route-clear-key-user';
  insertUser(database, userId);

  const app = createProviderSettingsApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const apiKey = 'sk-clear-route-key-123456';
    await putProviderSettings(baseUrl, {
      providerType: 'deepseek',
      gatewayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey,
      supportsReasoning: true,
      extraBody: {}
    });

    const cleared = await putProviderSettings(baseUrl, {
      providerType: 'deepseek',
      gatewayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      clearApiKey: true,
      supportsReasoning: true,
      extraBody: {}
    });

    const row = getProviderRow(database, userId);
    assert.equal(cleared.apiKeySet, false);
    assert.equal(cleared.apiKeyHint, null);
    assert.equal(row.encrypted_api_key, null);
    assert.equal(row.api_key_hint, null);
  });
});

function createProviderSettingsApp(database, userId) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSettingsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    nowIso: () => new Date().toISOString(),
    getUserProfile: () => ({ id: userId })
  }));
  return app;
}

async function putProviderSettings(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/settings/provider`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

function getProviderRow(database, userId) {
  return database.prepare('SELECT * FROM provider_settings WHERE user_id = ?').get(userId);
}
