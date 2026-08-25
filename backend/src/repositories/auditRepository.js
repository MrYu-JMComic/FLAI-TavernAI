import { parseCastJson } from '../domain/cast/normalization.js';

export function insertCastAuditEvent(database, event) {
  database.prepare(
    `INSERT INTO conversation_audit_events (
       id, conversation_id, batch_id, member_id, subject_type, subject_id,
       action, actor, before_json, after_json, before_revision, after_revision,
       rollback_of_event_id, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.conversationId,
    event.batchId || null,
    event.memberId || null,
    event.subjectType,
    event.subjectId || '',
    event.action,
    event.actor,
    JSON.stringify(event.before ?? null),
    JSON.stringify(event.after ?? null),
    event.beforeRevision ?? null,
    event.afterRevision ?? null,
    event.rollbackOfEventId || null,
    JSON.stringify(event.metadata || {}),
    event.createdAt
  );
  return getCastAuditEvent(database, event.conversationId, event.id);
}

export function getCastAuditEvent(database, conversationId, eventId) {
  const row = database.prepare(
    `SELECT * FROM conversation_audit_events
     WHERE conversation_id = ? AND id = ?`
  ).get(conversationId, eventId);
  return row ? toCastAuditEvent(row) : null;
}

export function listCastAuditEvents(database, conversationId, options = {}) {
  const memberId = String(options.memberId || '');
  const limit = Math.max(1, Number(options.limit || 50));
  const beforeCreatedAt = String(options.beforeCreatedAt || '');
  const beforeId = String(options.beforeId || '');
  const rows = database.prepare(
    `SELECT * FROM conversation_audit_events
     WHERE conversation_id = ?
       AND (? = '' OR member_id = ?)
       AND (
         ? = ''
         OR created_at < ?
         OR (created_at = ? AND id < ?)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).all(
    conversationId,
    memberId,
    memberId,
    beforeCreatedAt,
    beforeCreatedAt,
    beforeCreatedAt,
    beforeId,
    limit + 1
  ).map(toCastAuditEvent);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export function findRollbackForEvent(database, conversationId, eventId) {
  const row = database.prepare(
    `SELECT * FROM conversation_audit_events
     WHERE conversation_id = ? AND rollback_of_event_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(conversationId, eventId);
  return row ? toCastAuditEvent(row) : null;
}

function toCastAuditEvent(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    batchId: row.batch_id || '',
    memberId: row.member_id || '',
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    action: row.action,
    actor: row.actor,
    before: parseCastJson(row.before_json, null),
    after: parseCastJson(row.after_json, null),
    beforeRevision: row.before_revision,
    afterRevision: row.after_revision,
    rollbackOfEventId: row.rollback_of_event_id || '',
    metadata: parseCastJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}
