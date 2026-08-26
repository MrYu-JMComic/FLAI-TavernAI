import { performance } from 'node:perf_hooks';

const metrics = new Map();
const MAX_SAMPLES = 512;

export function measureSync(name, operation, options = {}) {
  const startedAt = performance.now();
  try {
    const result = operation();
    observePerformance(name, performance.now() - startedAt, {
      rows: resolveRows(result, options.rows),
      outcome: 'success'
    });
    return result;
  } catch (error) {
    observePerformance(name, performance.now() - startedAt, {
      outcome: classifyError(error)
    });
    throw error;
  }
}

export async function measureAsync(name, operation, options = {}) {
  const startedAt = performance.now();
  try {
    const result = await operation();
    observePerformance(name, performance.now() - startedAt, {
      rows: resolveRows(result, options.rows),
      outcome: 'success'
    });
    return result;
  } catch (error) {
    observePerformance(name, performance.now() - startedAt, {
      outcome: classifyError(error)
    });
    throw error;
  }
}

export function observePerformance(name, durationMs, options = {}) {
  const key = String(name || 'operation').slice(0, 200);
  const current = metrics.get(key) || { durations: [], calls: 0, errors: {}, rows: 0 };
  current.calls += 1;
  current.rows += Math.max(0, Number(options.rows || 0));
  if (options.outcome && options.outcome !== 'success') {
    current.errors[options.outcome] = (current.errors[options.outcome] || 0) + 1;
  }
  current.durations.push(Math.max(0, Number(durationMs || 0)));
  if (current.durations.length > MAX_SAMPLES) current.durations.shift();
  metrics.set(key, current);
}

export function performanceMetricsSnapshot() {
  return [...metrics.entries()].map(([name, value]) => {
    const sorted = [...value.durations].sort((left, right) => left - right);
    return {
      name,
      calls: value.calls,
      errors: { ...value.errors },
      rows: value.rows,
      averageRows: value.calls ? round(value.rows / value.calls) : 0,
      durationMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.length ? round(sorted.at(-1)) : 0
      }
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function resetPerformanceMetrics() {
  metrics.clear();
}

function resolveRows(result, resolver) {
  if (typeof resolver === 'function') return resolver(result);
  if (Number.isFinite(Number(resolver))) return Number(resolver);
  if (Array.isArray(result)) return result.length;
  if (Array.isArray(result?.results)) return result.results.length;
  if (Array.isArray(result?.items)) return result.items.length;
  return 0;
}

function classifyError(error) {
  if (error?.code) return String(error.code).slice(0, 100);
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  return 'error';
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
