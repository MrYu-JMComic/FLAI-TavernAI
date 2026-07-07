import { apiRequest } from './core.js';

export function fetchMods() {
  return apiRequest('/api/mods');
}

export function createMod(payload) {
  return apiRequest('/api/mods', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateMod(id, payload) {
  return apiRequest(`/api/mods/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteMod(id) {
  return apiRequest(`/api/mods/${id}`, {
    method: 'DELETE'
  });
}

export function reorderMods(order) {
  return apiRequest('/api/mods/order', {
    method: 'PUT',
    body: JSON.stringify({ order })
  });
}
