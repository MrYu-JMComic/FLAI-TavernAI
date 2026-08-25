const latestStatusByConversation = new Map();
const listenersByConversation = new Map();

export function publishCastSyncStatus(conversationId, status = {}) {
  const id = String(conversationId || '').trim();
  if (!id) return null;
  const event = Object.freeze({
    conversationId: id,
    status: normalizeStatus(status.status),
    messageId: String(status.messageId || ''),
    summary: String(status.summary || '').slice(0, 500),
    error: String(status.error || '').slice(0, 500),
    code: String(status.code || '').slice(0, 100),
    details: normalizeDetails(status.details),
    repairAttempted: status.repairAttempted === true,
    applied: Math.max(0, Number(status.applied || 0)),
    at: new Date().toISOString(),
  });
  latestStatusByConversation.set(id, event);
  const listeners = listenersByConversation.get(id);
  if (listeners) {
    for (const listener of listeners) listener(event);
  }
  return event;
}

function normalizeDetails(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.slice(0, 20).map((issue) => Object.freeze({
    path: String(issue?.path || '').slice(0, 300),
    message: String(issue?.message || '').slice(0, 500),
  })));
}

export function getLatestCastSyncStatus(conversationId) {
  return latestStatusByConversation.get(String(conversationId || '').trim()) || null;
}

export function subscribeCastSyncStatus(conversationId, listener) {
  const id = String(conversationId || '').trim();
  if (!id || typeof listener !== 'function') return () => {};
  let listeners = listenersByConversation.get(id);
  if (!listeners) {
    listeners = new Set();
    listenersByConversation.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) listenersByConversation.delete(id);
  };
}

export function clearCastSyncStatusForTests() {
  latestStatusByConversation.clear();
  listenersByConversation.clear();
}

function normalizeStatus(value) {
  return ['queued', 'running', 'applied', 'skipped', 'error'].includes(value)
    ? value
    : 'error';
}
