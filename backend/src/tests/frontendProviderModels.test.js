import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { useProviderModels } = await import('../../../frontend/src/composables/useProviderModels.js');
const { areProviderModelListsEqual } = await import('../../../frontend/src/services/modelCatalog.js');
const modelCatalogSource = readRepoText('frontend/src/services/modelCatalog.js');

function refValue(value) {
  return { __v_isRef: true, value };
}

function withFakeLocalStorage(callback) {
  const hadLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const originalLocalStorage = globalThis.localStorage;
  const store = new Map();

  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };

  try {
    return callback(store);
  } finally {
    if (hadLocalStorage) {
      globalThis.localStorage = originalLocalStorage;
    } else {
      delete globalThis.localStorage;
    }
  }
}

function silenceVueLifecycleWarnings(callback) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.warn = originalWarn;
  }
}

function providerCacheKey(settings) {
  const normalizedBaseUrl = String(settings.baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  const key = [
    String(settings.providerType || '').trim().toLowerCase(),
    String(settings.gatewayName || '').trim().toLowerCase(),
    normalizedBaseUrl,
    String(Boolean(settings.apiKey || settings.apiKeySet)),
    String(Boolean(settings.supportsReasoning)),
    '{}'
  ].join('|');
  return `flai-provider-models:v1:${encodeURIComponent(key)}`;
}

test('useProviderModels skips redundant cache syncs for identical model lists', () => {
  withFakeLocalStorage((store) => {
    silenceVueLifecycleWarnings(() => {
      const provider = {
        providerType: 'openai',
        baseUrl: 'https://api.example.test/v1'
      };
      const cacheKey = providerCacheKey(provider);
      store.set(cacheKey, JSON.stringify({
        savedAt: Date.now(),
        models: [
          { id: 'model-b', label: 'Model B', ownedBy: 'team' },
          { id: 'model-a', label: 'Model A', ownedBy: 'team' }
        ]
      }));

      const { providerModels, syncProviderModels } = useProviderModels(refValue(provider));
      const firstModels = providerModels.value;
      assert.deepEqual(firstModels.map((model) => model.id), ['model-a', 'model-b']);

      store.set(cacheKey, JSON.stringify({
        savedAt: Date.now(),
        models: [
          { id: 'model-a', label: 'Model A', ownedBy: 'team' },
          { id: 'model-b', label: 'Model B', ownedBy: 'team' }
        ]
      }));
      syncProviderModels();
      assert.equal(providerModels.value, firstModels);

      store.set(cacheKey, JSON.stringify({
        savedAt: Date.now(),
        models: [
          { id: 'model-a', label: 'Model A', ownedBy: 'team' },
          { id: 'model-b', label: 'Model B+', ownedBy: 'team' }
        ]
      }));
      syncProviderModels();
      assert.notEqual(providerModels.value, firstModels);
      assert.equal(providerModels.value[1].label, 'Model B+');
    });
  });
});

test('provider model list equality compares the UI-visible model fields', () => {
  const currentModels = [
    { id: 'model-a', label: 'Model A', ownedBy: 'team' },
    { id: 'model-b', label: 'Model B', ownedBy: '' }
  ];

  assert.equal(areProviderModelListsEqual(currentModels, [
    { id: 'model-a', label: 'Model A', ownedBy: 'team' },
    { id: 'model-b', label: 'Model B', ownedBy: '' }
  ]), true);
  assert.equal(areProviderModelListsEqual(currentModels, [
    { id: 'model-a', label: 'Model A', ownedBy: 'team' },
    { id: 'model-b', label: 'Model B+', ownedBy: '' }
  ]), false);
  assert.equal(areProviderModelListsEqual(currentModels, [
    { id: 'model-b', label: 'Model B', ownedBy: '' },
    { id: 'model-a', label: 'Model A', ownedBy: 'team' }
  ]), false);
});

test('provider model list equality scans model rows directly', () => {
  assert.match(
    modelCatalogSource,
    /export function areProviderModelListsEqual\(currentModels, nextModels\) \{[\s\S]*if \(currentModels === nextModels\) \{[\s\S]*return true;[\s\S]*for \(let index = 0; index < currentModels\.length; index \+= 1\) \{[\s\S]*const model = currentModels\[index\];[\s\S]*const nextModel = nextModels\[index\];[\s\S]*model\?\.id !== nextModel\?\.id[\s\S]*return false;[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(modelCatalogSource, /currentModels\.every\(/);
});
