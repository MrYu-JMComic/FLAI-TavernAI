import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

process.env.APP_SECRET = 'test-secret-town-removal';

const { appConfig } = await import('../config.js');
const { createApp } = await import('../app.js');
const { createAppDatabase } = await import('../db/runtime.js');
const { initializeDatabase, resetColumnCache } = await import('../db/schema.js');
const { createSession } = await import('../security.js');
const { buildOpenApiDocument } = await import('../services/apiContracts.js');
const { createDefaultJobHandlers } = await import('../services/jobs/jobHandlers.js');
const { claimNextJob, retryJob, submitJob } = await import('../services/jobs/jobQueue.js');
const { listAiToolPolicies } = await import('../services/toolRegistry.js');
const { updateUserQuota } = await import('../services/quotas.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('new databases and AI runtime no longer expose the town domain', t => {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  insertUser(database, 'removal-user');
  const schema = database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all();
  assert.equal(schema.some(row => /^(?:idx_)?town_/.test(row.name)), false);
  const document = buildOpenApiDocument(appConfig);
  assert.equal(Object.keys(document.paths).some(path => path.startsWith('/towns')), false);
  assert.equal(Object.keys(document.components.schemas).some(name => name.startsWith('Town')), false);
  assert.equal(listAiToolPolicies().some(policy => policy.domain === 'town'), false);
  const handlers = createDefaultJobHandlers(database);
  assert.equal(Object.keys(handlers).some(name => name.startsWith('town.')), false);
  assert.throws(() => submitJob(database, 'removal-user', 'town.generate', {}, { idempotencyKey: 'retired' }),
    error => error.code === 'JOB_TYPE_UNSUPPORTED');

  database.prepare(`INSERT INTO jobs (id, user_id, type, status, created_at, updated_at)
    VALUES ('retired-job', 'removal-user', 'town.generate', 'queued', '2026-01-01', '2026-01-01')`).run();
  assert.equal(claimNextJob(database, 'worker', { types: Object.keys(handlers) }), null);
  updateUserQuota(database, 'removal-user', { maxConcurrentAiJobs: 1 });
  assert.equal(submitJob(database, 'removal-user', 'world-book.assist', {}, { idempotencyKey: 'supported' }).status, 'queued');
  assert.throws(() => submitJob(database, 'removal-user', 'world-book.assist', {}, { idempotencyKey: 'over-quota' }),
    error => error.code === 'AI_JOB_QUOTA_EXCEEDED');
  database.prepare("UPDATE jobs SET status = 'failed' WHERE id = 'retired-job'").run();
  assert.throws(() => retryJob(database, 'removal-user', 'retired-job'),
    error => error.code === 'JOB_TYPE_UNSUPPORTED');
  assert.equal(database.prepare("SELECT status FROM jobs WHERE id = 'retired-job'").get().status, 'failed');
});

test('startup preserves historical town records and migration identities without recreating the domain', t => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(`CREATE TABLE town_worlds (id TEXT PRIMARY KEY, name TEXT, initialization_script TEXT);
    CREATE TABLE town_residents (id TEXT PRIMARY KEY, town_id TEXT REFERENCES town_worlds(id), name TEXT);
    INSERT INTO town_worlds VALUES ('old-world', 'Historical world', 'Original idea');
    INSERT INTO town_residents VALUES ('old-resident', 'old-world', 'Historical resident');`);
  const retiredSchema = () => database.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'town_%' ORDER BY name").all();
  const before = retiredSchema();
  resetColumnCache();
  initializeDatabase(database);
  const ledger = database.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  initializeDatabase(database);
  assert.deepEqual(retiredSchema(), before);
  assert.deepEqual({ ...database.prepare('SELECT * FROM town_worlds').get() },
    { id: 'old-world', name: 'Historical world', initialization_script: 'Original idea' });
  assert.equal(database.prepare('SELECT name FROM town_residents').get().name, 'Historical resident');
  assert.deepEqual(database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), ledger);
  assert.equal(ledger.find(row => row.version === '0006').checksum,
    '2a22cb8a1009fe634997af9c0a4db36b7ea1b3fd82e868bbbd294b0e570782a0');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('removed town HTTP routes return 404 and generation jobs are rejected', async t => {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  insertUser(database, 'route-user');
  const cookie = `flai_session=${createSession(database, 'route-user')}`;
  const app = createApp({ db: database, logger: { error() {}, warn() {}, info() {}, debug() {} } });
  await withServer(app, async baseUrl => {
    const csrfResponse = await fetch(`${baseUrl}/api/csrf-token`, { headers: { Cookie: cookie } });
    const { csrfToken } = await csrfResponse.json();
    const headers = {
      Cookie: `${cookie}; flai_csrf=${csrfToken}`,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    };
    for (const [method, suffix] of [
      ['GET', ''], ['POST', ''], ['POST', '/generate'], ['GET', '/old-world'],
      ['POST', '/old-world/advance-ai'], ['PATCH', '/old-world/clock'], ['DELETE', '/old-world'],
      ['GET', '/old-world/residents/old-resident/cognition'],
      ['POST', '/old-world/residents/old-resident/cognition-ai']
    ]) {
      const response = await fetch(`${baseUrl}/api/towns${suffix}`, { method, headers });
      assert.equal(response.status, 404, `${method} ${suffix}`);
    }
    const rejected = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'town.generate', idempotencyKey: 'retired', payload: {} })
    });
    assert.equal(rejected.status, 400);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 0);
    for (const suffix of ['/characters', '/world-books', '/jobs', '/health/ready']) {
      const response = await fetch(`${baseUrl}/api${suffix}`, { headers });
      assert.equal(response.status, 200, suffix);
    }
  });
});
