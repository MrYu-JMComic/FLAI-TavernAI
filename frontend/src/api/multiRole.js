import { apiRequest } from './core.js';

function basePath(conversationId) {
  return `/api/conversations/${encodeURIComponent(String(conversationId || ''))}/multi-role`;
}

export function fetchMultiRoleState(conversationId) {
  return apiRequest(basePath(conversationId));
}

export function updateMultiRoleQueue(conversationId, memberIds) {
  return apiRequest(`${basePath(conversationId)}/queue`, {
    method: 'PUT',
    body: JSON.stringify({ memberIds }),
  });
}

export function generateMultiRole(conversationId, payload, options = {}) {
  return apiRequest(`${basePath(conversationId)}/generate`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
    signal: options.signal,
  });
}
