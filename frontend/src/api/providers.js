import { apiRequest } from './core.js';

export function getProviderSettings() {
  return apiRequest('/api/settings/provider');
}

export function saveProviderSettings(payload) {
  return apiRequest('/api/settings/provider', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchProviderModels(payload = {}, options = {}) {
  return apiRequest('/api/providers/models', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      forceRefresh: Boolean(options.forceRefresh ?? payload.forceRefresh)
    })
  });
}

export function fetchDeepSeekBalance() {
  return apiRequest('/api/providers/deepseek/balance');
}

export function fetchProviderCapabilities() {
  return apiRequest('/api/providers/capabilities');
}

export function checkProviderHealth(payload = {}) {
  return apiRequest('/api/providers/health', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
