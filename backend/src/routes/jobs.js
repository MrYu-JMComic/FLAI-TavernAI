import { Router } from 'express';
import { z } from 'zod';
import {
  cancelJob,
  getJob,
  JOB_TYPES,
  listJobEvents,
  listJobs,
  submitJob,
  TERMINAL_JOB_STATUSES
} from '../services/jobs/jobQueue.js';
import { writeSse } from './helpers.js';
import { validate } from '../validations/schemas.js';

const submitJobSchema = z.object({
  type: z.enum(JOB_TYPES),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  idempotencyKey: z.string().max(200).trim().optional()
}).strict();
const jobListQuerySchema = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30)
});
const jobEventQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  stream: z.enum(['0', '1']).optional().default('0')
});

export function createJobsRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  router.get('/', requireAuth, validate(jobListQuerySchema, 'query'), (request, response) => {
    response.json(listJobs(db, request.auth.user.id, request.validatedQuery));
  });

  router.post('/', requireAuth, validate(submitJobSchema), (request, response) => {
    const idempotencyKey = request.get('Idempotency-Key') || request.body.idempotencyKey;
    const job = submitJob(
      db,
      request.auth.user.id,
      request.body.type,
      request.body.payload,
      { idempotencyKey }
    );
    response.status(job.deduplicated ? 200 : 202).json(job);
  });

  router.get('/:jobId', requireAuth, (request, response) => {
    const job = getJob(db, request.auth.user.id, request.params.jobId);
    if (!job) {
      response.status(404).json({ error: '任务不存在' });
      return;
    }
    response.json(job);
  });

  router.delete('/:jobId', requireAuth, (request, response) => {
    const job = cancelJob(db, request.auth.user.id, request.params.jobId);
    if (!job) {
      response.status(404).json({ error: '任务不存在' });
      return;
    }
    response.json(job);
  });

  router.get('/:jobId/events', requireAuth, validate(jobEventQuerySchema, 'query'), (request, response) => {
    const query = request.validatedQuery;
    if (query.stream === '1' || String(request.get('Accept') || '').includes('text/event-stream')) {
      streamJobEvents(db, request, response, query.after);
      return;
    }
    const events = listJobEvents(db, request.auth.user.id, request.params.jobId, query);
    if (!events) {
      response.status(404).json({ error: '任务不存在' });
      return;
    }
    response.json({ events, nextCursor: events.at(-1)?.id || query.after });
  });

  return router;
}

function streamJobEvents(database, request, response, initialCursor) {
  const userId = request.auth.user.id;
  const jobId = request.params.jobId;
  if (!getJob(database, userId, jobId)) {
    response.status(404).json({ error: '任务不存在' });
    return;
  }
  request.socket?.setTimeout?.(0);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Content-Encoding': 'identity',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders?.();

  let cursor = Math.max(initialCursor, Number(request.get('Last-Event-ID') || 0));
  let sending = false;
  let closed = false;
  const sendAvailable = async () => {
    if (closed || sending) return;
    sending = true;
    try {
      const events = listJobEvents(database, userId, jobId, { after: cursor, limit: 100 }) || [];
      for (const event of events) {
        cursor = event.id;
        response.write(`id: ${event.id}\n`);
        await writeSse(response, event.type, event.data);
      }
      const job = getJob(database, userId, jobId);
      if (job && TERMINAL_JOB_STATUSES.has(job.status) && !events.length) {
        await writeSse(response, 'done', { status: job.status, cursor });
        close();
        response.end();
      }
    } finally {
      sending = false;
    }
  };
  const pollTimer = setInterval(() => void sendAvailable(), 500);
  const heartbeatTimer = setInterval(() => void writeSse(response, 'ping', { cursor }), 15_000);
  pollTimer.unref?.();
  heartbeatTimer.unref?.();
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  };
  request.once('aborted', close);
  response.once('close', close);
  void sendAvailable();
}
