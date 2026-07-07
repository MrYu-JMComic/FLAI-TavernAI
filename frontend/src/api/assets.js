import { apiRequest } from './core.js';

export function fetchAssets(options = {}) {
  const params = new URLSearchParams();
  if (options.kind) {
    params.set('kind', options.kind);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/assets${suffix}`);
}

export function createAsset(payload) {
  return apiRequest('/api/assets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteAsset(id) {
  return apiRequest(`/api/assets/${id}`, {
    method: 'DELETE'
  });
}
