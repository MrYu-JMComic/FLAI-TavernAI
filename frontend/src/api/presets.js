import { apiRequest } from './core.js';

export function fetchPresets() {
  return apiRequest('/api/presets');
}

export function createPreset(payload) {
  return apiRequest('/api/presets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchPreset(id) {
  return apiRequest(`/api/presets/${id}`);
}

export function updatePreset(id, payload) {
  return apiRequest(`/api/presets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deletePreset(id) {
  return apiRequest(`/api/presets/${id}`, {
    method: 'DELETE'
  });
}

export function setDefaultPreset(id) {
  return apiRequest(`/api/presets/${id}/set-default`, {
    method: 'POST'
  });
}
