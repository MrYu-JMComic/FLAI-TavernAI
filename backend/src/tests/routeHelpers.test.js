import assert from 'node:assert/strict';
import test from 'node:test';

const { getChatProviderSettingsFromContext, normalizeIdList, parseJson, withConversationUsage } = await import('../routes/helpers.js');

test('parseJson returns parsed JSON values', () => {
  assert.deepEqual(parseJson('{"enabled":true,"count":2}', {}), { enabled: true, count: 2 });
  assert.deepEqual(parseJson('[1,2,3]', []), [1, 2, 3]);
});

test('parseJson returns fallback for empty or invalid values', () => {
  const fallback = { enabled: false };

  assert.equal(parseJson('', fallback), fallback);
  assert.equal(parseJson(null, fallback), fallback);
  assert.equal(parseJson('{invalid', fallback), fallback);
});

test('normalizeIdList rejects non-array payloads', () => {
  assert.deepEqual(normalizeIdList(null), []);
  assert.deepEqual(normalizeIdList('conversation-id'), []);
  assert.deepEqual(normalizeIdList({ ids: ['conversation-id'] }), []);
});

test('normalizeIdList trims ids, drops blanks, deduplicates, and stringifies values', () => {
  const result = normalizeIdList([' first-id ', '', 'first-id', 'second-id', 42, '42', null]);

  assert.deepEqual(result, ['first-id', 'second-id', '42']);
});

test('normalizeIdList caps request size at 100 ids', () => {
  const ids = Array.from({ length: 105 }, (_, index) => `conversation-${index}`);
  const result = normalizeIdList(ids);

  assert.equal(result.length, 100);
  assert.equal(result[0], 'conversation-0');
  assert.equal(result[99], 'conversation-99');
});

test('normalizeIdList stops coercing ids after reaching the cap', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `conversation-${index}`);
  ids.push({
    toString() {
      throw new Error('id after cap should not be coerced');
    }
  });

  const result = normalizeIdList(ids);

  assert.equal(result.length, 100);
  assert.equal(result[99], 'conversation-99');
});

test('withConversationUsage aggregates valid usage rows and skips invalid JSON', () => {
  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT usage_json FROM messages/);
      return {
        all(userId, conversationId) {
          assert.equal(userId, 'user-1');
          assert.equal(conversationId, 'conversation-1');
          return [
            { usage_json: '{"total_tokens":3,"_flai":{"totalCostCny":0.02}}' },
            { usage_json: '{invalid' },
            { usage_json: '{"totalTokens":4}' }
          ];
        }
      };
    }
  };

  const result = withConversationUsage({ id: 'conversation-1', title: 'Story' }, 'user-1', db);

  assert.deepEqual(result, {
    id: 'conversation-1',
    title: 'Story',
    usage: {
      totalTokens: 7,
      totalCostCny: 0.02,
      currency: 'CNY'
    }
  });
});

test('getChatProviderSettingsFromContext delegates to a provided context helper', () => {
  const expected = { ok: true, value: { model: 'delegated-model' } };
  const result = getChatProviderSettingsFromContext({
    getChatProviderSettings: (userId) => {
      assert.equal(userId, 'delegate-user');
      return expected;
    },
    providerWithSecret: () => {
      throw new Error('fallback should not run');
    },
    getProviderRow: () => null,
    hasUsableProvider: () => false
  }, 'delegate-user');

  assert.equal(result, expected);
});

test('getChatProviderSettingsFromContext reports API key errors from fallback settings', () => {
  const result = getChatProviderSettingsFromContext({
    providerWithSecret: () => ({ apiKeyError: 'cannot decrypt key' }),
    getProviderRow: (userId) => {
      assert.equal(userId, 'api-key-error-user');
      return { encrypted_api_key: 'broken' };
    },
    hasUsableProvider: () => {
      throw new Error('provider usability should not be checked after key errors');
    }
  }, 'api-key-error-user');

  assert.deepEqual(result, { ok: false, error: 'cannot decrypt key' });
});

test('getChatProviderSettingsFromContext validates fallback provider readiness', () => {
  const missing = getChatProviderSettingsFromContext({
    providerWithSecret: () => ({ apiKey: '', baseUrl: '', model: '' }),
    getProviderRow: () => null,
    hasUsableProvider: () => false
  }, 'missing-provider-user');

  assert.equal(missing.ok, false);
  assert.match(missing.error, /API Key/);

  const settings = { apiKey: 'sk-test', baseUrl: 'https://provider.test', model: 'test-model' };
  const ready = getChatProviderSettingsFromContext({
    providerWithSecret: () => settings,
    getProviderRow: () => ({ encrypted_api_key: 'encrypted' }),
    hasUsableProvider: (value) => value === settings
  }, 'ready-provider-user');

  assert.deepEqual(ready, { ok: true, value: settings });
});

test('getChatProviderSettingsFromContext checks provider readiness once for fallback settings', () => {
  const settings = { apiKey: '', baseUrl: 'http://127.0.0.1:11434', model: 'local-model' };
  let checks = 0;

  const ready = getChatProviderSettingsFromContext({
    providerWithSecret: () => settings,
    getProviderRow: () => ({ provider_type: 'custom' }),
    hasUsableProvider: (value) => {
      checks += 1;
      assert.equal(value, settings);
      return true;
    }
  }, 'local-proxy-user');

  assert.deepEqual(ready, { ok: true, value: settings });
  assert.equal(checks, 1);
});
