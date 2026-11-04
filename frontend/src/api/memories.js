import { apiRequest } from './core.js';

const base = (conversationId) => `/api/conversations/${encodeURIComponent(conversationId)}`;
const memoryBase = (conversationId) => `${base(conversationId)}/memories`;
const json = (method, payload = {}) => ({ method, body: JSON.stringify(payload) });

/** Review and retrieval share one request contract; scope parameters are always explicit. */
export function fetchConversationMemories(conversationId, options = {}) {
  const query = new URLSearchParams();
  if (options.includeArchived) query.set('includeArchived', '1');
  if (options.actorId) query.set('actorId', options.actorId);
  if (options.asOfMessageId) query.set('asOfMessageId', options.asOfMessageId);
  return apiRequest(`${memoryBase(conversationId)}${query.size ? `?${query}` : ''}`);
}

export function fetchMemoryConflicts(conversationId) { return apiRequest(`${memoryBase(conversationId)}/conflicts`); }
export function createConversationMemory(conversationId, payload) { return apiRequest(memoryBase(conversationId), json('POST', payload)); }
export function updateConversationMemory(conversationId, memoryId, payload) { return apiRequest(`${memoryBase(conversationId)}/${encodeURIComponent(memoryId)}`, json('PUT', payload)); }
export function confirmConversationMemory(conversationId, memoryId, revision) { return memoryAction(conversationId, memoryId, 'confirm', { revision }); }
export function disableConversationMemory(conversationId, memoryId, revision) { return memoryAction(conversationId, memoryId, 'disable', { revision }); }
export function rollbackConversationMemory(conversationId, memoryId, revision) { return memoryAction(conversationId, memoryId, 'rollback', { revision }); }
export function deleteConversationMemory(conversationId, memoryId, revision) { return apiRequest(`${memoryBase(conversationId)}/${encodeURIComponent(memoryId)}`, json('DELETE', { revision })); }
export function pinConversationMemory(conversationId, memoryId, payload) { return memoryAction(conversationId, memoryId, 'pin', payload); }
export function batchConversationMemories(conversationId, payload) { return apiRequest(`${memoryBase(conversationId)}/batch`, json('POST', payload)); }
export function mergeConversationMemories(conversationId, payload) { return apiRequest(`${memoryBase(conversationId)}/merge`, json('POST', payload)); }
export function undoMemoryMerge(conversationId, operationId) { return apiRequest(`${memoryBase(conversationId)}/merges/${encodeURIComponent(operationId)}/undo`, json('POST')); }

function memoryAction(conversationId, memoryId, action, payload) {
  return apiRequest(`${memoryBase(conversationId)}/${encodeURIComponent(memoryId)}/${action}`, json('POST', payload));
}

export function fetchConversationMemoryState(conversationId, options = {}) {
  const query = new URLSearchParams();
  if (options.actorId) query.set('actorId', options.actorId);
  if (options.asOfMessageId) query.set('asOfMessageId', options.asOfMessageId);
  return apiRequest(`${base(conversationId)}/memory-state${query.size ? `?${query}` : ''}`);
}

/** Author dossier targets are separate from the optional strict knowledge viewer. */
export function fetchConversationMemoryActors(conversationId, options = {}) {
  const query = new URLSearchParams();
  if (options.query) query.set('query', options.query);
  return apiRequest(`${base(conversationId)}/memory-state/actors${query.size ? `?${query}` : ''}`);
}

export function fetchConversationActorDossier(conversationId, actorId, options = {}) {
  const query = new URLSearchParams();
  if (options.viewerActorId) query.set('viewerActorId', options.viewerActorId);
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  return apiRequest(`${base(conversationId)}/memory-state/actors/${encodeURIComponent(actorId)}${query.size ? `?${query}` : ''}`);
}

export function reindexConversationMemory(conversationId, payload = {}) {
  return apiRequest(`${base(conversationId)}/memory-state/reindex`, json('POST', payload));
}

export function submitConversationMemoryPacket(conversationId, payload) {
  return apiRequest(`${base(conversationId)}/memory-state/packet`, json('POST', payload));
}

export function fetchConversationProcessing(conversationId) { return apiRequest(`${base(conversationId)}/processing`); }
export function rebuildConversationProcessing(conversationId, payload = {}) { return apiRequest(`${base(conversationId)}/processing/rebuild`, json('POST', payload)); }
