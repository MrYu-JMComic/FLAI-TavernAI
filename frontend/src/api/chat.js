import { apiRequest, streamAssistantDraft, streamSSE } from './core.js';

export function fetchConversations({ characterId = '' } = {}) {
  const params = new URLSearchParams();
  if (characterId) {
    params.set('characterId', characterId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations${suffix}`);
}

export function createConversation(characterId) {
  return apiRequest('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ characterId })
  });
}

export function deleteConversation(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}`, {
    method: 'DELETE'
  });
}

export function deleteConversations(ids) {
  return apiRequest('/api/conversations/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });
}

export function fetchConversationMessages(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/messages`);
}

export function fetchConversationBranches(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/branches`);
}

export function fetchConversationBranchTree(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/branches/tree`);
}

export function previewConversationContext(conversationId, payload = {}) {
  return apiRequest(`/api/conversations/${conversationId}/context/preview`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function branchConversation(conversationId, messageId) {
  return apiRequest(`/api/conversations/${conversationId}/branch`, {
    method: 'POST',
    body: JSON.stringify({ messageId })
  });
}

export function fetchMessageSwipes(_conversationId, messageId) {
  return apiRequest(`/api/messages/${messageId}/swipes`);
}

export function createMessageSwipe(_conversationId, messageId, payload = {}) {
  return apiRequest(`/api/messages/${messageId}/swipes`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchConversationSettings(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/settings`);
}

export function saveConversationSettings(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchConversationAccessorySkills(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/accessory-skills`);
}

export function saveConversationAccessorySkills(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/accessory-skills`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchConversationMemories(conversationId, options = {}) {
  const params = new URLSearchParams();
  if (options.includeArchived) {
    params.set('includeArchived', '1');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/memories${suffix}`);
}

export function createConversationMemory(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/memories`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateConversationMemory(conversationId, memoryId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/memories/${memoryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function confirmConversationMemory(conversationId, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/memories/${memoryId}/confirm`, {
    method: 'POST'
  });
}

export function disableConversationMemory(conversationId, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/memories/${memoryId}/disable`, {
    method: 'POST'
  });
}

export function rollbackConversationMemory(conversationId, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/memories/${memoryId}/rollback`, {
    method: 'POST'
  });
}

export function deleteConversationMemory(conversationId, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/memories/${memoryId}`, {
    method: 'DELETE'
  });
}

export function fetchSaves(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/saves`);
}

export function createSave(conversationId, payload = {}) {
  return apiRequest(`/api/conversations/${conversationId}/saves`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchSave(saveId) {
  return apiRequest(`/api/saves/${saveId}`);
}

export function loadSave(saveId, conversationId = '') {
  return apiRequest(`/api/saves/${saveId}/load`, {
    method: 'POST',
    body: JSON.stringify({ conversationId })
  });
}

export function renameSave(saveId, name, conversationId = '') {
  return apiRequest(`/api/saves/${saveId}`, {
    method: 'PUT',
    body: JSON.stringify({ name, conversationId })
  });
}

export function deleteSave(saveId, conversationId = '') {
  return apiRequest(`/api/saves/${saveId}`, {
    method: 'DELETE',
    body: JSON.stringify({ conversationId })
  });
}

export function updateMessage(conversationId, messageId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteMessage(conversationId, messageId) {
  return apiRequest(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'DELETE'
  });
}

export function sendMessage(conversationId, payload, signal) {
  return apiRequest(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, stream: false }),
    signal
  });
}

export function streamMessage(conversationId, payload, handlers = {}, signal) {
  return streamSSE(`/api/conversations/${conversationId}/messages`, payload, handlers, signal);
}

export function continueMessage(conversationId, payload = {}, signal) {
  return apiRequest(`/api/conversations/${conversationId}/messages/continue`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, stream: false }),
    signal
  });
}

export function streamContinueMessage(conversationId, payload = {}, handlers = {}, signal) {
  return streamSSE(`/api/conversations/${conversationId}/messages/continue`, payload, handlers, signal);
}

export function fetchConversationEconomy(conversationId, options = {}) {
  const params = new URLSearchParams();
  if (options.ensure === false) {
    params.set('ensure', '0');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/economy${suffix}`);
}

export function createEconomyTransaction(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/economy/transaction`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchEconomyHistory(conversationId, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  if (params.currencyType) query.set('currencyType', params.currencyType);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/economy/history${suffix}`);
}

export function fetchStatusBar(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`);
}

export function saveStatusBar(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteStatusBar(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`, {
    method: 'DELETE'
  });
}

export function fetchConversationNpcs(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs`);
}

export function streamNpcOrganizer(conversationId, payload, handlers = {}, signal) {
  return streamAssistantDraft(`/api/conversations/${conversationId}/npcs/organize`, payload, handlers, signal);
}

export function hideConversationNpc(conversationId, npcName) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}`, {
    method: 'DELETE'
  });
}

export function hideEmptyConversationNpcs(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs-empty`, {
    method: 'DELETE'
  });
}

export function updateConversationNpc(conversationId, npcName, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchNpcAudit(conversationId, npcName, options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit);
  if (options.offset) params.set('offset', options.offset);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/audit${suffix}`);
}

export function rollbackNpcAudit(conversationId, npcName, auditId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/audit/${auditId}/rollback`, {
    method: 'POST'
  });
}

export function fetchNpcMemories(conversationId, npcName) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories`);
}

export function addNpcMemory(conversationId, npcName, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateNpcMemory(conversationId, npcName, memoryId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories/${memoryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteNpcMemory(conversationId, npcName, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories/${memoryId}`, {
    method: 'DELETE'
  });
}

export function fetchNpcBehaviors(conversationId, npcName) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors`);
}

export function addNpcBehavior(conversationId, npcName, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateNpcBehavior(conversationId, npcName, behaviorId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors/${behaviorId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteNpcBehavior(conversationId, npcName, behaviorId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors/${behaviorId}`, {
    method: 'DELETE'
  });
}
