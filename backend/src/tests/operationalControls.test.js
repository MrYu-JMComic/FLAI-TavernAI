import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createAsset } from '../modules/assets.js';
import { saveAvatarInput } from '../services/avatars.js';
import { recordAutomationAudit, listAutomationAudit } from '../services/automationAudit.js';
import { submitJob } from '../services/jobs/jobQueue.js';
import { executeProviderTask, listProviderRouteEvents } from '../services/providerTaskRouter.js';
import {
  consumeDailyRequest,
  getDailyUsage,
  getUserQuota,
  updateUserQuota
} from '../services/quotas.js';
import { insertUser } from './routeTestUtils.js';

const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('job, upload, request, and cost quotas reject work at their boundaries', () => {
  const database = createControlsDatabase();
  try {
    updateUserQuota(database, 'controls-user', {
      maxConcurrentAiJobs: 1,
      maxUploadBytes: 1024,
      maxDailyRequests: 1,
      maxDailyCostMicros: 10
    });
    submitJob(database, 'controls-user', 'memory.extract', {}, { idempotencyKey: 'quota-one' });
    for (let index = 0; index < 15; index += 1) {
      createAsset(database, 'controls-user', { dataUrl: onePixelPng, name: `asset-${index}` });
    }
    assert.throws(
      () => submitJob(database, 'controls-user', 'memory.extract', {}, { idempotencyKey: 'quota-two' }),
      (error) => error.code === 'AI_JOB_QUOTA_EXCEEDED'
    );
    assert.throws(
      () => createAsset(database, 'controls-user', { dataUrl: onePixelPng }),
      (error) => error.code === 'UPLOAD_QUOTA_EXCEEDED'
    );
    consumeDailyRequest(database, 'controls-user');
    assert.throws(
      () => consumeDailyRequest(database, 'controls-user'),
      (error) => error.code === 'DAILY_REQUEST_QUOTA_EXCEEDED'
    );
    assert.equal(getUserQuota(database, 'controls-user').maxConcurrentAiJobs, 1);
  } finally {
    database.close();
  }
});

test('storage quota includes legacy avatar bytes and avatar save paths', () => {
  const database = createControlsDatabase();
  try {
    updateUserQuota(database, 'controls-user', { maxUploadBytes: 1024 });
    const timestamp = new Date().toISOString();
    database.prepare(
      `INSERT INTO avatar_assets (
         id, user_id, owner_type, owner_id, mime_type, base64_data,
         byte_size, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'legacy-avatar-quota',
      'controls-user',
      'character',
      'legacy-character',
      'image/png',
      '',
      1000,
      timestamp,
      timestamp
    );
    assert.throws(
      () => saveAvatarInput(database, {
        userId: 'controls-user',
        ownerType: 'user',
        ownerId: 'controls-user',
        value: onePixelPng
      }),
      (error) => error.code === 'UPLOAD_QUOTA_EXCEEDED'
    );
  } finally {
    database.close();
  }
});

test('provider task routing records failed primary and charged fallback route', async () => {
  const database = createControlsDatabase();
  try {
    const routed = await executeProviderTask(database, {
      userId: 'controls-user',
      jobId: 'job-routing',
      taskType: 'world-book.assist',
      settings: { providerType: 'openai', model: 'primary-model' },
      routing: { fallbackModel: 'fallback-model' },
      operation: async (settings) => {
        if (settings.model === 'primary-model') {
          const error = new Error('primary unavailable');
          error.code = 'PROVIDER_UNAVAILABLE';
          throw error;
        }
        return { value: 'ok', usage: { inputTokens: 12, outputTokens: 4, costMicros: 17 } };
      }
    });
    assert.equal(routed.result.value, 'ok');
    assert.equal(routed.route.role, 'fallback');
    assert.equal(routed.route.model, 'fallback-model');
    const routes = listProviderRouteEvents(database, { userId: 'controls-user' }).reverse();
    assert.deepEqual(routes.map((route) => [route.role, route.status]), [
      ['primary', 'failed'],
      ['fallback', 'succeeded']
    ]);
    assert.equal(getDailyUsage(database, 'controls-user').costMicros, 17);
    assert.equal(getDailyUsage(database, 'controls-user').inputTokens, 12);
  } finally {
    database.close();
  }
});

test('shared automation audit records provenance and paginates by cursor', () => {
  const database = createControlsDatabase();
  try {
    recordAutomationAudit(database, 'controls-user', {
      domain: 'town',
      operation: 'generate',
      subjectType: 'town',
      subjectId: 'town-one',
      sourceMessageId: 'message-one',
      jobId: 'job-one',
      providerType: 'openai',
      model: 'model-one',
      planSummary: 'Create a town',
      before: { status: 'missing' },
      after: { status: 'created' }
    });
    recordAutomationAudit(database, 'controls-user', {
      domain: 'economy',
      operation: 'reward',
      rollbackOfId: 'audit-original'
    });
    const first = listAutomationAudit(database, 'controls-user', { limit: 1 });
    const second = listAutomationAudit(database, 'controls-user', { limit: 1, cursor: first.nextCursor });
    assert.equal(first.events.length, 1);
    assert.equal(second.events.length, 1);
    assert.notEqual(first.events[0].id, second.events[0].id);
    assert.ok(first.nextCursor);
    assert.equal(
      [...first.events, ...second.events].some((event) => event.sourceMessageId === 'message-one'),
      true
    );
  } finally {
    database.close();
  }
});

function createControlsDatabase() {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'controls-user');
  return database;
}
