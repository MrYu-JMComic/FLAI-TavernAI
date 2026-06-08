import { fetchProviderModels } from '../api.js';

const CACHE_PREFIX = 'flai-provider-models:v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_EVENT = 'flai-provider-models-updated';

export function readCachedProviderModels(settings = {}) {
  const key = cacheStorageKey(settings);
  if (!key || typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const cached = JSON.parse(raw);
    if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return [];
    }
    return normalizeModelList(cached.models);
  } catch {
    return [];
  }
}

export async function refreshProviderModels(settings = {}, { forceRefresh = true } = {}) {
  const result = await fetchProviderModels(
    {
      providerType: settings.providerType,
      gatewayName: settings.gatewayName,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      supportsReasoning: settings.supportsReasoning,
      extraBody: settings.extraBody,
      forceRefresh
    },
    { forceRefresh }
  );
  const models = normalizeModelList(result.models);
  writeCachedProviderModels(settings, models);
  return models;
}

export function buildModelSelectOptions(models = [], currentValue = '', emptyLabel = '') {
  const options = [];
  if (emptyLabel) {
    options.push({ id: '', label: emptyLabel, empty: true });
  }

  const normalized = normalizeModelList(models);
  const current = String(currentValue || '').trim();
  if (current && !normalized.some((model) => model.id === current)) {
    options.push({
      id: current,
      label: `当前保存：${current}`,
      current: true
    });
  }

  return [...options, ...normalized];
}

export function subscribeProviderModelCache(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {};
  }

  const onUpdate = () => callback();
  const onStorage = (event) => {
    if (String(event.key || '').startsWith(CACHE_PREFIX)) {
      callback();
    }
  };

  window.addEventListener(CACHE_EVENT, onUpdate);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CACHE_EVENT, onUpdate);
    window.removeEventListener('storage', onStorage);
  };
}

export function normalizeModelList(models = []) {
  const byId = new Map();
  for (const item of Array.isArray(models) ? models : []) {
    const id = String(typeof item === 'string' ? item : item?.id || item?.name || item?.model || '').trim();
    if (!id || byId.has(id)) {
      continue;
    }
    byId.set(id, {
      id,
      label: String(item?.label || item?.displayName || item?.display_name || item?.name || id).trim() || id,
      ownedBy: String(item?.ownedBy || item?.owned_by || item?.publisher || '').trim()
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function areProviderModelListsEqual(currentModels, nextModels) {
  if (currentModels === nextModels) {
    return true;
  }
  if (!Array.isArray(currentModels) || !Array.isArray(nextModels) || currentModels.length !== nextModels.length) {
    return false;
  }
  for (let index = 0; index < currentModels.length; index += 1) {
    const model = currentModels[index];
    const nextModel = nextModels[index];
    if (model?.id !== nextModel?.id || model?.label !== nextModel?.label || model?.ownedBy !== nextModel?.ownedBy) {
      return false;
    }
  }
  return true;
}

function writeCachedProviderModels(settings = {}, models = []) {
  const key = cacheStorageKey(settings);
  if (!key || typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      models: normalizeModelList(models)
    }));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CACHE_EVENT));
    }
  } catch {
    // localStorage may be unavailable or full.
  }
}

function cacheStorageKey(settings = {}) {
  const key = providerModelCacheKey(settings);
  return key ? `${CACHE_PREFIX}${encodeURIComponent(key)}` : '';
}

function providerModelCacheKey(settings = {}) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) {
    return '';
  }
  return [
    String(settings.providerType || '').trim().toLowerCase(),
    String(settings.gatewayName || '').trim().toLowerCase(),
    baseUrl,
    String(Boolean(settings.apiKey || settings.apiKeySet)),
    String(Boolean(settings.supportsReasoning)),
    stableStringifyExtraBody(settings.extraBody)
  ].join('|');
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function stableStringifyExtraBody(value) {
  if (!value) {
    return '{}';
  }
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(sortObject(parsed));
  } catch {
    return String(value || '').trim();
  }
}

function sortObject(value) {
  if (Array.isArray(value)) {
    const sortedItems = [];
    for (let index = 0; index < value.length; index += 1) {
      sortedItems.push(sortObject(value[index]));
    }
    return sortedItems;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const keys = collectSortedObjectKeys(value);
  const result = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    result[key] = sortObject(value[key]);
  }
  return result;
}

function collectSortedObjectKeys(value) {
  const keys = [];
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      keys.push(key);
    }
  }
  return keys.sort();
}
