import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createJobsRouter } from '../routes/jobs.js';
import {
  cancelJob,
  claimNextJob,
  completeJob,
  getJob,
  listJobEvents,
  listJobs,
  recoverExpiredJobs,
  reportJobProgress,
  submitJob
} from '../services/jobs/jobQueue.js';
import { startJobWorker } from '../services/jobs/jobWorker.js';
import { insertUser, withServer } from './routeTestUtils.js';

test('durable jobs deduplicate submission and persist progress events', () => {
  const database = createJobsDatabase();
  try {
    const first = submitJob(database, 'jobs-user', 'memory.extract', { conversationId: 'conv-1' }, {
      idempotencyKey: 'memory-turn-1'
    });
    const duplicate = submitJob(database, 'jobs-user', 'memory.extract', { conversationId: 'conv-1' }, {
      idempotencyKey: 'memory-turn-1'
    });
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(listJobs(database, 'jobs-user').jobs.length, 1);

    const claimed = claimNextJob(database, 'worker-a', { now: 1000, leaseMs: 5000 });
    assert.equal(claimed.id, first.id);
    assert.equal(claimed.attempt, 1);
    assert.equal(reportJobProgress(database, first.id, 'worker-a', 45, { phase: 'extracting' }), true);
    assert.equal(completeJob(database, first.id, 'worker-a', { created: 2 }), true);

    const completed = getJob(database, 'jobs-user', first.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.progress, 100);
    assert.deepEqual(completed.result, { created: 2 });
    const events = listJobEvents(database, 'jobs-user', first.id, { after: 0 });
    assert.deepEqual(events.map((event) => event.type), ['queued', 'running', 'progress', 'succeeded']);
    assert.deepEqual(listJobEvents(database, 'jobs-user', first.id, { after: events[1].id }).map((event) => event.type), [
      'progress',
      'succeeded'
    ]);

    submitJob(database, 'jobs-user', 'memory.extract', { conversationId: 'conv-2' }, {
      idempotencyKey: 'memory-turn-2'
    });
    submitJob(database, 'jobs-user', 'world-book.assist', {}, {
      idempotencyKey: 'world-book-turn-1'
    });
    const firstPage = listJobs(database, 'jobs-user', { limit: 1 });
    const secondPage = listJobs(database, 'jobs-user', { limit: 1, cursor: firstPage.nextCursor });
    assert.ok(firstPage.nextCursor);
    assert.notEqual(firstPage.jobs[0].id, secondPage.jobs[0].id);
    assert.throws(
      () => listJobs(database, 'jobs-user', { status: 'queued', cursor: firstPage.nextCursor }),
      (error) => error.code === 'INVALID_CURSOR'
    );
  } finally {
    database.close();
  }
});

test('expired leases recover without creating a second business job', () => {
  const database = createJobsDatabase();
  try {
    const submitted = submitJob(database, 'jobs-user', 'town.generate', { prompt: 'A town' }, {
      idempotencyKey: 'town-one'
    });
    claimNextJob(database, 'worker-crashed', { now: 1000, leaseMs: 5000 });
    assert.equal(recoverExpiredJobs(database, 6001), 1);
    const recovered = claimNextJob(database, 'worker-recovered', { now: 7000, leaseMs: 5000 });
    assert.equal(recovered.id, submitted.id);
    assert.equal(recovered.attempt, 2);
    assert.equal(listJobs(database, 'jobs-user').jobs.length, 1);
  } finally {
    database.close();
  }
});

test('queued job cancellation is terminal and cannot be claimed', () => {
  const database = createJobsDatabase();
  try {
    const submitted = submitJob(database, 'jobs-user', 'world-book.assist', {}, {
      idempotencyKey: 'cancel-me'
    });
    const cancelled = cancelJob(database, 'jobs-user', submitted.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(claimNextJob(database, 'worker-a'), null);
  } finally {
    database.close();
  }
});

test('job worker executes registered handlers and stops cleanly', async () => {
  const database = createJobsDatabase();
  const submitted = submitJob(database, 'jobs-user', 'memory.extract', { count: 3 }, {
    idempotencyKey: 'worker-run'
  });
  const stop = startJobWorker(database, {
    workerId: 'test-worker',
    pollMs: 50,
    handlers: {
      'memory.extract': async ({ payload, progress }) => {
        progress(50, { phase: 'test' });
        return { count: payload.count };
      }
    }
  });
  try {
    const completed = await waitForJob(database, submitted.id, 'succeeded');
    assert.deepEqual(completed.result, { count: 3 });
  } finally {
    await stop();
    database.close();
  }
});

test('job routes enforce user ownership and idempotency headers', async () => {
  const database = createJobsDatabase();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.auth = { user: { id: 'jobs-user' } };
    next();
  });
  app.use('/api/jobs', createJobsRouter({
    db: database,
    requireAuth: (_request, _response, next) => next()
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  try {
    await withServer(app, async (baseUrl) => {
      const request = () => fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'route-job-one' },
        body: JSON.stringify({ type: 'memory.extract', payload: { conversationId: 'conv-1' } })
      });
      const firstResponse = await request();
      const first = await firstResponse.json();
      const secondResponse = await request();
      const second = await secondResponse.json();
      assert.equal(firstResponse.status, 202);
      assert.equal(secondResponse.status, 200);
      assert.equal(second.id, first.id);

      const eventsResponse = await fetch(`${baseUrl}/api/jobs/${first.id}/events?stream=0`, {
        headers: { Accept: 'application/json' }
      });
      const events = await eventsResponse.json();
      assert.equal(events.events[0].type, 'queued');
      assert.equal(getJob(database, 'other-user', first.id), null);
    });
  } finally {
    database.close();
  }
});

function createJobsDatabase() {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'jobs-user');
  insertUser(database, 'other-user');
  return database;
}

async function waitForJob(database, jobId, status) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const job = getJob(database, 'jobs-user', jobId);
    if (job?.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Job ${jobId} did not reach ${status}`);
}
