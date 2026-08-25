import { apiRequest, streamSSE } from './core.js';

export function fetchCastRoster(conversationId, options = {}) {
  const query = new URLSearchParams();
  if (options.includeHidden === false) query.set('includeHidden', 'false');
  return apiRequest(withQuery(castPath(conversationId), query));
}

export function createCastMember(conversationId, payload) {
  return mutate(castPath(conversationId), 'POST', payload);
}

export function cleanupCastMembers(conversationId) {
  return mutate(`${castPath(conversationId)}/cleanup`, 'POST', {});
}

export function fetchCastMember(conversationId, memberId) {
  return apiRequest(memberPath(conversationId, memberId));
}

export function updateCastMember(conversationId, memberId, payload) {
  return mutate(memberPath(conversationId, memberId), 'PATCH', payload);
}

export function fetchCastMemories(conversationId, memberId, options = {}) {
  const query = listQuery(options, 200);
  if (options.includeForgotten === true) query.set('includeForgotten', 'true');
  return apiRequest(withQuery(`${memberPath(conversationId, memberId)}/memories`, query));
}

export function createCastMemory(conversationId, memberId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/memories`, 'POST', payload);
}

export function updateCastMemory(conversationId, memberId, memoryId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/memories/${encodeId(memoryId)}`, 'PATCH', payload);
}

export function deleteCastMemory(conversationId, memberId, memoryId, revision) {
  return mutate(
    `${memberPath(conversationId, memberId)}/memories/${encodeId(memoryId)}`,
    'DELETE',
    { revision }
  );
}

export function fetchCastBehaviors(conversationId, memberId) {
  return apiRequest(`${memberPath(conversationId, memberId)}/behaviors`);
}

export function createCastBehavior(conversationId, memberId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/behaviors`, 'POST', payload);
}

export function updateCastBehavior(conversationId, memberId, behaviorId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/behaviors/${encodeId(behaviorId)}`, 'PATCH', payload);
}

export function deleteCastBehavior(conversationId, memberId, behaviorId, revision) {
  return mutate(
    `${memberPath(conversationId, memberId)}/behaviors/${encodeId(behaviorId)}`,
    'DELETE',
    { revision }
  );
}

export function fetchCastItems(conversationId, memberId, options = {}) {
  return apiRequest(withQuery(
    `${memberPath(conversationId, memberId)}/items`,
    listQuery(options, 300)
  ));
}

export function createCastItem(conversationId, memberId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/items`, 'POST', payload);
}

export function updateCastItem(conversationId, memberId, itemId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/items/${encodeId(itemId)}`, 'PATCH', payload);
}

export function transferCastItem(conversationId, memberId, itemId, payload) {
  return mutate(
    `${memberPath(conversationId, memberId)}/items/${encodeId(itemId)}/transfer`,
    'POST',
    payload
  );
}

export function deleteCastItem(conversationId, memberId, itemId, revision) {
  return mutate(
    `${memberPath(conversationId, memberId)}/items/${encodeId(itemId)}`,
    'DELETE',
    { revision }
  );
}

export function updateCastAppearance(conversationId, memberId, payload) {
  return mutate(`${memberPath(conversationId, memberId)}/appearance`, 'PATCH', payload);
}

export function fetchCastAudit(conversationId, memberId, options = {}) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', boundedInteger(options.limit, 1, 100));
  if (options.beforeCreatedAt && options.beforeId) {
    query.set('beforeCreatedAt', String(options.beforeCreatedAt));
    query.set('beforeId', String(options.beforeId));
  }
  return apiRequest(withQuery(`${memberPath(conversationId, memberId)}/audit`, query));
}

export function rollbackCastAudit(conversationId, eventId) {
  return mutate(`${castPath(conversationId)}/audit/${encodeId(eventId)}/rollback`, 'POST', {});
}

export function streamCastOrganization(conversationId, payload, handlers, signal) {
  return streamSSE(
    `${castPath(conversationId)}/organize`,
    payload,
    handlers,
    signal,
    { throwOnError: true, includeStreamFlag: false, method: 'POST' }
  );
}

export function streamCastSync(conversationId, handlers, signal) {
  return streamSSE(
    `${castPath(conversationId)}/sync-events`,
    null,
    handlers,
    signal,
    { includeStreamFlag: false, method: 'GET' }
  );
}

function mutate(path, method, payload) {
  return apiRequest(path, { method, body: JSON.stringify(payload) });
}

function castPath(conversationId) {
  return `/api/conversations/${encodeId(conversationId)}/cast`;
}

function memberPath(conversationId, memberId) {
  return `${castPath(conversationId)}/${encodeId(memberId)}`;
}

function encodeId(value) {
  return encodeURIComponent(String(value || '').trim());
}

function listQuery(options, maximum) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', boundedInteger(options.limit, 1, maximum));
  if (options.offset !== undefined) query.set('offset', boundedInteger(options.offset, 0, 100_000));
  return query;
}

function boundedInteger(value, minimum, maximum) {
  const numeric = Number(value);
  const fallback = minimum;
  return String(Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? Math.round(numeric) : fallback)));
}

function withQuery(path, query) {
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}
