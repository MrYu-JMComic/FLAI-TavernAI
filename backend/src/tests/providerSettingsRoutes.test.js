import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createSettingsRouter } = await import('../routes/settings.js');
const { apiKeyHint, decryptSecret } = await import('../security.js');
const { getSelectedProviderProfileRow } = await import('../repositories/providerProfileRepository.js');
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

test('provider settings route normalizes Gemini OpenAI-compatible settings', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-route-gemini-normalize-user';
  insertUser(database, userId);

  const app = createProviderSettingsApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const saved = await putProviderSettings(baseUrl, {
      providerType: 'gemini',
      gatewayName: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      model: 'gemini-2.5-flash',
      supportsReasoning: true,
      extraBody: {
        contents: [{ role: 'user', parts: [{ text: 'native prompt' }] }],
        generation_config: { temperature: 0.1 },
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        custom_flag: 'kept',
        extra_body: {
          google: {
            thinking_config: { include_thoughts: true }
          }
        }
      }
    });

    const row = getProviderRow(database, userId);
    const savedExtraBody = JSON.parse(row.extra_body);

    assert.equal(saved.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.equal(row.base_url, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.equal(saved.extraBody.contents, undefined);
    assert.equal(saved.extraBody.generation_config, undefined);
    assert.equal(saved.extraBody.toolConfig, undefined);
    assert.equal(saved.extraBody.custom_flag, 'kept');
    assert.deepEqual(saved.extraBody.extra_body.google.thinking_config, { include_thoughts: true });
    assert.deepEqual(savedExtraBody, saved.extraBody);
  });
});

test('private provider settings require a root administrator and explicit enablement', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'provider-private-user');
  insertUser(database, 'provider-private-root', { isRootAdmin: 1, permissionGroup: 'admin' });
  const payload = {
    providerType: 'custom',
    gatewayName: 'Local model',
    baseUrl: 'http://127.0.0.1:8317/v1',
    model: 'local-model',
    allowPrivateNetwork: true,
    extraBody: {}
  };

  await withServer(createProviderSettingsApp(database, 'provider-private-user'), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/settings/provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
    assert.equal(getProviderRow(database, 'provider-private-user'), undefined);
  });

  await withServer(
    createProviderSettingsApp(database, 'provider-private-root', { isRootAdmin: true }),
    async (baseUrl) => {
      const saved = await putProviderSettings(baseUrl, payload);
      assert.equal(saved.allowPrivateNetwork, true);
      assert.equal(getProviderRow(database, 'provider-private-root').allow_private_network, 1);
    }
  );
  database.close();
});

test('provider profiles can be added selected used and deleted independently', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-profile-owner';
  insertUser(database, userId);
  const app = createProviderSettingsApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const initialBundle = await requestJson(baseUrl, '/api/providers');
    assert.equal(initialBundle.providers.length, 1);
    const deepSeekId = initialBundle.selectedProviderId;
    assert.equal(initialBundle.providers[0].providerType, 'deepseek');

    const openAiKey = 'sk-openai-profile-123456';
    const createdBundle = await requestJson(baseUrl, '/api/providers', {
      method: 'POST',
      body: {
        providerType: 'openai',
        gatewayName: 'Work OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
        apiKey: openAiKey,
        supportsReasoning: false,
        extraBody: {}
      },
      expectedStatus: 201
    });
    const openAiId = createdBundle.selectedProviderId;
    assert.notEqual(openAiId, deepSeekId);
    assert.equal(createdBundle.providers.length, 2);
    assert.equal(getProviderRow(database, userId).gateway_name, 'Work OpenAI');
    assert.equal(decryptSecret(getSelectedProviderProfileRow(database, userId).encrypted_api_key), openAiKey);

    const deepSeekKey = 'sk-deepseek-profile-123456';
    await requestJson(baseUrl, `/api/providers/${deepSeekId}`, {
      method: 'PUT',
      body: {
        providerType: 'deepseek',
        gatewayName: 'Personal DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        apiKey: deepSeekKey,
        supportsReasoning: true,
        extraBody: {}
      }
    });
    assert.equal(getProviderRow(database, userId).gateway_name, 'Work OpenAI');

    const selectedDeepSeek = await requestJson(baseUrl, `/api/providers/${deepSeekId}/select`, {
      method: 'POST'
    });
    assert.equal(selectedDeepSeek.selectedProviderId, deepSeekId);
    assert.equal(getProviderRow(database, userId).gateway_name, 'Personal DeepSeek');
    assert.equal(decryptSecret(getSelectedProviderProfileRow(database, userId).encrypted_api_key), deepSeekKey);

    const publicCurrent = await requestJson(baseUrl, '/api/settings/provider');
    assert.equal(publicCurrent.id, deepSeekId);
    assert.equal(publicCurrent.gatewayName, 'Personal DeepSeek');

    await requestJson(baseUrl, `/api/providers/${openAiId}/select`, { method: 'POST' });
    const afterDelete = await requestJson(baseUrl, `/api/providers/${openAiId}`, { method: 'DELETE' });
    assert.equal(afterDelete.providers.length, 1);
    assert.equal(afterDelete.selectedProviderId, deepSeekId);
    assert.equal(getSelectedProviderProfileRow(database, userId).id, deepSeekId);

    const lastDelete = await fetch(`${baseUrl}/api/providers/${deepSeekId}`, { method: 'DELETE' });
    assert.equal(lastDelete.status, 409);
  });
  database.close();
});

test('provider profile updates enforce user ownership', async () => {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'provider-owner-a');
  insertUser(database, 'provider-owner-b');
  let foreignProviderId = '';

  await withServer(createProviderSettingsApp(database, 'provider-owner-b'), async (baseUrl) => {
    foreignProviderId = (await requestJson(baseUrl, '/api/providers')).selectedProviderId;
  });
  await withServer(createProviderSettingsApp(database, 'provider-owner-a'), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/${foreignProviderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini'
      })
    });
    assert.equal(response.status, 404);
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS count FROM provider_presets WHERE user_id = ?'
    ).get('provider-owner-a').count, 0);
  });
  database.close();
});

function createProviderSettingsApp(database, userId, user = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSettingsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, ...user } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    nowIso: () => new Date().toISOString(),
    getUserProfile: () => ({ id: userId })
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.publicMessage || error.message });
  });
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

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  assert.equal(response.status, options.expectedStatus || 200, text);
  return text ? JSON.parse(text) : null;
}
