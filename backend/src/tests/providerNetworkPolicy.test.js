import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { appConfig } = await import('../config.js');
const { createAppDatabase } = await import('../db.js');
const { createSettingsRouter } = await import('../routes/settings.js');
const { createUpgradeRouter } = await import('../routes/upgrade.js');
const { getProviderProfileRow } = await import('../repositories/providerProfileRepository.js');
const { providerWithSecret, hasUsableProvider } = await import('../services/providers.js');
const {
  applyProviderNetworkPolicy,
  isPrivateProviderNetworkEnabled,
  isTestMockProviderUrl,
  providerPrivateNetworkErrorMessage
} = await import('../services/providerNetworkPolicy.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

const localProvider = {
  providerType: 'custom',
  gatewayName: 'Local gateway',
  baseUrl: 'http://127.0.0.1:8317/v1',
  model: 'local-model',
  apiKey: '',
  supportsReasoning: false,
  extraBody: {}
};

test('production private provider access requires the production switch, not the dev switch', () => {
  const config = {
    ...appConfig,
    nodeEnv: 'production',
    isProduction: true,
    allowPrivateProviderNetwork: false,
    allowPrivateProviderNetworkInDevelopment: true
  };
  assert.equal(isPrivateProviderNetworkEnabled(config), false);
  assert.match(providerPrivateNetworkErrorMessage(config), /ALLOW_PRIVATE_PROVIDER_NETWORK=true/);
  assert.throws(
    () => applyProviderNetworkPolicy(localProvider, config, { isRootAdmin: true }),
    { code: 'PROVIDER_PRIVATE_NETWORK_BLOCKED' }
  );
});

test('provider network policy recomputes stale persisted flags for root settings', () => {
  const config = {
    ...appConfig,
    nodeEnv: 'production',
    isProduction: true,
    allowPrivateProviderNetwork: true,
    providerResolveDns: false
  };
  const effective = applyProviderNetworkPolicy(
    { ...localProvider, allowPrivateNetwork: false },
    config,
    { isRootAdmin: 1 }
  );
  assert.equal(effective.allowPrivateNetwork, true);
  assert.equal(effective.enforcePrivateNetworkPolicy, true);
  assert.equal(effective.baseUrl, localProvider.baseUrl);
});

test('mock loopback URLs are accepted only in the test environment', () => {
  const base = { ...appConfig, mockProviderEnabled: true };
  assert.equal(isTestMockProviderUrl('http://127.0.0.1:3211/api', { ...base, nodeEnv: 'test' }), true);
  assert.equal(isTestMockProviderUrl('http://127.0.0.1:3211/api', { ...base, nodeEnv: 'development' }), false);
  assert.throws(
    () => applyProviderNetworkPolicy(
      { ...localProvider, baseUrl: 'http://127.0.0.1:3211/api' },
      { ...base, nodeEnv: 'development', allowPrivateProviderNetworkInDevelopment: false },
      { isRootAdmin: false }
    ),
    { code: 'PROVIDER_PRIVATE_NETWORK_BLOCKED' }
  );
});

test('models and health routes share the root deployment policy and ignore stale flags', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-policy-root';
  insertUser(database, userId, { isRootAdmin: 1, permissionGroup: 'admin' });
  const config = {
    ...appConfig,
    nodeEnv: 'production',
    isProduction: true,
    allowPrivateProviderNetwork: true,
    providerResolveDns: false,
    mockProviderEnabled: false
  };
  const app = createProviderPolicyApp(database, userId, config);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:8317/')) {
      providerCalls += 1;
      return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return originalFetch(url, options);
  };

  try {
    await withServer(app, async (baseUrl) => {
      const saved = await requestJson(baseUrl, '/api/settings/provider', {
        method: 'PUT',
        body: localProvider
      });
      assert.equal(saved.allowPrivateNetwork, true, JSON.stringify(saved));

      database.prepare('UPDATE provider_presets SET allow_private_network = 0 WHERE user_id = ?').run(userId);
      database.prepare('UPDATE provider_settings SET allow_private_network = 0 WHERE user_id = ?').run(userId);
      assert.equal(getProviderProfileRow(database, userId).allow_private_network, 0);

      const models = await requestJson(baseUrl, '/api/providers/models', {
        method: 'POST',
        body: localProvider
      });
      assert.deepEqual(models.models.map((model) => model.id), ['local-model']);

      const health = await requestJson(baseUrl, '/api/providers/health', {
        method: 'POST',
        body: localProvider
      });
      assert.equal(health.ok, true);
      assert.equal(health.readiness.configured, true);
      assert.equal(providerCalls, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('production routes return an actionable switch error before contacting a private provider', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'provider-policy-disabled-root';
  insertUser(database, userId, { isRootAdmin: 1, permissionGroup: 'admin' });
  const config = {
    ...appConfig,
    nodeEnv: 'production',
    isProduction: true,
    allowPrivateProviderNetwork: false,
    allowPrivateProviderNetworkInDevelopment: true,
    providerResolveDns: false
  };
  const app = createProviderPolicyApp(database, userId, config);
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('http://127.0.0.1:8317/')) {
      providerCalls += 1;
      return new Response('{}');
    }
    return originalFetch(url, options);
  };
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/providers/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localProvider)
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.code, 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
      assert.match(body.error, /ALLOW_PRIVATE_PROVIDER_NETWORK=true/);
      assert.equal(providerCalls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

function createProviderPolicyApp(database, userId, config) {
  const app = express();
  app.use(express.json());
  const context = {
    db: database,
    config,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, isRootAdmin: true, permissionGroup: 'admin' } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    nowIso: () => new Date().toISOString(),
    getUserProfile: () => ({ id: userId }),
    getProviderRow: (targetUserId, providerId = '') => getProviderProfileRow(database, targetUserId, providerId),
    providerWithSecret,
    hasUsableProvider
  };
  app.use('/api', createSettingsRouter(context));
  app.use('/api', createUpgradeRouter(context));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({
      error: error.publicMessage || error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  });
  return app;
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}
