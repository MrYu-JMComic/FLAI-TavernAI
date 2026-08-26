import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { recordAutomationAudit } from '../services/automationAudit.js';

const EVENT_LIMIT_DEFAULT = 30;
const EVENT_LIMIT_MAX = 100;
const EVENT_SEVERITIES = new Set(['info', 'success', 'warning', 'danger']);

export function recordWorldEvent(database, userId, conversationId, payload = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const event = normalizeWorldEvent(payload);
  const id = newId();
  const createdAt = normalizeCreatedAt(payload.createdAt);
  database.prepare(
    `INSERT INTO world_events (
       id, conversation_id, event_type, source, title, detail,
       entity_type, entity_id, severity, payload_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    event.eventType,
    event.source,
    event.title,
    event.detail,
    event.entityType,
    event.entityId,
    event.severity,
    JSON.stringify(event.payload),
    createdAt
  );
  const created = readWorldEvent(database, userId, conversationId, id);
  if (isAutomatedSource(event.source)) {
    recordAutomationAudit(database, userId, {
      domain: auditDomain(event.eventType),
      operation: event.eventType,
      subjectType: event.entityType || 'conversation',
      subjectId: event.entityId || conversationId,
      sourceMessageId: event.payload.sourceMessageId,
      jobId: event.payload.jobId,
      providerType: event.payload.providerType,
      model: event.payload.model,
      planSummary: event.title || event.detail,
      before: event.payload.before,
      after: event.payload.after ?? event.payload,
      rollbackOfId: event.payload.rollbackOfId
    });
  }
  return created;
}

export function listWorldEvents(database, userId, conversationId, options = {}) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const limit = normalizeLimit(options.limit);
  const afterCursor = normalizeCursor(options.afterCursor);
  const eventType = normalizeText(options.eventType, 80);
  const conditions = ['conversation_id = ?'];
  const params = [conversationId];
  if (afterCursor > 0) {
    conditions.push('rowid > ?');
    params.push(afterCursor);
  }
  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }
  const direction = afterCursor > 0 ? 'ASC' : 'DESC';
  const rows = database.prepare(
    `SELECT rowid AS cursor, * FROM world_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY rowid ${direction}
     LIMIT ?`
  ).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  if (hasMore) rows.length = limit;
  const events = rows.map(toWorldEvent);
  let latestCursor = afterCursor;
  for (const event of events) {
    if (event.cursor > latestCursor) latestCursor = event.cursor;
  }
  return {
    events,
    hasMore,
    nextCursor: events.length ? events[events.length - 1].cursor : afterCursor,
    latestCursor
  };
}

export function deleteConversationWorldEvents(database, userId, conversationId) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const result = database.prepare('DELETE FROM world_events WHERE conversation_id = ?').run(conversationId);
  return { deleted: result.changes };
}

function readWorldEvent(database, userId, conversationId, eventId) {
  if (!hasConversationAccess(database, userId, conversationId)) return null;
  const row = database.prepare(
    'SELECT rowid AS cursor, * FROM world_events WHERE conversation_id = ? AND id = ?'
  ).get(conversationId, eventId);
  return row ? toWorldEvent(row) : null;
}

function hasConversationAccess(database, userId, conversationId) {
  return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId));
}

function normalizeWorldEvent(payload) {
  return {
    eventType: normalizeText(payload.eventType, 80) || 'world.changed',
    source: normalizeText(payload.source, 40) || 'system',
    title: normalizeText(payload.title, 200),
    detail: normalizeText(payload.detail, 2000),
    entityType: normalizeText(payload.entityType, 60),
    entityId: normalizeText(payload.entityId, 160),
    severity: EVENT_SEVERITIES.has(payload.severity) ? payload.severity : 'info',
    payload: normalizePayload(payload.payload)
  };
}

function toWorldEvent(row) {
  return {
    cursor: Number(row.cursor || 0),
    id: row.id,
    conversationId: row.conversation_id,
    eventType: row.event_type,
    source: row.source,
    title: row.title,
    detail: row.detail,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeCreatedAt(value) {
  const text = String(value || '').trim();
  return text && !Number.isNaN(Date.parse(text)) ? text : nowIso();
}

function normalizeCursor(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return EVENT_LIMIT_DEFAULT;
  return Math.min(EVENT_LIMIT_MAX, Math.max(1, Math.trunc(number)));
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isAutomatedSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return source && source !== 'manual' && source !== 'player' && !source.startsWith('user:');
}

function auditDomain(eventType) {
  if (eventType.startsWith('economy.')) return 'economy';
  if (eventType.startsWith('quest.')) return 'task';
  if (eventType.startsWith('cast.')) return 'cast';
  return 'world';
}
