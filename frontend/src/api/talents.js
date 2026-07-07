import { apiRequest } from './core.js';

export function fetchTalentPools() {
  return apiRequest('/api/talent-pools');
}

export function createTalentPool(payload) {
  return apiRequest('/api/talent-pools', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTalentPool(id, payload) {
  return apiRequest(`/api/talent-pools/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteTalentPool(id) {
  return apiRequest(`/api/talent-pools/${id}`, {
    method: 'DELETE'
  });
}
