import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-character-assistant-profiles';

const { initializeDatabase, resetColumnCache } = await import('../db/schema.js');
const { createCharactersRouter } = await import('../routes/characters.js');
const { createProviderProfile, getProviderProfileRow } = await import('../repositories/providerProfileRepository.js');
const { hasUsableProvider, providerWithSecret } = await import('../services/providers.js');
const { encryptSecret } = await import('../security.js');
const { createCharacterAssistantSession, getCharacterAssistantSession } = await import('../modules/characterAssistantSessions.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

function profile(database, userId, gatewayName, values = {}, options = {}) {
  return createProviderProfile(database, userId, {
    providerType: 'openai', gatewayName, baseUrl: `https://${gatewayName}.test/v1`,
    model: `${gatewayName}-default`, encryptedApiKey: encryptSecret(`sk-${gatewayName}`),
    extraBody: {}, ...values
  }, options);
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  resetColumnCache();
  initializeDatabase(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  const globalProfile = profile(database, 'owner', 'global-gateway');
  const assistantProfile = profile(database, 'owner', 'assistant-gateway', {}, { select: false });
  const foreignProfile = profile(database, 'other', 'foreign-gateway');
  const app = express();
  const state = { defaultResolutions: 0 };
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    config: { isProduction: false, providerResolveDns: false },
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: 'owner', username: 'Owner', isRootAdmin: false } };
      next();
    },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    getProviderRow: (userId, providerId = '') => getProviderProfileRow(database, userId, providerId),
    providerWithSecret,
    hasUsableProvider,
    getChatProviderSettings: userId => {
      state.defaultResolutions += 1;
      return { ok: true, value: providerWithSecret(getProviderProfileRow(database, userId)) };
    }
  }));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  return { database, app, state, globalProfile, assistantProfile, foreignProfile };
}

function requestOptions(payload) {
  return {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationMode: true, requirement: 'Discuss the character.', character: { name: 'Draft' }, ...payload })
  };
}

function providerSnapshot(database) {
  return {
    selected: database.prepare('SELECT * FROM provider_selections ORDER BY user_id').all(),
    legacy: database.prepare('SELECT * FROM provider_settings ORDER BY user_id').all(),
    profiles: database.prepare('SELECT * FROM provider_presets ORDER BY id').all()
  };
}

