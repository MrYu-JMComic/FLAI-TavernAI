import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { useProviderModels } = await import('../../../frontend/src/composables/useProviderModels.js');
const {
  areProviderModelListsEqual,
  readCachedProviderModels
} = await import('../../../frontend/src/services/modelCatalog.js');
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

function providerCacheKey(settings, extraBody = '{}') {
  const normalizedBaseUrl = String(settings.baseUrl || '').trim().replace(/\/+$/, '').toLowerCase();
  const key = [
    String(settings.providerType || '').trim().toLowerCase(),
    String(settings.gatewayName || '').trim().toLowerCase(),
    normalizedBaseUrl,
    String(Boolean(settings.apiKey || settings.apiKeySet)),
    String(Boolean(settings.supportsReasoning)),
    extraBody
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

test('provider model cache keys normalize nested extra body with direct recursive loops', () => {
  withFakeLocalStorage((store) => {
    const sortedExtraBody = '{"a":{"alpha":[{"x":2,"y":1}],"beta":2},"z":1}';
    const provider = {
      providerType: 'openai',
      gatewayName: 'Gateway',
      baseUrl: 'https://api.example.test/v1/',
      apiKeySet: true,
      supportsReasoning: true,
      extraBody: JSON.stringify({
        z: 1,
        a: {
          beta: 2,
          alpha: [{ y: 1, x: 2 }]
        }
      })
    };
    store.set(providerCacheKey(provider, sortedExtraBody), JSON.stringify({
      savedAt: Date.now(),
      models: [{ id: 'nested-model', label: 'Nested Model', ownedBy: 'team' }]
    }));

    const cached = readCachedProviderModels({
      ...provider,
      extraBody: {
        a: {
          alpha: [{ x: 2, y: 1 }],
          beta: 2
        },
        z: 1
      }
    });

    assert.deepEqual(cached, [{ id: 'nested-model', label: 'Nested Model', ownedBy: 'team' }]);
  });

  assert.match(
    modelCatalogSource,
    /function sortObject\(value\) \{[\s\S]*if \(Array\.isArray\(value\)\) \{[\s\S]*const sortedItems = \[\];[\s\S]*for \(let index = 0; index < value\.length; index \+= 1\) \{[\s\S]*sortedItems\.push\(sortObject\(value\[index\]\)\);[\s\S]*return sortedItems;[\s\S]*const keys = collectSortedObjectKeys\(value\);[\s\S]*for \(let index = 0; index < keys\.length; index \+= 1\) \{[\s\S]*result\[key\] = sortObject\(value\[key\]\);[\s\S]*return result;[\s\S]*\}/
  );
  assert.match(
    modelCatalogSource,
    /function collectSortedObjectKeys\(value\) \{[\s\S]*const keys = \[\];[\s\S]*for \(const key in value\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(value, key\)[\s\S]*keys\.push\(key\);[\s\S]*return keys\.sort\(\);[\s\S]*\}/
  );
  assert.doesNotMatch(modelCatalogSource, /value\.map\(sortObject\)/);
  assert.doesNotMatch(modelCatalogSource, /Object\.keys\(value\)[\s\S]*\.reduce\(/);
});
