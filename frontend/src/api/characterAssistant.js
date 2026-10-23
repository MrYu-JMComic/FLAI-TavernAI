import { apiRequest } from './core.js';

const sessionPath = '/api/character-assistant/sessions';

export async function fetchCharacterAssistantSessions(characterId = '') {
  const params = characterId
    ? new URLSearchParams({ characterId })
    : new URLSearchParams({ unbound: 'true' });
  const result = await apiRequest(`${sessionPath}?${params}`, { cache: 'no-store' });
  return Array.isArray(result) ? result : result.sessions || [];
}

export async function createCharacterAssistantSession(payload) {
  const result = await apiRequest(sessionPath, { method: 'POST', body: JSON.stringify(payload) });
  return result.session || result;
}

export async function fetchCharacterAssistantSession(id) {
  const result = await apiRequest(`${sessionPath}/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return result.session || result;
}

export async function updateCharacterAssistantSession(id, payload) {
  const result = await apiRequest(`${sessionPath}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  return result.session || result;
}

export function deleteCharacterAssistantSession(id) {
  return apiRequest(`${sessionPath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fetchCharacterAssistantVersions(id) {
  return apiRequest(`${sessionPath}/${encodeURIComponent(id)}/versions`, { cache: 'no-store' });
}

export function restoreCharacterAssistantVersion(id, versionId) {
  return apiRequest(`${sessionPath}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' });
}

export function resetCharacterAssistantDraftFromSavedCharacter(id) {
  return apiRequest(`${sessionPath}/${encodeURIComponent(id)}/reset-draft-from-character`, { method: 'POST' });
}

export const createAssistantSession = createCharacterAssistantSession;
export const updateAssistantSession = updateCharacterAssistantSession;
export const fetchAssistantSession = fetchCharacterAssistantSession;
export const deleteAssistantSession = deleteCharacterAssistantSession;
export function fetchAssistantSessions({ characterId = '' } = {}) {
  return fetchCharacterAssistantSessions(characterId);
}
