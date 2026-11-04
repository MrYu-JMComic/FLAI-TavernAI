import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'memory-recovery-isolated-tests';
const { createAppDatabase } = await import('../db/runtime.js');
const { createCharacter } = await import('../modules/characters.js');
const { getStatusBar, upsertStatusBar } = await import('../modules/statusBars.js');
const { createProviderProfile } = await import('../repositories/providerProfileRepository.js');
const { writeConversationCheckpoint } = await import('../repositories/conversationSnapshotRepository.js');
const { listMemoryRecords } = await import('../repositories/conversationMemoryRepository.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { createConversationMessage } = await import('../routes/helpers.js');
const { encryptSecret, newId, nowIso } = await import('../security.js');
const { commitMemoryPacket, getMemoryProcessingState } = await import('../services/conversationMemory/commit.js');
const { requestConversationStateRebuild } = await import('../services/conversationTimeline.js');
const { cancelJob, claimNextJob, completeJob, failJob, getJob, submitJob } = await import('../services/jobs/jobQueue.js');
const { runConversationPostprocessing } = await import('../services/jobs/conversationPostprocessing.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

function fixture(t, { opening = '', structured = false } = {}) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'memory-recovery-owner';
  insertUser(database, userId);
  if (structured) createProviderProfile(database, userId, {
    providerType: 'custom', baseUrl: 'https://recovery-model.invalid/v1', model: 'mocked-memory',
    encryptedApiKey: encryptSecret('local-fixture-key')
  });
  const character = createCharacter(database, userId, {
    name: 'Mira', visibility: 'private', openingMessage: opening,
    authorAdvancedSettings: {
      accessorySkills: { memoryAgent: { enabled: structured } },
      statusBarBlueprint: { variables: [{ name: 'HP', value: 80 }] }
    }
  });
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database, newId, nowIso,
    requireAuth(request, _response, next) { request.auth = { user: { id: userId, username: userId } }; next(); },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
  }));
  app.use((error, _request, response, _next) => response.status(error.status || 500)
    .json({ error: error.message, code: error.code, accepted: error.accepted }));
  const message = (conversationId, content) => createConversationMessage(database, newId, nowIso,
    { userId, conversationId, role: 'assistant', content });
  const job = (conversationId, assistant, extra = {}) => submitJob(database, userId, 'conversation.postprocess', {
    conversationId, assistantMessageId: assistant.id, assistantRevision: assistant.revision,
    userMessageId: '', userRevision: 0, requiredStages: ['memory'], ...extra
  }, { internal: true, idempotencyKey: newId() });
  return { database, userId, character, app, message, job };
}

