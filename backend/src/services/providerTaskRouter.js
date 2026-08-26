import { performance } from 'node:perf_hooks';
import { assertDailyCostQuota, normalizeProviderUsage, recordProviderUsage } from './quotas.js';

export async function executeProviderTask(database, options = {}) {
  const {
    userId,
    jobId = '',
    taskType = 'provider.task',
    settings,
    routing = {},
    signal,
    operation
  } = options;
  if (typeof operation !== 'function') throw new TypeError('Provider task operation is required.');
  assertDailyCostQuota(database, userId);
  const routes = buildRoutes(settings, routing);
  let lastError;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const startedAt = performance.now();
    try {
      const result = await operation(route.settings, {
        role: route.role,
        attempt: index + 1,
        signal
      });
      const usage = normalizeProviderUsage(result?.usage || {});
      recordProviderUsage(database, userId, usage);
      const event = recordProviderRoute(database, {
        userId,
        jobId,
        taskType,
        role: route.role,
        settings: route.settings,
        status: 'succeeded',
        usage,
        durationMs: performance.now() - startedAt
      });
      return {
        result,
        route: publicRoute(event)
      };
    } catch (error) {
      lastError = error;
      recordProviderRoute(database, {
        userId,
        jobId,
        taskType,
        role: route.role,
        settings: route.settings,
        status: 'failed',
        durationMs: performance.now() - startedAt,
        errorCode: error?.code || error?.name || 'PROVIDER_TASK_FAILED'
      });
      if (signal?.aborted || index === routes.length - 1) throw error;
    }
  }
  throw lastError;
}

export function listProviderRouteEvents(database, options = {}) {
  const limit = clampInteger(options.limit, 1, 500, 100);
  const values = [];
  const where = [];
  if (options.userId) {
    where.push('user_id = ?');
    values.push(options.userId);
  }
  if (options.jobId) {
    where.push('job_id = ?');
    values.push(options.jobId);
  }
  if (options.afterId) {
    where.push('id > ?');
    values.push(Math.max(0, Number(options.afterId)));
  }
  values.push(limit);
  return database.prepare(
    `SELECT * FROM provider_route_events
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT ?`
  ).all(...values).map(toRouteEvent);
}

function buildRoutes(settings = {}, routing = {}) {
  const source = routing && typeof routing === 'object' ? routing : {};
  const primaryModel = text(source.primaryModel || source.model || settings.model, 300);
  const fallbackModel = text(source.fallbackModel, 300);
  const primary = { ...settings, model: primaryModel || settings.model };
  const routes = [{ role: 'primary', settings: primary }];
  if (fallbackModel && fallbackModel !== primary.model) {
    routes.push({ role: 'fallback', settings: { ...settings, model: fallbackModel } });
  }
  return routes;
}

function recordProviderRoute(database, event) {
  const usage = event.usage || { inputTokens: 0, outputTokens: 0, costMicros: 0 };
  const result = database.prepare(
    `INSERT INTO provider_route_events (
       user_id, job_id, task_type, route_role, provider_type, model, status,
       input_tokens, output_tokens, cost_micros, duration_ms, error_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.userId,
    text(event.jobId, 200),
    text(event.taskType, 120),
    event.role,
    text(event.settings?.providerType, 80),
    text(event.settings?.model, 300),
    event.status,
    usage.inputTokens,
    usage.outputTokens,
    usage.costMicros,
    Math.max(0, Number(event.durationMs || 0)),
    text(event.errorCode, 120),
    new Date().toISOString()
  );
  return toRouteEvent(database.prepare('SELECT * FROM provider_route_events WHERE id = ?').get(result.lastInsertRowid));
}

function toRouteEvent(row) {
  return {
    id: Number(row.id),
    userId: row.user_id,
    jobId: row.job_id,
    taskType: row.task_type,
    role: row.route_role,
    providerType: row.provider_type,
    model: row.model,
    status: row.status,
    usage: {
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      costMicros: Number(row.cost_micros)
    },
    durationMs: Number(row.duration_ms),
    errorCode: row.error_code,
    createdAt: row.created_at
  };
}

function publicRoute(event) {
  return {
    role: event.role,
    providerType: event.providerType,
    model: event.model,
    usage: event.usage,
    durationMs: event.durationMs
  };
}

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}
