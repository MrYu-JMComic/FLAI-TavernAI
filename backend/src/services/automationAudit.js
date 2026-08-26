import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { createCursorScope, decodeCursor, encodeCursor } from './cursorPagination.js';

export function recordAutomationAudit(database, userId, event = {}) {
  const id = newId();
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO automation_audit_events (
       id, user_id, domain, operation, subject_type, subject_id, source_message_id,
       job_id, provider_type, model, plan_summary, before_json, after_json,
       rollback_of_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    text(event.domain, 80) || 'unknown',
    text(event.operation, 120) || 'change',
    text(event.subjectType, 120),
    text(event.subjectId, 200),
    text(event.sourceMessageId, 200),
    text(event.jobId, 200),
    text(event.providerType, 80),
    text(event.model, 200),
    text(event.planSummary, 4000),
    serialize(event.before),
    serialize(event.after),
    text(event.rollbackOfId, 200),
    timestamp
  );
  return getAutomationAudit(database, userId, id);
}

export function getAutomationAudit(database, userId, id) {
  const row = database.prepare(
    'SELECT * FROM automation_audit_events WHERE id = ? AND user_id = ?'
  ).get(id, userId);
  return row ? toAuditEvent(row) : null;
}

export function listAutomationAudit(database, userId, options = {}) {
  const limit = clampInteger(options.limit, 1, 200, 50);
  const scope = createCursorScope('automation-audit', {
    userId: String(userId || ''),
    domain: String(options.domain || '')
  });
  const cursor = decodeCursor(options.cursor, scope, { values: 2 });
  const values = [];
  const clauses = [];
  if (userId) {
    clauses.push('user_id = ?');
    values.push(userId);
  }
  if (options.domain) {
    clauses.push('domain = ?');
    values.push(text(options.domain, 80));
  }
  if (cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  values.push(limit + 1);
  const rows = database.prepare(
    `SELECT * FROM automation_audit_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(...values);
  const hasMore = rows.length > limit;
  const events = (hasMore ? rows.slice(0, limit) : rows).map(toAuditEvent);
  return {
    events,
    nextCursor: hasMore && events.length
      ? encodeCursor(scope, [events.at(-1).createdAt, events.at(-1).id])
      : ''
  };
}

function toAuditEvent(row) {
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain,
    operation: row.operation,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    sourceMessageId: row.source_message_id,
    jobId: row.job_id,
    providerType: row.provider_type,
    model: row.model,
    planSummary: row.plan_summary,
    before: parseJson(row.before_json, {}),
    after: parseJson(row.after_json, {}),
    rollbackOfId: row.rollback_of_id,
    createdAt: row.created_at
  };
}

function serialize(value) {
  const json = JSON.stringify(value ?? {});
  return json.length <= 200_000 ? json : JSON.stringify({ truncated: true, bytes: Buffer.byteLength(json) });
}

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}
