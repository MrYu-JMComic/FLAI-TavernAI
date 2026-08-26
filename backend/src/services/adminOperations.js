import { parseJson } from '../utils/json.js';
import { publicUser } from '../modules/users.js';
import { getDailyUsage, getUserQuota } from './quotas.js';
import { listProviderRouteEvents } from './providerTaskRouter.js';
import { createCursorScope, decodeCursor, encodeCursor } from './cursorPagination.js';

export function buildAdminOverview(database) {
  const counts = database.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM sessions WHERE expires_at > ?) AS active_sessions,
       (SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running')) AS active_jobs,
       (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS failed_jobs,
       ((SELECT COUNT(*) FROM provider_presets)
         + (SELECT COUNT(*) FROM provider_settings settings
            WHERE NOT EXISTS (
              SELECT 1 FROM provider_presets presets WHERE presets.user_id = settings.user_id
            ))) AS configured_providers,
       (SELECT COALESCE(SUM(byte_size), 0) FROM assets) AS asset_bytes,
       (SELECT COALESCE(SUM(byte_size), 0) FROM avatar_assets) AS avatar_bytes`
  ).get(Date.now());
  const usage = database.prepare(
    `SELECT COALESCE(SUM(request_count), 0) AS requests,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens,
            COALESCE(SUM(cost_micros), 0) AS cost_micros
     FROM user_daily_usage WHERE usage_date = ?`
  ).get(today());
  return {
    users: Number(counts.users),
    activeSessions: Number(counts.active_sessions),
    jobs: { active: Number(counts.active_jobs), failed: Number(counts.failed_jobs) },
    storageBytes: Number(counts.asset_bytes) + Number(counts.avatar_bytes),
    configuredProviders: Number(counts.configured_providers),
    today: usageSummary(usage)
  };
}

export function listAdminUsers(database, options = {}) {
  const limit = clampInteger(options.limit, 1, 200, 50);
  const scope = createCursorScope('admin-users');
  const cursor = decodeCursor(options.cursor, scope, { values: 2 });
  const params = [];
  let where = '';
  if (cursor) {
    where = 'WHERE created_at < ? OR (created_at = ? AND id < ?)';
    params.push(cursor[0], cursor[0], cursor[1]);
  }
  params.push(limit + 1);
  const rows = database.prepare(
    `SELECT * FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT ?`
  ).all(...params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const users = page.map((row) => {
    const storage = getUserStorage(database, row.id);
    const jobs = database.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS active
       FROM jobs WHERE user_id = ?`
    ).get(row.id);
    return {
      ...publicUser(database, row),
      quota: getUserQuota(database, row.id),
      usageToday: getDailyUsage(database, row.id),
      storage,
      jobs: { total: Number(jobs.total || 0), active: Number(jobs.active || 0) }
    };
  });
  return {
    users,
    nextCursor: hasMore && users.length
      ? encodeCursor(scope, [users.at(-1).createdAt, users.at(-1).id])
      : ''
  };
}

export function listAdminSessions(database, options = {}) {
  const limit = clampInteger(options.limit, 1, 200, 50);
  const scope = createCursorScope('admin-sessions');
  const cursor = decodeCursor(options.cursor || options.afterId, scope, { values: 1 });
  const afterId = cursor?.[0] || '';
  const params = [];
  let where = '';
  if (afterId) {
    where = 'WHERE sessions.id > ?';
    params.push(afterId);
  }
  params.push(limit + 1);
  const rows = database.prepare(
    `SELECT sessions.id, sessions.user_id, sessions.expires_at, sessions.created_at,
            users.username, users.display_name
     FROM sessions JOIN users ON users.id = sessions.user_id
     ${where} ORDER BY sessions.id ASC LIMIT ?`
  ).all(...params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    sessions: page.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      expiresAt: new Date(Number(row.expires_at)).toISOString(),
      expired: Number(row.expires_at) <= Date.now(),
      createdAt: row.created_at
    })),
    nextCursor: hasMore && page.length ? encodeCursor(scope, [page.at(-1).id]) : ''
  };
}

export function revokeAdminSession(database, sessionId) {
  return database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes > 0;
}

