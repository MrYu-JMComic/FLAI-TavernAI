import { apiRequest } from './core.js';

export function fetchTags({ limit } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.set('limit', Math.floor(Number(limit)));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/tags${suffix}`);
}

export function createTag(payload) {
  return apiRequest('/api/tags', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteTag(id) {
  return apiRequest(`/api/tags/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}
