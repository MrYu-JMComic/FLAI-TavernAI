import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { parseJson } from '../../utils/json.js';
import { assertAiJobQuota } from '../quotas.js';
import { createCursorScope, decodeCursor, encodeCursor } from '../cursorPagination.js';

export const PUBLIC_JOB_TYPES = Object.freeze([
  'town.generate',
  'cast.organize',
  'memory.extract',
  'world-book.assist'
]);
export const CONVERSATION_POSTPROCESS_JOB = 'conversation.postprocess';
export const JOB_TYPES = Object.freeze([...PUBLIC_JOB_TYPES, CONVERSATION_POSTPROCESS_JOB]);
export const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const JOB_TYPE_SET = new Set(JOB_TYPES);
const MAX_JOB_PAYLOAD_BYTES = 100_000;

export function submitJob(database, userId, type, payload = {}, options = {}) {
  const normalizedType = normalizeJobType(type);
  if (normalizedType === CONVERSATION_POSTPROCESS_JOB && options.internal !== true) {
    throw jobError('This job type is scheduled by the conversation pipeline.', 'JOB_TYPE_INTERNAL', 400);
  }
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  if (!idempotencyKey) {
    throw jobError('An Idempotency-Key is required.', 'JOB_IDEMPOTENCY_REQUIRED', 400);
  }
  const existing = findIdempotentJob(database, userId, normalizedType, idempotencyKey);
  if (existing) {
    return { ...existing, deduplicated: true };
  }
  if (options.internal !== true) assertAiJobQuota(database, userId);

  const boundPayload = bindConversationPayload(database, userId, normalizedType, payload);
  const payloadJson = serializePayload(boundPayload);
  const id = newId();
  const timestamp = nowIso();
  try {
    withSavepoint(database, 'sp_submit_job', () => {
      database.prepare(
        `INSERT INTO jobs (
           id, user_id, type, status, payload_json, idempotency_key,
           max_attempts, created_at, updated_at, serial_key
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        userId,
        normalizedType,
        payloadJson,
        idempotencyKey,
        clampInteger(options.maxAttempts, 1, 10, 3),
        timestamp,
        timestamp,
        String(boundPayload?.conversationId || '').trim() ? conversationJobKey(userId, boundPayload.conversationId) : ''
      );
      appendJobEvent(database, id, userId, 'queued', { progress: 0 });
    });
  } catch (error) {
    const raced = findIdempotentJob(database, userId, normalizedType, idempotencyKey);
    if (raced) {
      return { ...raced, deduplicated: true };
    }
    throw error;
  }
  return getJob(database, userId, id);
}

export function getJob(database, userId, jobId) {
  const row = database.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
  return row ? toJob(row) : null;
}

export function listJobs(database, userId, options = {}) {
  const limit = clampInteger(options.limit, 1, 100, 30);
  const status = normalizeStatusFilter(options.status);
  const scope = createCursorScope('jobs', { userId, status });
  const cursor = decodeCursor(options.cursor, scope, { values: 2 });
  const values = [userId];
  let where = 'user_id = ?';
  if (status) {
    where += ' AND status = ?';
    values.push(status);
  }
  if (cursor) {
    where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  values.push(limit + 1);
  const rows = database.prepare(
    `SELECT * FROM jobs WHERE ${where}
     ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(...values);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const jobs = pageRows.map(toJob);
  return {
    jobs,
    nextCursor: hasMore && jobs.length
      ? encodeCursor(scope, [jobs.at(-1).createdAt, jobs.at(-1).id])
      : ''
  };
}

export function listJobEvents(database, userId, jobId, options = {}) {
  if (!getJob(database, userId, jobId)) return null;
  const after = Math.max(0, Number(options.after || 0));
  const limit = clampInteger(options.limit, 1, 500, 100);
  return database.prepare(
    `SELECT id, event_type, data_json, created_at
     FROM job_events
     WHERE job_id = ? AND user_id = ? AND id > ?
     ORDER BY id ASC LIMIT ?`
  ).all(jobId, userId, after, limit).map((row) => ({
    id: row.id,
    type: row.event_type,
    data: parseJson(row.data_json, {}),
    createdAt: row.created_at
  }));
}

export function claimNextJob(database, workerId, options = {}) {
  const leaseMs = clampInteger(options.leaseMs, 5_000, 15 * 60_000, 60_000);
  const now = Number(options.now || Date.now());
  recoverExpiredJobs(database, now);
  return withSavepoint(database, 'sp_claim_job', () => {
    const types = normalizeWorkerTypes(options.types);
    const typeFilter = types.length ? ` AND type IN (${types.map(() => '?').join(', ')})` : '';
    const row = database.prepare(
      `SELECT id, user_id FROM jobs candidate
       WHERE status = 'queued' AND cancel_requested = 0 AND attempt < max_attempts${typeFilter}
         AND (serial_key = '' OR NOT EXISTS (
           SELECT 1 FROM conversations c WHERE c.id = json_extract(candidate.payload_json, '$.conversationId')
             AND c.active_generation_id <> '' AND c.generation_expires_at > ?
             AND (candidate.type <> 'conversation.postprocess' OR c.active_generation_id NOT LIKE 'chat:%'
               OR json_extract(candidate.payload_json, '$.replayLore') = 1)
         ))
         AND (serial_key = '' OR NOT EXISTS (
           SELECT 1 FROM jobs prior WHERE prior.user_id = candidate.user_id
             AND prior.serial_key = candidate.serial_key AND prior.id <> candidate.id
             AND (prior.status = 'running' OR (prior.rowid < candidate.rowid
               AND prior.cancel_requested = 0 AND prior.status = 'queued'))
         ))
       ORDER BY created_at ASC, rowid ASC LIMIT 1`
    ).get(...types, now);
    if (!row) return null;
    const timestamp = nowIso();
    const update = database.prepare(
      `UPDATE jobs
       SET status = 'running', attempt = attempt + 1, lease_owner = ?, lease_expires_at = ?,
           started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ? AND status = 'queued' AND cancel_requested = 0`
    ).run(workerId, now + leaseMs, timestamp, timestamp, row.id);
    if (!update.changes) return null;
    appendJobEvent(database, row.id, row.user_id, 'running', { workerId, leaseExpiresAt: now + leaseMs });
    return getJob(database, row.user_id, row.id);
  });
}

export function heartbeatJob(database, jobId, workerId, options = {}) {
  const now = Number(options.now || Date.now());
  const leaseMs = clampInteger(options.leaseMs, 5_000, 15 * 60_000, 60_000);
  const result = database.prepare(
    `UPDATE jobs SET lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running' AND lease_owner = ? AND cancel_requested = 0`
  ).run(now + leaseMs, nowIso(), jobId, workerId);
  return result.changes > 0;
}

export function reportJobProgress(database, jobId, workerId, progress, data = {}) {
  const job = readClaimedJob(database, jobId, workerId);
  if (!job) return false;
  const normalizedProgress = clampInteger(progress, 0, 99, job.progress);
  database.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?')
    .run(normalizedProgress, nowIso(), jobId);
  appendJobEvent(database, jobId, job.user_id, 'progress', {
    progress: normalizedProgress,
    ...normalizeEventData(data)
  });
  return true;
}

export function completeJob(database, jobId, workerId, result = {}) {
  const job = readClaimedJob(database, jobId, workerId);
  if (!job) return false;
  const resultJson = serializePayload(result);
  const timestamp = nowIso();
  database.prepare(
    `UPDATE jobs SET status = 'succeeded', result_json = ?, progress = 100,
       lease_owner = '', lease_expires_at = NULL, updated_at = ?, finished_at = ?
     WHERE id = ? AND status = 'running' AND lease_owner = ?`
  ).run(resultJson, timestamp, timestamp, jobId, workerId);
  appendJobEvent(database, jobId, job.user_id, 'succeeded', { progress: 100, result });
  reconcileConversationJobStatus(database, jobId);
  return true;
}

export function failJob(database, jobId, workerId, error, options = {}) {
  const job = readClaimedJob(database, jobId, workerId);
  if (!job) return false;
  const retry = options.retryable === true && job.attempt < job.max_attempts && !job.cancel_requested;
  const nextStatus = retry ? 'queued' : 'failed';
  const timestamp = nowIso();
  const code = String(error?.code || 'JOB_FAILED').slice(0, 120);
  const message = String(error?.message || error || 'Job failed').slice(0, 1000);
  database.prepare(
    `UPDATE jobs SET status = ?, error_code = ?, error_message = ?,
       lease_owner = '', lease_expires_at = NULL, updated_at = ?, finished_at = ?
     WHERE id = ? AND status = 'running' AND lease_owner = ?`
  ).run(nextStatus, code, message, timestamp, retry ? null : timestamp, jobId, workerId);
  appendJobEvent(database, jobId, job.user_id, retry ? 'retrying' : 'failed', {
    code,
    message,
    attempt: job.attempt
  });
  reconcileConversationJobStatus(database, jobId);
  return true;
}

export function cancelJob(database, userId, jobId) {
  const job = getJob(database, userId, jobId);
  if (!job || ['succeeded', 'cancelled'].includes(job.status)) return job;
  const timestamp = nowIso();
  if (job.status === 'queued' || job.status === 'failed') {
    database.prepare(
      `UPDATE jobs SET status = 'cancelled', cancel_requested = 1, updated_at = ?, finished_at = ?
       WHERE id = ? AND user_id = ? AND status IN ('queued', 'failed')`
    ).run(timestamp, timestamp, jobId, userId);
    appendJobEvent(database, jobId, userId, 'cancelled', {});
  } else {
    database.prepare(
      `UPDATE jobs SET cancel_requested = 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'running'`
    ).run(timestamp, jobId, userId);
    appendJobEvent(database, jobId, userId, 'cancellation-requested', {});
  }
  reconcileConversationJobStatus(database, jobId);
  return getJob(database, userId, jobId);
}

export function retryJob(database, userId, jobId) {
  const job = getJob(database, userId, jobId);
  if (!job || !['failed', 'cancelled'].includes(job.status)) return job;
  const source = job.payload;
  if (source.conversationId) {
    const row = database.prepare('SELECT timeline_revision FROM conversations WHERE id = ? AND user_id = ?').get(source.conversationId, userId);
    if (!row || row.timeline_revision !== source.timelineRevision) {
      throw jobError('Source history changed; schedule a new task instead.', 'JOB_SOURCE_STALE', 409);
    }
    if (job.error?.code === 'CAST_PLAN_PARTIAL' || hasLaterConversationWork(database, job)) {
      throw jobError('后续剧情状态已经推进，请通过重建状态恢复旧任务。', 'JOB_REBUILD_REQUIRED', 409);
    }
  }
  database.prepare(`UPDATE jobs SET status = 'queued', cancel_requested = 0, error_code = '', error_message = '',
    max_attempts = MAX(max_attempts, attempt + 1), finished_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(nowIso(), jobId, userId);
  appendJobEvent(database, jobId, userId, 'retrying', { manual: true });
  reconcileConversationJobStatus(database, jobId);
  return getJob(database, userId, jobId);
}

export function finishCancelledJob(database, jobId, workerId) {
  const job = readClaimedJob(database, jobId, workerId);
  if (!job) return false;
  const timestamp = nowIso();
  database.prepare(
    `UPDATE jobs SET status = 'cancelled', lease_owner = '', lease_expires_at = NULL,
       updated_at = ?, finished_at = ? WHERE id = ? AND lease_owner = ?`
  ).run(timestamp, timestamp, jobId, workerId);
  appendJobEvent(database, jobId, job.user_id, 'cancelled', {});
  reconcileConversationJobStatus(database, jobId);
  return true;
}

export function recoverExpiredJobs(database, now = Date.now()) {
  const rows = database.prepare(
    `SELECT id, user_id, cancel_requested, attempt, max_attempts FROM jobs
     WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
  ).all(Number(now));
  for (const row of rows) {
    const cancelled = Boolean(row.cancel_requested);
    const exhausted = row.attempt >= row.max_attempts;
    const status = cancelled ? 'cancelled' : exhausted ? 'failed' : 'queued';
    const timestamp = nowIso();
    database.prepare(
      `UPDATE jobs SET status = ?, lease_owner = '', lease_expires_at = NULL,
         error_code = ?, error_message = ?, updated_at = ?, finished_at = ?
       WHERE id = ? AND status = 'running'`
    ).run(
      status,
      exhausted ? 'JOB_LEASE_EXHAUSTED' : '',
      exhausted ? 'Job lease expired after the final attempt.' : '',
      timestamp,
      TERMINAL_JOB_STATUSES.has(status) ? timestamp : null,
      row.id
    );
    appendJobEvent(database, row.id, row.user_id, status === 'queued' ? 'recovered' : status, {
      previousLeaseExpired: true
    });
  }
  return rows.length;
}

export function getActiveConversationJob(database, userId, conversationId) {
  const row = database.prepare(`SELECT * FROM jobs WHERE user_id = ? AND serial_key = ?
    AND status IN ('queued', 'running') ORDER BY rowid LIMIT 1`)
    .get(userId, conversationJobKey(userId, conversationId));
  return row ? toJob(row) : null;
}

export function cancelConversationJobs(database, userId, conversationId) {
  const rows = database.prepare(`SELECT id FROM jobs WHERE user_id = ? AND serial_key = ?
    AND status IN ('queued', 'running', 'failed')`).all(userId, conversationJobKey(userId, conversationId));
  return rows.map((row) => cancelJob(database, userId, row.id));
}

export function conversationJobKey(userId, conversationId) {
  return JSON.stringify([String(userId), String(conversationId)]);
}

export function getConversationProcessingSummary(database, userId, conversationId) {
  const rows = database.prepare(`SELECT * FROM jobs WHERE user_id = ? AND serial_key = ?
    AND json_extract(payload_json, '$.timelineRevision') = (SELECT timeline_revision FROM conversations WHERE id = ?)
    ORDER BY rowid`).all(userId, conversationJobKey(userId, conversationId), conversationId);
  const pending = rows.filter((job) => ['queued', 'running'].includes(job.status));
  const failed = rows.filter((job) => ['failed', 'cancelled'].includes(job.status));
  const row = pending.find((job) => job.status === 'running') || pending[0] || failed[0] || rows.at(-1);
  if (!row) return null;
  const job = toJob(row);
  return { id: job.id, status: job.status, progress: job.progress, error: job.error,
    pendingCount: pending.length, failedCount: failed.length,
    canRetry: ['failed', 'cancelled'].includes(job.status) && job.error?.code !== 'CAST_PLAN_PARTIAL' && !hasLaterConversationWork(database, job) };
}

function hasLaterConversationWork(database, job) {
  return Boolean(job.serialKey && database.prepare(`SELECT id FROM jobs WHERE user_id = ? AND serial_key = ?
    AND rowid > (SELECT rowid FROM jobs WHERE id = ?) AND attempt > 0
    AND json_extract(payload_json, '$.timelineRevision') = ? LIMIT 1`)
    .get(job.userId, job.serialKey, job.id, job.payload.timelineRevision));
}

function bindConversationPayload(database, userId, type, payload) {
  const conversationId = String(payload?.conversationId || '').trim();
  if (!conversationId) return payload;
  const conversation = database.prepare('SELECT timeline_revision FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
  if (!conversation) return payload;
  const bound = { ...payload, conversationId, timelineRevision: conversation.timeline_revision };
  if (type === 'cast.organize' || type === 'memory.extract') {
    const rows = database.prepare(`SELECT id, role, revision FROM messages WHERE conversation_id = ? AND user_id = ?
      AND role IN ('user', 'assistant') ORDER BY created_at DESC, rowid DESC LIMIT 80`).all(conversationId, userId).reverse();
    bound.evidenceRefs = rows.map(({ id, revision }) => ({ id, revision }));
    if (type === 'memory.extract') {
      const assistantIndex = rows.findLastIndex((message) => message.role === 'assistant');
      const assistant = rows[assistantIndex];
      const user = rows.slice(0, assistantIndex).findLast((message) => message.role === 'user');
      Object.assign(bound, { assistantMessageId: assistant?.id || '', assistantRevision: assistant?.revision || 0,
        userMessageId: user?.id || '', userRevision: user?.revision || 0 });
    }
  }
  return bound;
}

function reconcileConversationJobStatus(database, jobId) {
  const row = database.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!row?.serial_key) return;
  const payload = parseJson(row.payload_json, {});
  const conversation = database.prepare('SELECT timeline_revision, state_status FROM conversations WHERE id = ? AND user_id = ?')
    .get(payload.conversationId, row.user_id);
  if (!conversation || conversation.timeline_revision !== payload.timelineRevision) return;
  const summary = getConversationProcessingSummary(database, row.user_id, payload.conversationId);
  if (['needs_rebuild', 'stale', 'legacy_partial'].includes(conversation.state_status)) return;
  const status = summary?.pendingCount ? 'pending' : summary?.failedCount ? 'needs_review' : 'ready';
  database.prepare('UPDATE conversations SET state_status = ? WHERE id = ?').run(status, payload.conversationId);
}

function appendJobEvent(database, jobId, userId, type, data) {
  database.prepare(
    'INSERT INTO job_events (job_id, user_id, event_type, data_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, userId, type, JSON.stringify(normalizeEventData(data)), nowIso());
}

function findIdempotentJob(database, userId, type, key) {
  const row = database.prepare(
    'SELECT * FROM jobs WHERE user_id = ? AND type = ? AND idempotency_key = ?'
  ).get(userId, type, key);
  return row ? toJob(row) : null;
}

function readClaimedJob(database, jobId, workerId) {
  return database.prepare(
    "SELECT * FROM jobs WHERE id = ? AND status = 'running' AND lease_owner = ?"
  ).get(jobId, workerId);
}

function toJob(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    payload: parseJson(row.payload_json, {}),
    result: row.result_json == null ? null : parseJson(row.result_json, null),
    error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
    idempotencyKey: row.idempotency_key,
    serialKey: row.serial_key || '',
    progress: Number(row.progress || 0),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at == null ? null : Number(row.lease_expires_at),
    cancelRequested: Boolean(row.cancel_requested),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null
  };
}

function serializePayload(payload) {
  let text;
  try {
    text = JSON.stringify(payload ?? {});
  } catch (error) {
    throw jobError('Job payload must be JSON serializable.', 'JOB_PAYLOAD_INVALID', 400, error);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_JOB_PAYLOAD_BYTES) {
    throw jobError('Job payload is too large.', 'JOB_PAYLOAD_TOO_LARGE', 413);
  }
  return text;
}

function normalizeJobType(value) {
  const type = String(value || '').trim();
  if (!JOB_TYPE_SET.has(type)) {
    throw jobError('Unsupported job type.', 'JOB_TYPE_UNSUPPORTED', 400);
  }
  return type;
}

function normalizeWorkerTypes(types) {
  if (!Array.isArray(types)) return [];
  return types.map(normalizeJobType);
}

function normalizeIdempotencyKey(value) {
  return String(value || '').trim().slice(0, 200);
}

function normalizeStatusFilter(value) {
  const status = String(value || '').trim();
  return ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status) ? status : '';
}

function normalizeEventData(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function jobError(message, code, status, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.status = status;
  error.publicMessage = message;
  return error;
}
