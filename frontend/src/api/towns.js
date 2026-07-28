import { apiRequest } from './core.js';

function townPath(townId, suffix = '') {
  return `/api/towns/${encodeURIComponent(townId)}${suffix}`;
}

function residentPath(townId, residentId, suffix = '') {
  return townPath(townId, `/residents/${encodeURIComponent(residentId)}${suffix}`);
}

export function fetchTowns() {
  return apiRequest('/api/towns');
}

export function fetchTownSnapshot(townId, { eventLimit = 50 } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(Number(eventLimit)) && Number(eventLimit) > 0) {
    params.set('eventLimit', Math.floor(Number(eventLimit)));
  }
  const query = params.toString();
  return apiRequest(townPath(townId, `/snapshot${query ? `?${query}` : ''}`));
}

export function generateTown(payload) {
  return apiRequest('/api/towns/generate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTownClock(townId, payload) {
  return apiRequest(townPath(townId, '/clock'), {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function advanceTownWithAi(townId) {
  return apiRequest(townPath(townId, '/advance-ai'), {
    method: 'POST'
  });
}

export function fetchTownResidents(townId) {
  return apiRequest(townPath(townId, '/residents'));
}

export function fetchTownResidentCognition(townId, residentId) {
  return apiRequest(residentPath(townId, residentId, '/cognition'));
}

export function planTownResidentCognitionWithAi(townId, residentId) {
  return apiRequest(residentPath(townId, residentId, '/cognition-ai'), {
    method: 'POST'
  });
}

export function createTownEvent(townId, payload) {
  return apiRequest(townPath(townId, '/events'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function recallTownMemories(townId, residentId, { query = '', limit = 8 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.set('limit', Math.floor(Number(limit)));
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(residentPath(townId, residentId, `/memories/recall${suffix}`));
}
