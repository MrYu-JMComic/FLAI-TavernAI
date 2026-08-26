import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { parseJson } from '../../utils/json.js';
import { assertAiJobQuota } from '../quotas.js';
import { createCursorScope, decodeCursor, encodeCursor } from '../cursorPagination.js';

export const JOB_TYPES = Object.freeze([
  'town.generate',
  'cast.organize',
  'memory.extract',
  'world-book.assist'
]);
export const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const JOB_TYPE_SET = new Set(JOB_TYPES);
const MAX_JOB_PAYLOAD_BYTES = 100_000;

export function submitJob(database, userId, type, payload = {}, options = {}) {
  const normalizedType = normalizeJobType(type);
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  if (!idempotencyKey) {
    throw jobError('An Idempotency-Key is required.', 'JOB_IDEMPOTENCY_REQUIRED', 400);
  }
  const existing = findIdempotentJob(database, userId, normalizedType, idempotencyKey);
  if (existing) {
    return { ...existing, deduplicated: true };
  }
  assertAiJobQuota(database, userId);

  const payloadJson = serializePayload(payload);
  const id = newId();
  const timestamp = nowIso();
  try {
    withSavepoint(database, 'sp_submit_job', () => {
      database.prepare(
        `INSERT INTO jobs (
           id, user_id, type, status, payload_json, idempotency_key,
           max_attempts, created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
      ).run(
        id,
        userId,
        normalizedType,
        payloadJson,
        idempotencyKey,
        clampInteger(options.maxAttempts, 1, 10, 3),
        timestamp,
        timestamp
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
      `SELECT id, user_id FROM jobs
       WHERE status = 'queued' AND cancel_requested = 0 AND attempt < max_attempts${typeFilter}
       ORDER BY created_at ASC, id ASC LIMIT 1`
    ).get(...types);
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
  return true;
}

export function cancelJob(database, userId, jobId) {
  const job = getJob(database, userId, jobId);
  if (!job || TERMINAL_JOB_STATUSES.has(job.status)) return job;
  const timestamp = nowIso();
  if (job.status === 'queued') {
    database.prepare(
      `UPDATE jobs SET status = 'cancelled', cancel_requested = 1, updated_at = ?, finished_at = ?
       WHERE id = ? AND user_id = ? AND status = 'queued'`
    ).run(timestamp, timestamp, jobId, userId);
    appendJobEvent(database, jobId, userId, 'cancelled', {});
  } else {
    database.prepare(
      `UPDATE jobs SET cancel_requested = 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'running'`
    ).run(timestamp, jobId, userId);
    appendJobEvent(database, jobId, userId, 'cancellation-requested', {});
  }
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
