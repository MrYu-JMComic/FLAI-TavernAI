import { performance } from 'node:perf_hooks';

const circuits = new Map();
const limiters = new Map();
const metrics = new Map();
const RETRYABLE_STATUSES = new Set([408, 425, 429, 502, 503, 504]);
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;

export async function executeProviderRequest(key, operation, options = {}) {
  const normalizedKey = String(key || 'provider:unknown').slice(0, 500);
  const timeoutMs = clampInteger(options.timeoutMs, 100, 30 * 60_000, 120_000);
  const concurrency = clampInteger(options.concurrency, 1, 32, 4);
  const maxRetries = options.idempotent
    ? clampInteger(options.retryBudget, 0, 4, 2)
    : 0;
  assertCircuitAvailable(normalizedKey);
  const release = await acquire(normalizedKey, concurrency, options.signal);
  const startedAt = performance.now();
  let attempts = 0;
  try {
    while (true) {
      attempts += 1;
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      try {
        const result = await operation({ signal, attempt: attempts });
        if (isRetryableResponse(result) && attempts <= maxRetries) {
          await result.body?.cancel?.().catch(() => {});
          await retryDelay(attempts, options.signal);
          continue;
        }
        if (isRetryableResponse(result)) {
          recordFailure(normalizedKey);
          observe(normalizedKey, startedAt, 'upstream_error', attempts);
        } else {
          recordSuccess(normalizedKey);
          observe(normalizedKey, startedAt, 'success', attempts);
        }
        return result;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const retryable = isRetryableError(error);
        if (retryable && attempts <= maxRetries) {
          await retryDelay(attempts, options.signal);
          continue;
        }
        if (retryable) recordFailure(normalizedKey);
        observe(normalizedKey, startedAt, retryable ? 'transport_error' : 'error', attempts);
        throw error;
      }
    }
  } finally {
    release();
  }
}

export function providerResilienceSnapshot() {
  const rows = [];
  const now = Date.now();
  for (const [key, values] of metrics) {
    const circuit = circuits.get(key);
    rows.push({
      key,
      calls: values.calls,
      errors: values.errors,
      retries: values.retries,
      totalDurationMs: round(values.totalDurationMs),
      maxDurationMs: round(values.maxDurationMs),
      averageDurationMs: values.calls ? round(values.totalDurationMs / values.calls) : 0,
      circuit: circuit?.openUntil > now ? 'open' : circuit?.failures ? 'closed-degraded' : 'closed',
      consecutiveFailures: circuit?.failures || 0,
      openUntil: circuit?.openUntil ? new Date(circuit.openUntil).toISOString() : null
    });
  }
  rows.sort((left, right) => left.key.localeCompare(right.key));
  return rows;
}

export function resetProviderResilienceState() {
  circuits.clear();
  limiters.clear();
  metrics.clear();
}

function assertCircuitAvailable(key) {
  const state = circuits.get(key);
  if (!state?.openUntil || state.openUntil <= Date.now()) return;
  const error = new Error('Provider circuit is temporarily open.');
  error.code = 'PROVIDER_CIRCUIT_OPEN';
  error.status = 503;
  error.publicMessage = 'AI Provider 暂时不可用，请稍后重试。';
  throw error;
}

function recordSuccess(key) {
  circuits.set(key, { failures: 0, openUntil: 0 });
}

function recordFailure(key) {
  const current = circuits.get(key) || { failures: 0, openUntil: 0 };
  const failures = current.failures + 1;
  circuits.set(key, {
    failures,
    openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0
  });
}

function observe(key, startedAt, outcome, attempts) {
  const durationMs = performance.now() - startedAt;
  const current = metrics.get(key) || {
    calls: 0,
    errors: 0,
    retries: 0,
    totalDurationMs: 0,
    maxDurationMs: 0
  };
  current.calls += 1;
  if (outcome !== 'success') current.errors += 1;
  current.retries += Math.max(0, attempts - 1);
  current.totalDurationMs += durationMs;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  metrics.set(key, current);
}

function acquire(key, limit, signal) {
  const state = limiters.get(key) || { active: 0, queue: [] };
  limiters.set(key, state);
  if (state.active < limit) {
    state.active += 1;
    return Promise.resolve(createRelease(key, state));
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, signal, onAbort: null };
    entry.onAbort = () => {
      const index = state.queue.indexOf(entry);
      if (index >= 0) state.queue.splice(index, 1);
      reject(signal.reason || new DOMException('Provider request aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      entry.onAbort();
      return;
    }
    signal?.addEventListener('abort', entry.onAbort, { once: true });
    state.queue.push(entry);
  });
}

function createRelease(key, state) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = state.queue.shift();
    if (next) {
      next.signal?.removeEventListener('abort', next.onAbort);
      next.resolve(createRelease(key, state));
      return;
    }
    state.active -= 1;
    if (!state.active) limiters.delete(key);
  };
}

function isRetryableResponse(response) {
  return RETRYABLE_STATUSES.has(Number(response?.status));
}

function isRetryableError(error) {
  return error?.retryable === true
    || error?.code === 'PROVIDER_NETWORK_ERROR'
    || error?.code === 'PROVIDER_TIMEOUT'
    || error?.name === 'TimeoutError';
}

function retryDelay(attempt, signal) {
  const delayMs = Math.min(1000, 50 * (2 ** (attempt - 1)));
  return new Promise((resolve, reject) => {
    let onAbort = null;
    const timer = setTimeout(() => {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (!signal) return;
    onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Provider retry aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