async function createStory(base, f) {
  const response = await fetch(`${base}/api/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId: f.character.id })
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

function failCore(f, job, { cancelled = false } = {}) {
  if (cancelled) cancelJob(f.database, f.userId, job.id);
  else {
    const claimed = claimNextJob(f.database, 'failing-worker', { types: ['conversation.postprocess'] });
    assert.equal(claimed.id, job.id);
    failJob(f.database, claimed.id, claimed.leaseOwner, Object.assign(new Error('fixture core failure'), { code: 'FIXTURE_CORE_FAILED' }));
  }
  f.database.prepare("UPDATE messages SET postprocess_state = 'failed' WHERE id = ?").run(job.payload.assistantMessageId);
}

function record(f, conversationId, assistant, content) {
  return commitMemoryPacket(f.database, f.userId, conversationId, {
    idempotencyKey: newId(), messageId: assistant.id, sources: [{ messageId: assistant.id, revision: assistant.revision }],
    events: [{ key: 'event', kind: 'event', content, truthStatus: 'established', evidence: [{ messageId: assistant.id, quote: assistant.content }] }]
  }, { enforceOrder: false });
}

test('real HTTP recovery replays a failed opening without a user and preserves initial blueprints', async t => {
  const f = fixture(t, { opening: 'Mira opens the gate.', structured: true });
  await withServer(f.app, async base => {
    const conversation = await createStory(base, f);
    const conversationId = conversation.id;
    const url = `${base}/api/conversations/${conversationId}/processing`;
    const send = body => fetch(`${url}/rebuild`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const opening = f.database.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conversationId);
    assert.equal(opening.role, 'assistant');
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND role = 'user'").get(conversationId).n, 0);
    const first = claimNextJob(f.database, 'opening-worker', { types: ['conversation.postprocess'] });
    assert.deepEqual(first.payload.requiredStages, ['memory', 'statusBarAgent']);
    await assert.rejects(runConversationPostprocessing(f.database, { job: first, payload: first.payload }, {
      runMemoryAgent: async () => { throw Object.assign(new Error('table conversation_memories has no column named visibility'), { code: 'ERR_SQLITE_ERROR' }); }
    }), /visibility/);
    failJob(f.database, first.id, first.leaseOwner, Object.assign(new Error('projection unavailable'), { code: 'ERR_SQLITE_ERROR' }));
    upsertStatusBar(f.database, f.userId, conversationId, { variables: [{ name: 'HP', value: 9 }] });
    writeConversationCheckpoint(f.database, f.userId, conversationId, { stateStatus: 'ready' });
    const failed = await fetch(url).then(response => response.json());
    assert.equal(failed.coreReady, false);
    assert.equal(failed.coreFailedCount, 1);
    assert.equal(failed.job.id, first.id);
    assert.equal(failed.job.canRetry, true);
    assert.equal(failed.stages.core[0].error.code, 'ERR_SQLITE_ERROR');
    assert.deepEqual(failed.stages, failed.job.stages);
    const before = getMemoryProcessingState(f.database, f.userId, conversationId);
    const preview = await send({}).then(response => response.json());
    assert.deepEqual(preview, { stateStatus: 'needs_rebuild', confirmationRequired: true, turnCount: 1 });
    assert.deepEqual(getMemoryProcessingState(f.database, f.userId, conversationId), before);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM jobs').get().n, 1);
    const response = await send({ confirmed: true });
    assert.equal(response.status, 200);
    const rebuilt = await response.json();
    assert.equal(rebuilt.stateStatus, 'pending');
    assert.equal(rebuilt.jobs.length, 1);
    assert.equal(rebuilt.jobs[0].payload.assistantMessageId, opening.id);
    assert.equal(rebuilt.jobs[0].payload.userMessageId, '');
    assert.equal(getStatusBar(f.database, f.userId, conversationId).variables[0].value, 80);
    assert.equal(f.database.prepare('SELECT postprocess_state FROM messages WHERE id = ?').get(opening.id).postprocess_state, 'queued');
    const job = claimNextJob(f.database, 'recovery-worker', { types: ['conversation.postprocess'] });
    assert.equal(job.id, rebuilt.jobs[0].id);
    let memoryCalls = 0;
    const result = await runConversationPostprocessing(f.database, { job, payload: job.payload }, {
      runMemoryAgent: async input => {
        memoryCalls++;
        assert.equal(input.userMessage, null);
        return { mode: 'prepared', packet: { events: [] }, commit: ({ applyDomainPlan, enqueueDerived }) =>
          commitMemoryPacket(f.database, f.userId, conversationId, {
            idempotencyKey: input.idempotencyKey, messageId: opening.id, sources: [{ messageId: opening.id, revision: 1 }],
            events: [{ key: 'gate', kind: 'event', content: 'The gate is open.', truthStatus: 'established', evidence: [{ messageId: opening.id, quote: 'opens the gate' }] }]
          }, { applyActions: applyDomainPlan, enqueueDerived }) };
      },
      runAccessoryAgents: async ({ db }) => {
        assert.equal(getStatusBar(db, f.userId, conversationId).variables[0].value, 80);
        upsertStatusBar(db, f.userId, conversationId, { variables: [{ name: 'HP', value: 65 }] });
        return [];
      }
    });
    completeJob(f.database, job.id, job.leaseOwner, result);
    assert.equal(memoryCalls, 1);
    assert.equal(getStatusBar(f.database, f.userId, conversationId).variables[0].value, 65);
    assert.equal(listMemoryRecords(f.database, f.userId, conversationId).length, 1);
    assert.equal(f.database.prepare('SELECT visibility FROM conversation_memories WHERE conversation_id = ?').get(conversationId).visibility, 'public');
    const ready = await fetch(url).then(response => response.json());
    assert.equal(ready.coreReady, true);
    assert.equal(ready.coreFailedCount, 0);
    assert.equal(ready.stages.core.at(-1).status, 'succeeded');
    assert.ok(ready.stages.summary.length + ready.stages.index.length > 0);
    assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

for (const cancelled of [false, true]) test(`rebuild restores the completed prefix before ${cancelled ? 'cancelled' : 'failed'} required core, excluding later memory`, async t => {
  const f = fixture(t);
  await withServer(f.app, async base => {
    const { id } = await createStory(base, f);
    const prefix = f.message(id, 'Mira holds the key.');
    record(f, id, prefix, 'The key is held.');
    f.database.prepare("UPDATE messages SET postprocess_state = 'completed' WHERE id = ?").run(prefix.id);
    writeConversationCheckpoint(f.database, f.userId, id);
    const broken = f.message(id, 'Mira tries the lock.');
    failCore(f, f.job(id, broken), { cancelled });
    const future = f.message(id, 'Mira leaves the town.');
    record(f, id, future, 'Future town departure.');
    upsertStatusBar(f.database, f.userId, id, { variables: [{ name: 'HP', value: 9 }] });
    writeConversationCheckpoint(f.database, f.userId, id, { stateStatus: 'ready' });
    assert.equal(requestConversationStateRebuild(f.database, f.userId, id).turnCount, 2);
    const rebuilt = requestConversationStateRebuild(f.database, f.userId, id, { confirmed: true });
    assert.deepEqual(rebuilt.jobs.map(job => job.payload.assistantMessageId), [broken.id, future.id]);
    assert.equal(getStatusBar(f.database, f.userId, id).variables[0].value, 80);
    assert.deepEqual(listMemoryRecords(f.database, f.userId, id).map(row => row.content), ['The key is held.']);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_events WHERE conversation_id = ?').get(id).n, 2);
    assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('rebuild without a trusted checkpoint detaches the future memory head while retaining immutable logs', async t => {
  const f = fixture(t);
  await withServer(f.app, async base => {
    const { id } = await createStory(base, f);
    f.database.prepare('DELETE FROM conversation_checkpoints WHERE conversation_id = ?').run(id);
    const broken = f.message(id, 'Mira tries the lock.');
    failCore(f, f.job(id, broken));
    const future = f.message(id, 'Mira leaves the town.');
    record(f, id, future, 'Future town departure.');
    const oldHead = getMemoryProcessingState(f.database, f.userId, id).commitId;
    const rebuilt = requestConversationStateRebuild(f.database, f.userId, id, { confirmed: true });
    assert.equal(rebuilt.jobs.length, 2);
    const state = getMemoryProcessingState(f.database, f.userId, id);
    assert.equal(state.commitId, '');
    assert.equal(state.coreOrder, 0);
    assert.deepEqual(listMemoryRecords(f.database, f.userId, id), []);
    assert.equal(getStatusBar(f.database, f.userId, id), null);
    assert.ok(f.database.prepare('SELECT id FROM memory_commits WHERE id = ?').get(oldHead));
    assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('processing HTTP supplies stable empty stages, timeline readiness, and independent derived failures', async t => {
  const f = fixture(t);
  await withServer(f.app, async base => {
    const { id } = await createStory(base, f);
    const url = `${base}/api/conversations/${id}/processing`;
    const read = () => fetch(url).then(response => response.json());
    const empty = await read();
    assert.equal(empty.job, null);
    assert.equal(empty.coreReady, true);
    assert.deepEqual(empty.requiredStages, []);
    assert.deepEqual(empty.stages, { core: [], summary: [], index: [] });
    for (const status of ['needs_rebuild', 'stale', 'legacy_partial', 'needs_review', 'pending']) {
      f.database.prepare('UPDATE conversations SET state_status = ? WHERE id = ?').run(status, id);
      assert.equal((await read()).coreReady, false, status);
    }
    f.database.prepare("UPDATE conversations SET state_status = 'ready' WHERE id = ?").run(id);
    const first = submitJob(f.database, f.userId, 'memory.index', { conversationId: id }, { internal: true, idempotencyKey: 'index-1' });
    const claimed = claimNextJob(f.database, 'index-worker', { types: ['memory.index'] });
    failJob(f.database, claimed.id, claimed.leaseOwner, new Error('index unavailable'));
    const second = submitJob(f.database, f.userId, 'memory.index', { conversationId: id }, { internal: true, idempotencyKey: 'index-2' });
    const derived = await read();
    assert.equal(derived.coreReady, true);
    assert.equal(derived.coreFailedCount, 0);
    assert.deepEqual(derived.stages.index.map(job => job.id), [first.id, second.id]);
    f.database.prepare("UPDATE conversations SET state_status = 'stale' WHERE id = ?").run(id);
    assert.equal((await read()).coreReady, false);
  });
});

test('missing required core sources are actionable errors, while optional raw failures allow a true zero-turn rebuild', async t => {
  const f = fixture(t);
  await withServer(f.app, async base => {
    const { id } = await createStory(base, f);
    const url = `${base}/api/conversations/${id}/processing/rebuild`;
    const broken = { id: 'missing-message', revision: 1 };
    const required = f.job(id, broken);
    failCore(f, required);
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CONVERSATION_REBUILD_SOURCE_MISSING');
    assert.equal(getJob(f.database, f.userId, required.id).status, 'failed');
    requestConversationStateRebuild(f.database, f.userId, id, { acceptCurrent: true });
    const optional = f.job(id, broken, { requiredStages: [], memoryMode: 'raw' });
    failCore(f, optional);
    const preview = requestConversationStateRebuild(f.database, f.userId, id);
    assert.equal(preview.turnCount, 0);
    assert.equal(requestConversationStateRebuild(f.database, f.userId, id, { confirmed: true }).stateStatus, 'ready');
  });
});

test('a zero-turn confirmation cannot schedule newly arrived work without a new preview', async t => {
  const f = fixture(t);
  await withServer(f.app, async base => {
    const { id } = await createStory(base, f);
    const url = `${base}/api/conversations/${id}/processing/rebuild`;
    const send = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const preview = await send({}).then(response => response.json());
    assert.equal(preview.turnCount, 0);
    f.message(id, 'Mira arrives after the preview.');
    const before = f.database.prepare('SELECT timeline_revision, state_status FROM conversations WHERE id = ?').get(id);
    const stale = await send({ confirmed: true, expectedTurnCount: preview.turnCount });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'CONVERSATION_REBUILD_PREVIEW_STALE');
    assert.deepEqual(f.database.prepare('SELECT timeline_revision, state_status FROM conversations WHERE id = ?').get(id), before);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM jobs WHERE conversation_id = ?').get(id).n, 0);
    const invalid = await send({ confirmed: true, expectedTurnCount: -1 });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'CONVERSATION_REBUILD_PREVIEW_INVALID');
    const refreshed = await send({}).then(response => response.json());
    assert.equal(refreshed.turnCount, 1);
    const confirmed = await send({ confirmed: true, expectedTurnCount: refreshed.turnCount });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).jobs.length, 1);
  });
});
