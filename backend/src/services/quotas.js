import { appConfig } from '../config.js';
import { AppError } from '../errors.js';
import { nowIso } from '../security.js';

export function getUserQuota(database, userId, defaults = appConfig.quotaDefaults) {
  const row = database.prepare('SELECT * FROM user_quotas WHERE user_id = ?').get(userId);
  return {
    userId,
    maxConcurrentAiJobs: positiveInteger(row?.max_concurrent_ai_jobs, defaults.maxConcurrentAiJobs),
    maxUploadBytes: positiveInteger(row?.max_upload_bytes, defaults.maxUploadBytes),
    maxStructuredStorageBytes: positiveInteger(
      row?.max_structured_storage_bytes,
      defaults.maxStructuredStorageBytes ?? 256 * 1024 * 1024
    ),
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
    maxStructuredStorageBytes: boundedInteger(
      payload.maxStructuredStorageBytes,
      1024,
      10 * 1024 ** 3,
      current.maxStructuredStorageBytes
    ),
    maxDailyRequests: boundedInteger(payload.maxDailyRequests, 1, 10_000_000, current.maxDailyRequests),
    maxDailyCostMicros: boundedInteger(payload.maxDailyCostMicros, 1, Number.MAX_SAFE_INTEGER, current.maxDailyCostMicros)
  };
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO user_quotas (
       user_id, max_concurrent_ai_jobs, max_upload_bytes, max_structured_storage_bytes,
       max_daily_requests, max_daily_cost_micros, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       max_concurrent_ai_jobs = excluded.max_concurrent_ai_jobs,
       max_upload_bytes = excluded.max_upload_bytes,
       max_structured_storage_bytes = excluded.max_structured_storage_bytes,
       max_daily_requests = excluded.max_daily_requests,
       max_daily_cost_micros = excluded.max_daily_cost_micros,
       updated_at = excluded.updated_at`
  ).run(
    userId,
    quota.maxConcurrentAiJobs,
    quota.maxUploadBytes,
    quota.maxStructuredStorageBytes,
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
  assertProviderInvocationQuota(database, userId);
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

export function getStructuredStorageUsage(database, userId) {
  const queries = [
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(avatar_url, '')) +
       LENGTH(COALESCE(background, '')) + LENGTH(COALESCE(worldview, '')) +
       LENGTH(COALESCE(persona, '')) + LENGTH(COALESCE(opening_message, '')) +
       LENGTH(COALESCE(tags, '')) + LENGTH(COALESCE(render_plugins, '')) +
       LENGTH(COALESCE(author_advanced_settings, ''))
     ), 0) AS bytes FROM characters WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(title, '')) + LENGTH(COALESCE(desktop_background_url, '')) +
       LENGTH(COALESCE(mobile_background_url, '')) + LENGTH(COALESCE(custom_css, '')) +
       LENGTH(COALESCE(custom_js, '')) + LENGTH(COALESCE(user_advanced_settings, ''))
     ), 0) AS bytes FROM conversations WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(content, '')) + LENGTH(COALESCE(reasoning, '')) +
       LENGTH(COALESCE(attachments_json, '')) + LENGTH(COALESCE(usage_json, ''))
     ), 0) AS bytes FROM messages WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(subject, '')) + LENGTH(COALESCE(content, '')) +
       LENGTH(COALESCE(source_excerpt, ''))
     ), 0) AS bytes FROM conversation_memories WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(description, ''))
     ), 0) AS bytes FROM world_books WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(entries.name, '')) + LENGTH(COALESCE(entries.trigger_keys, '')) +
       LENGTH(COALESCE(entries.keys_secondary, '')) + LENGTH(COALESCE(entries.content, ''))
     ), 0) AS bytes
       FROM world_book_entries AS entries
       JOIN world_books AS books ON books.id = entries.world_book_id
       WHERE books.user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(system_prompt, ''))
     ), 0) AS bytes FROM presets WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(description, '')) + LENGTH(COALESCE(content, '')) +
       LENGTH(COALESCE(character_ids, ''))
     ), 0) AS bytes FROM mods WHERE user_id = ?`,
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(label, '')) + LENGTH(COALESCE(pattern, '')) + LENGTH(COALESCE(replacement, '')) +
       LENGTH(COALESCE(js_script, ''))
     ), 0) AS bytes FROM regex_rules WHERE user_id = ?`,
    `SELECT COALESCE(SUM(LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(color, ''))), 0) AS bytes
       FROM tags WHERE user_id = ?`
  ];
  let bytes = 0;
  for (const query of queries) {
    try {
      bytes += Number(database.prepare(query).get(userId)?.bytes || 0);
    } catch {
      // Older embedded databases may not have an optional table yet.
    }
  }
  return Math.max(0, bytes);
}

export function assertStructuredStorageQuota(database, userId, additionalBytes = 0) {
  const quota = getUserQuota(database, userId);
  const used = getStructuredStorageUsage(database, userId);
  const additional = Math.max(0, integer(additionalBytes, 0));
  if (used + additional > quota.maxStructuredStorageBytes) {
    throw new AppError(413, 'STRUCTURED_STORAGE_QUOTA_EXCEEDED', 'Structured data storage quota exceeded.');
  }
  return { quota, used, additional };
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

// Every provider invocation gets a minimum one-micro reservation.  Providers
// frequently omit pricing/usage metadata, so a zero-cost preflight would make
// a tiny quota ineffective and allow an unbounded number of requests.  The
// reservation is settled with the actual usage after the call (and unknown
// usage remains billable at the one-micro floor).
export const MIN_PROVIDER_RESERVATION_MICROS = 1;

export function assertProviderInvocationQuota(database, userId, estimatedCostMicros = MIN_PROVIDER_RESERVATION_MICROS) {
  if (!database || !userId) {
    return null;
  }
  const estimate = Math.max(
    MIN_PROVIDER_RESERVATION_MICROS,
    integer(estimatedCostMicros, MIN_PROVIDER_RESERVATION_MICROS)
  );
  return assertDailyCostQuota(database, userId, estimate);
}

export function recordProviderInvocationUsage(database, userId, usage = {}, options = {}) {
  if (!database || !userId) {
    return normalizeProviderUsage(usage);
  }
  const normalized = normalizeProviderUsage(usage, options.costMicros);
  const billUnknownUsage = options.billUnknownUsage !== false;
  const costMicros = billUnknownUsage && normalized.costMicros < MIN_PROVIDER_RESERVATION_MICROS
    ? MIN_PROVIDER_RESERVATION_MICROS
    : normalized.costMicros;
  return recordProviderUsage(database, userId, normalized, { ...options, costMicros });
}

/**
 * Atomically reserve the minimum estimated cost for a provider call.  The
 * conditional UPDATE is serialized by SQLite, so two concurrent requests
 * cannot both spend the last micro of a user's daily budget.
 */
export function reserveProviderCost(database, userId, estimatedCostMicros = MIN_PROVIDER_RESERVATION_MICROS, options = {}) {
  if (!database || !userId) {
    return null;
  }
  const estimate = Math.max(
    MIN_PROVIDER_RESERVATION_MICROS,
    integer(estimatedCostMicros, MIN_PROVIDER_RESERVATION_MICROS)
  );
  const date = usageDate(options.now);
  const quota = getUserQuota(database, userId, options.defaults);
  const timestamp = nowIso();
  database.prepare(
    `INSERT OR IGNORE INTO user_daily_usage (
       user_id, usage_date, request_count, input_tokens, output_tokens, cost_micros, updated_at
     ) VALUES (?, ?, 0, 0, 0, 0, ?)`
  ).run(userId, date, timestamp);
  const result = database.prepare(
    `UPDATE user_daily_usage
     SET cost_micros = cost_micros + ?, updated_at = ?
     WHERE user_id = ? AND usage_date = ?
       AND cost_micros + ? < ?`
  ).run(estimate, timestamp, userId, date, estimate, quota.maxDailyCostMicros);
  if (!result.changes) {
    throw quotaError('DAILY_COST_QUOTA_EXCEEDED', 'Daily AI cost quota exceeded.');
  }
  return { userId, date, amount: estimate };
}

/** Settle a prior reservation with actual usage without charging the floor twice. */
export function settleProviderCost(database, reservation, usage = {}, options = {}) {
  if (!database || !reservation?.userId) {
    return normalizeProviderUsage(usage);
  }
  const normalized = normalizeProviderUsage(usage, options.costMicros);
  const usageProvided = options.usageProvided !== false;
  const billableCost = usageProvided
    ? Math.max(MIN_PROVIDER_RESERVATION_MICROS, normalized.costMicros)
    : Math.max(MIN_PROVIDER_RESERVATION_MICROS, integer(reservation.amount, MIN_PROVIDER_RESERVATION_MICROS));
  const deltaCost = billableCost - Math.max(0, integer(reservation.amount, 0));
  const timestamp = nowIso();
  const quota = getUserQuota(database, reservation.userId, options.defaults);
  const date = reservation.date || usageDate(options.now);
  const row = database.prepare(
    'SELECT cost_micros FROM user_daily_usage WHERE user_id = ? AND usage_date = ?'
  ).get(reservation.userId, date);
  if (!row) {
    return normalized;
  }
  if (deltaCost > 0) {
    const result = database.prepare(
      `UPDATE user_daily_usage
       SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
           cost_micros = MIN(?, cost_micros + ?), updated_at = ?
       WHERE user_id = ? AND usage_date = ?`
    ).run(
      normalized.inputTokens,
      normalized.outputTokens,
      quota.maxDailyCostMicros,
      deltaCost,
      timestamp,
      reservation.userId,
      date
    );
    return result.changes ? normalized : normalized;
  }
  database.prepare(
    `UPDATE user_daily_usage
     SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
         cost_micros = MAX(0, cost_micros + ?), updated_at = ?
     WHERE user_id = ? AND usage_date = ?`
  ).run(
    normalized.inputTokens,
    normalized.outputTokens,
    deltaCost,
    timestamp,
    reservation.userId,
    date
  );
  return normalized;
}

export async function withProviderQuota(database, userId, operation, options = {}) {
  if (typeof operation !== 'function') {
    throw new TypeError('Provider operation is required.');
  }
  if (!database || !userId) {
    return operation();
  }
  const reservation = reserveProviderCost(database, userId, options.estimatedCostMicros, options);
  try {
    const result = await operation();
    const usage = result?.usage;
    const usageProvided = Boolean(usage && typeof usage === 'object' && Object.keys(usage).length);
    settleProviderCost(database, reservation, usage || {}, { ...options, usageProvided });
    return result;
  } catch (error) {
    // Keep the one-micro reservation for failed/aborted calls.  This gives
    // callers a deterministic floor and prevents retry storms from bypassing
    // a tiny daily budget when a provider omits usage metadata.
    throw error;
  }
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