export function listAdminJobs(database, options = {}) {
  const limit = clampInteger(options.limit, 1, 200, 50);
  const scope = createCursorScope('admin-jobs', {
    userId: String(options.userId || ''),
    status: String(options.status || '')
  });
  const cursor = decodeCursor(options.cursor, scope, { values: 2 });
  const params = [];
  const clauses = [];
  if (options.userId) {
    clauses.push('jobs.user_id = ?');
    params.push(String(options.userId));
  }
  if (options.status) {
    clauses.push('jobs.status = ?');
    params.push(String(options.status));
  }
  if (cursor) {
    clauses.push('(jobs.created_at < ? OR (jobs.created_at = ? AND jobs.id < ?))');
    params.push(cursor[0], cursor[0], cursor[1]);
  }
  params.push(limit + 1);
  const rows = database.prepare(
    `SELECT jobs.id, jobs.user_id, jobs.type, jobs.status, jobs.progress, jobs.attempt,
            jobs.max_attempts, jobs.error_code, jobs.created_at, jobs.updated_at,
            jobs.started_at, jobs.finished_at, users.username
     FROM jobs JOIN users ON users.id = jobs.user_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY jobs.created_at DESC, jobs.id DESC LIMIT ?`
  ).all(...params);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const jobs = page.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    type: row.type,
    status: row.status,
    progress: Number(row.progress),
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
  return {
    jobs,
    nextCursor: hasMore && jobs.length
      ? encodeCursor(scope, [jobs.at(-1).createdAt, jobs.at(-1).id])
      : ''
  };
}

export function getAdminUserUsage(database, userId) {
  const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const daily = database.prepare(
    `SELECT * FROM user_daily_usage WHERE user_id = ?
     ORDER BY usage_date DESC LIMIT 31`
  ).all(userId).map((row) => ({
    date: row.usage_date,
    ...usageSummary(row)
  }));
  return {
    user: publicUser(database, user),
    quota: getUserQuota(database, userId),
    storage: getUserStorage(database, userId),
    daily,
    messageTokens: aggregateMessageTokens(database, userId),
    providerRoutes: listProviderRouteEvents(database, { userId, limit: 100 })
  };
}

export function listAdminProviderSettings(database) {
  return database.prepare(
    `SELECT providers.*, users.username
     FROM (
       SELECT presets.id, presets.user_id, presets.provider_type, presets.gateway_name,
              presets.base_url, presets.model, presets.api_key_hint,
              presets.allow_private_network, presets.updated_at,
              CASE WHEN selection.provider_id = presets.id THEN 1 ELSE 0 END AS is_selected
       FROM provider_presets presets
       LEFT JOIN provider_selections selection ON selection.user_id = presets.user_id
       UNION ALL
       SELECT NULL AS id, settings.user_id, settings.provider_type, settings.gateway_name,
              settings.base_url, settings.model, settings.api_key_hint,
              settings.allow_private_network, settings.updated_at, 1 AS is_selected
       FROM provider_settings settings
       WHERE NOT EXISTS (
         SELECT 1 FROM provider_presets presets WHERE presets.user_id = settings.user_id
       )
     ) providers
     JOIN users ON users.id = providers.user_id
     ORDER BY providers.updated_at DESC, providers.user_id ASC, providers.id ASC`
  ).all().map((row) => ({
    id: row.id || null,
    userId: row.user_id,
    username: row.username,
    providerType: row.provider_type,
    gatewayName: row.gateway_name,
    baseUrlHost: safeHost(row.base_url),
    model: row.model,
    apiKeySet: Boolean(row.api_key_hint),
    selected: Boolean(row.is_selected),
    allowPrivateNetwork: Boolean(row.allow_private_network),
    updatedAt: row.updated_at
  }));
}

function getUserStorage(database, userId) {
  const row = database.prepare(
    `SELECT
       (SELECT COUNT(*) FROM assets WHERE user_id = ?) AS asset_count,
       (SELECT COALESCE(SUM(byte_size), 0) FROM assets WHERE user_id = ?) AS asset_bytes,
       (SELECT COUNT(*) FROM avatar_assets WHERE user_id = ?) AS avatar_count,
       (SELECT COALESCE(SUM(byte_size), 0) FROM avatar_assets WHERE user_id = ?) AS avatar_bytes`
  ).get(userId, userId, userId, userId);
  return {
    assets: Number(row.asset_count),
    avatars: Number(row.avatar_count),
    bytes: Number(row.asset_bytes) + Number(row.avatar_bytes)
  };
}

function aggregateMessageTokens(database, userId) {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of database.prepare(
    'SELECT usage_json FROM messages WHERE user_id = ? AND usage_json IS NOT NULL'
  ).iterate(userId)) {
    const usage = parseJson(row.usage_json, {});
    inputTokens += number(usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens);
    outputTokens += number(usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? usage.output_tokens);
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function usageSummary(row = {}) {
  return {
    requestCount: Number(row.request_count ?? row.requests ?? 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    costMicros: Number(row.cost_micros || 0)
  };
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function clampInteger(value, min, max, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.min(max, Math.max(min, Math.floor(numberValue))) : fallback;
}