function providerResponse(stream) {
  if (!stream) return Response.json({ choices: [{ message: { role: 'assistant', content: 'Let us discuss the character.' } }] });
  return new Response([
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Let us discuss the character.' }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n'
  ].join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

for (const streaming of [false, true]) {
  test(`character assistant resolves an owned gateway and model without changing global selection, streaming ${streaming}`, async () => {
    const env = fixture();
    const originalFetch = globalThis.fetch;
    const requests = [];
    try {
      const before = providerSnapshot(env.database);
      globalThis.fetch = async (url, options = {}) => {
        if (!String(url).includes('.test/')) return originalFetch(url, options);
        const body = JSON.parse(options.body);
        requests.push({ url: String(url), body, headers: new Headers(options.headers) });
        return providerResponse(body.stream);
      };
      await withServer(env.app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/characters/complete-draft`, requestOptions({
          providerProfileId: env.assistantProfile.id, modelOverride: 'assistant-chosen-model',
          stream: streaming, providerStreaming: streaming
        }));
        assert.equal(response.status, 200);
        if (streaming) {
          assert.match(response.headers.get('Content-Type'), /text\/event-stream/);
          const events = await response.text();
          assert.match(events, /event: content/);
          assert.match(events, /event: done/);
          assert.match(events, /"assistantMessage":"Let us discuss the character\."/);
          assert.doesNotMatch(events, /event: error/);
        } else {
          assert.equal((await response.json()).assistantMessage, 'Let us discuss the character.');
        }
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://assistant-gateway.test/v1/chat/completions');
        assert.equal(requests[0].body.model, 'assistant-chosen-model');
        assert.equal(Boolean(requests[0].body.stream), streaming);
        assert.equal(requests[0].headers.get('Authorization'), 'Bearer sk-assistant-gateway');
        assert.equal(env.state.defaultResolutions, 0);
        assert.deepEqual(providerSnapshot(env.database), before);

        const fallback = await fetch(`${baseUrl}/api/characters/complete-draft`, requestOptions({ providerProfileId: '' }));
        assert.equal(fallback.status, 200);
        await fallback.json();
        assert.equal(requests[1].url, 'https://global-gateway.test/v1/chat/completions');
        assert.equal(requests[1].body.model, 'global-gateway-default');
        assert.equal(requests[1].headers.get('Authorization'), 'Bearer sk-global-gateway');
        assert.equal(env.state.defaultResolutions, 1);
        assert.deepEqual(providerSnapshot(env.database), before);
      });
    } finally {
      globalThis.fetch = originalFetch;
      env.database.close();
    }
  });
}

test('explicit missing, foreign, unusable, and undecryptable assistant gateways fail before transport or session mutation', async () => {
  const env = fixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    const unusable = profile(env.database, 'owner', 'missing-key', { encryptedApiKey: null }, { select: false });
    const invalidKey = profile(env.database, 'owner', 'invalid-key', { encryptedApiKey: 'unreadable-key' }, { select: false });
    const session = createCharacterAssistantSession(env.database, 'owner', { character: { name: 'Private draft' } });
    const before = providerSnapshot(env.database);
    globalThis.fetch = async (url, options = {}) => {
      if (!String(url).includes('.test/')) return originalFetch(url, options);
      providerCalls += 1;
      return providerResponse(false);
    };
    await withServer(env.app, async baseUrl => {
      for (const [providerProfileId, expectedStatus, code] of [
        ['missing-profile', 404, 'PROVIDER_PROFILE_NOT_FOUND'],
        [env.foreignProfile.id, 404, 'PROVIDER_PROFILE_NOT_FOUND'],
        [unusable.id, 400, 'PROVIDER_PROFILE_UNUSABLE'],
        [invalidKey.id, 400, 'PROVIDER_PROFILE_UNUSABLE']
      ]) {
        const response = await fetch(`${baseUrl}/api/characters/complete-draft`, requestOptions({
          providerProfileId, assistantSessionId: session.id, stream: true, providerStreaming: true
        }));
        assert.equal(response.status, expectedStatus);
        const error = await response.json();
        assert.equal(error.code, code);
        assert.match(error.error, /网关|API Key/);
        assert.deepEqual(getCharacterAssistantSession(env.database, 'owner', session.id).messages, []);
      }
    });
    assert.equal(providerCalls, 0);
    assert.equal(env.state.defaultResolutions, 0);
    assert.deepEqual(providerSnapshot(env.database), before);
  } finally {
    globalThis.fetch = originalFetch;
    env.database.close();
  }
});

test('assistant profile overrides enforce runtime network policy despite a persisted private-network flag', async () => {
  const env = fixture();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    const local = profile(env.database, 'owner', 'private-gateway', {
      baseUrl: 'http://127.0.0.1:8317/v1', allowPrivateNetwork: true
    }, { select: false });
    globalThis.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('http://127.0.0.1:8317/')) return originalFetch(url, options);
      providerCalls += 1;
      return providerResponse(false);
    };
    const before = providerSnapshot(env.database);
    await withServer(env.app, async baseUrl => {
      const response = await fetch(`${baseUrl}/api/characters/complete-draft`, requestOptions({ providerProfileId: local.id }));
      assert.equal(response.status, 400);
      const error = await response.json();
      assert.equal(error.code, 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
      assert.match(error.error, /root/);
    });
    assert.equal(providerCalls, 0);
    assert.equal(env.state.defaultResolutions, 0);
    assert.deepEqual(providerSnapshot(env.database), before);
  } finally {
    globalThis.fetch = originalFetch;
    env.database.close();
  }
});
