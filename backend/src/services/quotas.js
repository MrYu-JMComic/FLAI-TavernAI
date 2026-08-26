import { appConfig } from '../config.js';
import { AppError } from '../errors.js';
import { nowIso } from '../security.js';

export function getUserQuota(database, userId, defaults = appConfig.quotaDefaults) {
  const row = database.prepare('SELECT * FROM user_quotas WHERE user_id = ?').get(userId);
  return {
    userId,
    maxConcurrentAiJobs: positiveInteger(row?.max_concurrent_ai_jobs, defaults.maxConcurrentAiJobs),
    maxUploadBytes: positiveInteger(row?.max_upload_bytes, defaults.maxUploadBytes),
    maxDailyRequests: positiveInteger(row?.max_daily_requests, defaults.maxDailyRequests),
    maxDailyCostMicros: positiveInteger(row?.max_daily_cost_micros, defaults.maxDailyCostMicros),
    updatedAt: row?.updated_at || ''
  };
}

export function updateUserQuota(database, userId, payload = {}, defaults = appConfig.quotaDefaults) {
  const current = getUserQuota(database, userId, defaults);
  const quota = {
    maxConcurrentAiJobs: boundedInteger(payload.maxConcurrentAiJobs, 1, 32, current.maxConcurrentAiJobs),
    maxUploadBytes: boundedInteger(payload.maxUploadBytes, 1024, 10 * 1024 ** 3, current.maxUploadBytes),
    maxDailyRequests: boundedInteger(payload.maxDailyRequests, 1, 10_000_000, current.maxDailyRequests),
    maxDailyCostMicros: boundedInteger(payload.maxDailyCostMicros, 1, Number.MAX_SAFE_INTEGER, current.maxDailyCostMicros)
  };
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO user_quotas (
       user_id, max_concurrent_ai_jobs, max_upload_bytes, max_daily_requests,
       max_daily_cost_micros, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       max_concurrent_ai_jobs = excluded.max_concurrent_ai_jobs,
       max_upload_bytes = excluded.max_upload_bytes,
       max_daily_requests = excluded.max_daily_requests,
       max_daily_cost_micros = excluded.max_daily_cost_micros,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    quota.maxConcurrentAiJobs,
    quota.maxUploadBytes,
    quota.maxDailyRequests,
    quota.maxDailyCostMicros,
    timestamp
  );
  return getUserQuota(database, userId, defaults);
}

export function assertAiJobQuota(database, userId) {
  const quota = getUserQuota(database, userId);
  const active = Number(database.prepare(
    "SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND status IN ('queued', 'running')"
  ).get(userId)?.count || 0);
  if (active >= quota.maxConcurrentAiJobs) {
    throw quotaError('AI_JOB_QUOTA_EXCEEDED', 'AI task concurrency quota exceeded.');
  }
  assertDailyCostQuota(database, userId);
  return { quota, active };
}

export function assertUploadQuota(database, userId, additionalBytes = 0) {
  const quota = getUserQuota(database, userId);
  const used = Number(database.prepare(
    `SELECT
       (SELECT COALESCE(SUM(byte_size), 0) FROM assets WHERE user_id = ?) +
       (SELECT COALESCE(SUM(byte_size), 0) FROM avatar_assets WHERE user_id = ?) AS bytes`
  ).get(userId, userId)?.bytes || 0);
  if (used + Math.max(0, Number(additionalBytes || 0)) > quota.maxUploadBytes) {
    throw quotaError('UPLOAD_QUOTA_EXCEEDED', 'Upload storage quota exceeded.');
  }
  return { quota, used };
}

export function consumeDailyRequest(database, userId, options = {}) {
  const quota = getUserQuota(database, userId);
  const date = usageDate(options.now);
  const current = getDailyUsage(database, userId, date);
  if (current.requestCount >= quota.maxDailyRequests) {
    throw quotaError('DAILY_REQUEST_QUOTA_EXCEEDED', 'Daily request quota exceeded.');
  }
  upsertDailyUsage(database, userId, date, { requestCount: 1 });
  return getDailyUsage(database, userId, date);
}

export function recordProviderUsage(database, userId, usage = {}, options = {}) {
  const normalized = normalizeProviderUsage(usage, options.costMicros);
  upsertDailyUsage(database, userId, usageDate(options.now), {
    inputTokens: normalized.inputTokens,
    outputTokens: normalized.outputTokens,
    costMicros: normalized.costMicros
  });
  return normalized;
}

export function assertDailyCostQuota(database, userId, additionalCostMicros = 0) {
  const quota = getUserQuota(database, userId);
  const usage = getDailyUsage(database, userId);
  if (usage.costMicros + Math.max(0, integer(additionalCostMicros, 0)) >= quota.maxDailyCostMicros) {
    throw quotaError('DAILY_COST_QUOTA_EXCEEDED', 'Daily AI cost quota exceeded.');
  }
  return { quota, usage };
}

export function getDailyUsage(database, userId, date = usageDate()) {
  const row = database.prepare(
    'SELECT * FROM user_daily_usage WHERE user_id = ? AND usage_date = ?'
  ).get(userId, date);
  return {
    userId,
    date,
    requestCount: Number(row?.request_count || 0),
    inputTokens: Number(row?.input_tokens || 0),
    outputTokens: Number(row?.output_tokens || 0),
    costMicros: Number(row?.cost_micros || 0),
    updatedAt: row?.updated_at || ''
  };
}

export function normalizeProviderUsage(value = {}, explicitCostMicros) {
  const source = value && typeof value === 'object' ? value : {};
  const inputTokens = integer(
    source.inputTokens ?? source.promptTokens ?? source.prompt_tokens ?? source.input_tokens,
    0
  );
  const outputTokens = integer(
    source.outputTokens ?? source.completionTokens ?? source.completion_tokens ?? source.output_tokens,
    0
  );
  const dollars = Number(source.cost ?? source.totalCost ?? source.total_cost);
  const derivedCost = Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 1_000_000) : 0;
  return {
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    costMicros: Math.max(0, integer(explicitCostMicros ?? source.costMicros ?? source.cost_micros, derivedCost))
  };
}

function upsertDailyUsage(database, userId, date, delta = {}) {
  database.prepare(
    `INSERT INTO user_daily_usage (
       user_id, usage_date, request_count, input_tokens, output_tokens, cost_micros, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, usage_date) DO UPDATE SET
       request_count = request_count + excluded.request_count,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_micros = cost_micros + excluded.cost_micros,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    date,
    Math.max(0, integer(delta.requestCount, 0)),
    Math.max(0, integer(delta.inputTokens, 0)),
    Math.max(0, integer(delta.outputTokens, 0)),
    Math.max(0, integer(delta.costMicros, 0)),
    nowIso()
  );
}

function usageDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function quotaError(code, message) {
  return new AppError(429, code, message);
}

function positiveInteger(value, fallback) {
  const number = integer(value, fallback);
  return number > 0 ? number : fallback;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function integer(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}
