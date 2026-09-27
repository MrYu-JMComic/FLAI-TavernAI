import fs from 'node:fs';
import { performanceMetricsSnapshot } from './performanceMetrics.js';
import { providerResilienceSnapshot } from './providerResilience.js';

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Build the Prometheus text exposition for the root admin `/metrics` route.
 * Everything here is aggregate: no user ids, prompts or provider secrets.
 */
export function buildPrometheusMetrics(options = {}) {
  const families = [];

  const operations = performanceMetricsSnapshot();
  families.push(family('flai_operation_calls_total', 'counter', operations.map((row) => sample(
    { operation: row.name }, row.calls
  ))));
  families.push(family('flai_operation_duration_ms', 'summary', operations.flatMap((row) => [
    sample({ operation: row.name, quantile: '0.5' }, row.durationMs.p50),
    sample({ operation: row.name, quantile: '0.95' }, row.durationMs.p95)
  ])));

  const providers = providerResilienceSnapshot();
  families.push(family('flai_provider_calls_total', 'counter', providers.map((row) => sample({ provider: row.key }, row.calls))));
  families.push(family('flai_provider_errors_total', 'counter', providers.map((row) => sample({ provider: row.key }, row.errors))));
  families.push(family('flai_provider_retries_total', 'counter', providers.map((row) => sample({ provider: row.key }, row.retries))));
  families.push(family('flai_provider_duration_ms_avg', 'gauge', providers.map((row) => sample({ provider: row.key }, row.averageDurationMs))));
  families.push(family('flai_provider_circuit_open', 'gauge', providers.map((row) => sample(
    { provider: row.key }, row.circuit === 'open' ? 1 : 0
  ))));

  if (options.db) {
    families.push(family('flai_jobs', 'gauge', readJobCounts(options.db).map((row) => sample({ status: row.status }, row.count))));
    const usage = readUsageTotals(options.db);
    families.push(family('flai_provider_requests_total', 'counter', [sample({}, usage.requests)]));
    families.push(family('flai_provider_cost_micros_total', 'counter', [sample({}, usage.costMicros)]));
  }

  families.push(family('flai_sqlite_wal_bytes', 'gauge', [sample({}, readFileSize(options.databasePath ? `${options.databasePath}-wal` : ''))]));
  families.push(family('flai_process_uptime_seconds', 'gauge', [sample({}, Math.floor(process.uptime()))]));
  families.push(family('flai_process_resident_memory_bytes', 'gauge', [sample({}, process.memoryUsage().rss)]));

  return `${families.filter(Boolean).join('\n')}\n`;
}

function family(name, type, samples) {
  if (!samples.length) return '';
  return [`# TYPE ${name} ${type}`, ...samples.map((entry) => `${name}${entry.labels} ${entry.value}`)].join('\n');
}

function sample(labels, value) {
  const pairs = Object.entries(labels).map(([key, raw]) => `${key}="${escapeLabelValue(raw)}"`);
  return { labels: pairs.length ? `{${pairs.join(',')}}` : '', value: formatValue(value) };
}

function escapeLabelValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

function readJobCounts(db) {
  try {
    return db.prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status ORDER BY status').all();
  } catch {
    return [];
  }
}

function readUsageTotals(db) {
  try {
    const row = db.prepare(
      'SELECT COALESCE(SUM(request_count), 0) AS requests, COALESCE(SUM(cost_micros), 0) AS cost_micros FROM user_daily_usage'
    ).get();
    return { requests: row?.requests || 0, costMicros: row?.cost_micros || 0 };
  } catch {
    return { requests: 0, costMicros: 0 };
  }
}

function readFileSize(filePath) {
  if (!filePath) return 0;
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
