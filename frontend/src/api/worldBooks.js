import { apiRequest, streamAssistantDraft } from './core.js';

export function fetchWorldBooks() {
  return apiRequest('/api/world-books', { cache: 'no-store' });
}

export function completeWorldBookDraft(payload) {
  return apiRequest('/api/world-books/complete-draft', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function streamWorldBookDraft(payload, handlers = {}, signal) {
  return streamAssistantDraft('/api/world-books/complete-draft', payload, handlers, signal);
}

export function createWorldBook(payload) {
  return apiRequest('/api/world-books', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchWorldBook(id) {
  return apiRequest(`/api/world-books/${id}`);
}

export function previewWorldBookMatches(id, payload = {}) {
  return apiRequest(`/api/world-books/${id}/match-preview`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateWorldBook(id, payload) {
  return apiRequest(`/api/world-books/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteWorldBook(id) {
  return apiRequest(`/api/world-books/${id}`, {
    method: 'DELETE'
  });
}

export function createWorldBookEntry(bookId, payload) {
  return apiRequest(`/api/world-books/${bookId}/entries`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateWorldBookEntry(bookId, entryId, payload) {
  return apiRequest(`/api/world-books/${bookId}/entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteWorldBookEntry(bookId, entryId) {
  return apiRequest(`/api/world-books/${bookId}/entries/${entryId}`, {
    method: 'DELETE'
  });
}
