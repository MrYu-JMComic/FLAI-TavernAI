import assert from 'node:assert/strict';
import test from 'node:test';

const { getChatProviderSettingsFromContext } = await import('../routes/helpers.js');

test('chat provider settings keep missing API keys blocked by default', () => {
  const result = getChatProviderSettingsFromContext(createProviderContext({ mockProviderEnabled: false }), 'user-missing-key');

  assert.equal(result.ok, false);
  assert.match(result.error, /API Key/);
});

test('chat provider settings can use explicit local mock provider for E2E', () => {
  const result = getChatProviderSettingsFromContext(createProviderContext({ mockProviderEnabled: true }), 'user-mock');

  assert.equal(result.ok, true);
  assert.equal(result.value.providerType, 'mock');
  assert.equal(result.value.gatewayName, 'Local Mock');
  assert.equal(result.value.model, 'local-mock');
  assert.equal(result.value.apiKey, '');
  assert.equal(result.value.apiKeyError, null);
});

function createProviderContext({ mockProviderEnabled }) {
  return {
    mockProviderEnabled,
    getProviderRow: () => ({
      provider_type: 'deepseek',
      gateway_name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      encrypted_api_key: null,
      api_key_hint: null,
      supports_reasoning: 1,
      extra_body: '{}'
    }),
    providerWithSecret: () => ({
      providerType: 'deepseek',
      gatewayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKey: '',
      apiKeyError: null,
      supportsReasoning: true,
      extraBody: {}
    }),
    hasUsableProvider: () => false
  };
}
