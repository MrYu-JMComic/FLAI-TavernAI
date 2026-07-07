import { apiRequest, streamAssistantDraft } from './core.js';

export function fetchCharacters({ search = '', sort = 'created', tag = '' } = {}) {
  const params = new URLSearchParams({ search, sort, tag });
  return apiRequest(`/api/characters?${params.toString()}`, { cache: 'no-store' });
}

export function fetchCharacter(id) {
  return apiRequest(`/api/characters/${id}`);
}

export function createCharacter(payload) {
  return apiRequest('/api/characters', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCharacter(id, payload) {
  return apiRequest(`/api/characters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteCharacter(id) {
  return apiRequest(`/api/characters/${id}`, {
    method: 'DELETE'
  });
}

export function fetchCharacterWorldBooks(characterId) {
  return apiRequest(`/api/characters/${characterId}/world-books`);
}

export function linkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books`, {
    method: 'POST',
    body: JSON.stringify({ worldBookId })
  });
}

export function unlinkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books/${worldBookId}`, {
    method: 'DELETE'
  });
}

export function completeCharacterDraft(payload) {
  return apiRequest('/api/characters/complete-draft', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function streamCharacterDraft(payload, handlers = {}, signal) {
  return streamAssistantDraft('/api/characters/complete-draft', payload, handlers, signal);
}

export function setCharacterFavorite(id, favorited) {
  return apiRequest(`/api/characters/${id}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorited })
  });
}

export function setCharacterLike(id, liked) {
  return apiRequest(`/api/characters/${id}/like`, {
    method: 'PUT',
    body: JSON.stringify({ liked })
  });
}

export function fetchCharacterImages(characterId) {
  return apiRequest(`/api/characters/${characterId}/images`);
}

export function createCharacterImage(characterId, payload) {
  return apiRequest(`/api/characters/${characterId}/images`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCharacterImage(characterId, imageId, payload) {
  return apiRequest(`/api/characters/${characterId}/images/${imageId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteCharacterImage(characterId, imageId) {
  return apiRequest(`/api/characters/${characterId}/images/${imageId}`, {
    method: 'DELETE'
  });
}

export function reorderCharacterImages(characterId, orderedIds) {
  return apiRequest(`/api/characters/${characterId}/images/order`, {
    method: 'PUT',
    body: JSON.stringify({ orderedIds })
  });
}

export function saveCharacterAccessorySkills(characterId, payload) {
  return apiRequest(`/api/characters/${characterId}/accessory-skills`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function rollCharacterTalent(characterId, poolId) {
  return apiRequest(`/api/characters/${characterId}/roll-talent`, {
    method: 'POST',
    body: JSON.stringify({ poolId })
  });
}

export function fetchCharacterTalents(characterId) {
  return apiRequest(`/api/characters/${characterId}/talents`);
}

export function deleteCharacterTalent(characterId, talentId) {
  return apiRequest(`/api/characters/${characterId}/talents/${talentId}`, {
    method: 'DELETE'
  });
}

export function deleteAllCharacterTalents(characterId) {
  return apiRequest(`/api/characters/${characterId}/talents`, {
    method: 'DELETE'
  });
}
