import crypto from 'node:crypto';
import {
  claimNextJob,
  completeJob,
  failJob,
  finishCancelledJob,
  getJob,
  heartbeatJob,
  reportJobProgress
} from './jobQueue.js';

export function startJobWorker(database, options = {}) {
  const workerId = String(options.workerId || `worker-${crypto.randomUUID()}`);
  const handlers = options.handlers || {};
  const concurrency = clampInteger(options.concurrency, 1, 16, 2);
  const pollMs = clampInteger(options.pollMs, 50, 60_000, 500);
  const leaseMs = clampInteger(options.leaseMs, 5_000, 15 * 60_000, 60_000);
  const running = new Set();
  const controllers = new Set();
  let timer = null;
  let stopped = false;

  const schedule = (delay = pollMs) => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delay);
    timer.unref?.();
  };

  const poll = async () => {
    if (stopped) return;
    const handlerTypes = Object.keys(handlers);
    if (!handlerTypes.length) {
      schedule();
      return;
    }
    while (running.size < concurrency) {
      const job = claimNextJob(database, workerId, {
        leaseMs,
        types: handlerTypes
      });
      if (!job) break;
      const controller = new AbortController();
      controllers.add(controller);
      const promise = runJob(database, job, workerId, handlers[job.type], { leaseMs, controller })
        .catch((error) => options.onError?.(error, job))
        .finally(() => {
          running.delete(promise);
          controllers.delete(controller);
          schedule(0);
        });
      running.add(promise);
    }
    schedule();
  };

  void poll();

  return async function stopJobWorker() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const controller of controllers) {
      controller.abort(jobAbortReason('Job worker is shutting down.', 'JOB_WORKER_SHUTDOWN'));
    }
    await Promise.allSettled([...running]);
  };
}

async function runJob(database, job, workerId, handler, options) {
  const controller = options.controller;
  const heartbeat = setInterval(() => {
    const latest = getJob(database, job.userId, job.id);
    if (latest?.cancelRequested) {
      controller.abort(jobAbortReason('Job was cancelled.', 'JOB_CANCELLED'));
      return;
    }
    if (!heartbeatJob(database, job.id, workerId, { leaseMs: options.leaseMs })) {
      controller.abort(jobAbortReason('Job lease was lost.', 'JOB_LEASE_LOST'));
    }
  }, Math.max(1000, Math.floor(options.leaseMs / 3)));
  heartbeat.unref?.();
  try {
    if (typeof handler !== 'function') {
      throw jobFailure('No worker is registered for this job type.', 'JOB_HANDLER_MISSING', false);
    }
    const result = await handler({
      job,
      payload: job.payload,
      signal: controller.signal,
      progress: (value, data) => reportJobProgress(database, job.id, workerId, value, data)
    });
    const latest = getJob(database, job.userId, job.id);
    if (latest?.cancelRequested || controller.signal.reason?.code === 'JOB_CANCELLED') {
      finishCancelledJob(database, job.id, workerId);
      return;
    }
    if (controller.signal.aborted) {
      failJob(database, job.id, workerId, controller.signal.reason, { retryable: true });
      return;
    }
    completeJob(database, job.id, workerId, result ?? {});
  } catch (error) {
    const latest = getJob(database, job.userId, job.id);
    if (latest?.cancelRequested || controller.signal.reason?.code === 'JOB_CANCELLED') {
      finishCancelledJob(database, job.id, workerId);
      return;
    }
    const abortReason = controller.signal.aborted ? controller.signal.reason : null;
    failJob(database, job.id, workerId, abortReason || error, {
      retryable: error?.retryable === true
        || ['JOB_WORKER_SHUTDOWN', 'JOB_LEASE_LOST'].includes(abortReason?.code)
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function jobFailure(message, code, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function jobAbortReason(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}
