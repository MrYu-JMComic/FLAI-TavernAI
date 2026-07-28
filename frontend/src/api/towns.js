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

export function createTown(payload) {
  return apiRequest('/api/towns', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
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

export function advanceTown(townId, { steps = 1 } = {}) {
  return apiRequest(townPath(townId, '/advance'), {
    method: 'POST',
    body: JSON.stringify({ steps })
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

export function createTownResident(townId, payload) {
  return apiRequest(townPath(townId, '/residents'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchTownResidentCognition(townId, residentId) {
  return apiRequest(residentPath(townId, residentId, '/cognition'));
}

export function planTownResidentCognitionWithAi(townId, residentId) {
  return apiRequest(residentPath(townId, residentId, '/cognition-ai'), {
    method: 'POST'
  });
}

export function fetchTownEvents(townId, { limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    params.set('limit', Math.floor(Number(limit)));
  }
  const query = params.toString();
  return apiRequest(townPath(townId, `/events${query ? `?${query}` : ''}`));
}

export function createTownEvent(townId, payload) {
  return apiRequest(townPath(townId, '/events'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function createTownMemory(townId, residentId, payload) {
  return apiRequest(residentPath(townId, residentId, '/memories'), {
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

export function fetchTownReflectionStatus(townId, residentId) {
  return apiRequest(residentPath(townId, residentId, '/reflection-status'));
}

export function createTownReflection(townId, residentId, payload) {
  return apiRequest(residentPath(townId, residentId, '/reflections'), {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchTownSchedule(townId, residentId, day) {
  return apiRequest(residentPath(townId, residentId, `/schedules/${encodeURIComponent(day)}`));
}

export function saveTownSchedule(townId, residentId, day, payload) {
  return apiRequest(residentPath(townId, residentId, `/schedules/${encodeURIComponent(day)}`), {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}
