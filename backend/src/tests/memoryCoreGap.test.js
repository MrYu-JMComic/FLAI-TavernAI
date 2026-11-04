import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'isolated-memory-core-gap-regressions';
const { createAppDatabase } = await import('../db/runtime.js');
const { createCharacter } = await import('../modules/characters.js');
const { getStatusBar, upsertStatusBar } = await import('../modules/statusBars.js');
const { insertUser } = await import('./routeTestUtils.js');
const { getMemoryMessage, listMemoryRecords } = await import('../repositories/conversationMemoryRepository.js');
const {
  assertMemoryCoreOrder, captureMemoryCheckpoint, commitMemoryPacket,
  ensureMemoryBaseline, getMemoryProcessingState, restoreMemoryCheckpoint
} = await import('../services/conversationMemory/commit.js');
const { requestConversationStateRebuild } = await import('../services/conversationTimeline.js');
const {
  cancelJob, claimNextJob, completeJob, failJob, finishCancelledJob,
  getConversationProcessingSummary, getJob, retryJob, submitJob
} = await import('../services/jobs/jobQueue.js');
const { runConversationPostprocessing } = await import('../services/jobs/conversationPostprocessing.js');

/** Build an isolated same-timestamp history so predecessor checks must use stable row order. */
function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'core-gap-owner';
  const conversationId = 'core-gap-story';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira' });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status)
    VALUES(?,?,?,'Core gap fixture','2026-11-02','2026-11-02','ready')`).run(conversationId, userId, character.id);
  let sequence = 0;
  const message = (state = 'queued') => {
    const id = `assistant-${++sequence}`;
    database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,postprocess_state,created_at)
      VALUES(?,?,?,'assistant',?,?,'2026-11-02T00:00:00.000Z')`).run(id, userId, conversationId, `Mira opens gate ${sequence}.`, state);
    return getMemoryMessage(database, userId, conversationId, id);
  };
  const job = (assistant, extra = {}) => submitJob(database, userId, 'conversation.postprocess', {
    conversationId, assistantMessageId: assistant.id, assistantRevision: assistant.revision,
    userMessageId: '', userRevision: 0, requiredStages: ['memory'], ...extra
  }, { internal: true, idempotencyKey: `fixture-job-${++sequence}` });
  return { database, userId, conversationId, character, message, job };
}

/** Commit one sourced turn, forwarding optional transactional effects into the real packet writer. */
function record(f, assistant, options = {}) {
  return commitMemoryPacket(f.database, f.userId, f.conversationId, {
    idempotencyKey: `fixture-record-${assistant.id}-${getMemoryProcessingState(f.database, f.userId, f.conversationId).revision}`,
    messageId: assistant.id, sources: [{ messageId: assistant.id, revision: assistant.revision }],
    events: [{ key: 'gate', kind: 'event', content: assistant.content,
      truthStatus: 'established', evidence: [{ messageId: assistant.id, quote: assistant.content }] }]
  }, options);
}

/** Move a queued fixture through real queue transitions, retaining its durable source binding. */
function transition(f, queued, status) {
  if (status === 'queued') return queued;
  const claimed = claimNextJob(f.database, 'fixture-worker', { types: ['conversation.postprocess'] });
  assert.equal(claimed.id, queued.id);
  if (status === 'running') return claimed;
  if (status === 'succeeded') completeJob(f.database, claimed.id, claimed.leaseOwner, { ok: true });
  else if (status === 'failed') failJob(f.database, claimed.id, claimed.leaseOwner,
    Object.assign(new Error('fixture failure'), { code: 'FIXTURE_CORE_FAILURE' }));
  else {
    cancelJob(f.database, f.userId, claimed.id);
    finishCancelledJob(f.database, claimed.id, claimed.leaseOwner);
  }
  return getJob(f.database, f.userId, queued.id);
}

/** Exercise real postprocessing and atomic domain acceptance with a scripted, network-free memory producer. */
async function runMockCore(f, job, { onMemory = () => {}, changeStatus = true } = {}) {
  let committed;
  const result = await runConversationPostprocessing(f.database, { job, payload: job.payload }, {
    runMemoryAgent: async input => {
      onMemory();
      const assistant = getMemoryMessage(f.database, f.userId, f.conversationId, input.assistantMessage.id);
      return { mode: 'prepared', packet: { events: [] }, commit: ({ applyDomainPlan, enqueueDerived }) => {
        committed = record(f, assistant, { applyActions: applyDomainPlan, enqueueDerived });
        return committed;
      } };
    },
    runAccessoryAgents: async ({ db }) => {
      if (changeStatus) upsertStatusBar(db, f.userId, f.conversationId,
        { variables: [{ name: 'Gate', value: job.payload.assistantMessageId }] });
      return [];
    }
  });
  assert.equal(completeJob(f.database, job.id, job.leaseOwner, result), true);
  return { result, committed };
}

/** Check rejection before callbacks and confirm that retained sources, events, and projections stay atomic. */
function assertAtomicGap(f, assistant) {
  const before = getMemoryProcessingState(f.database, f.userId, f.conversationId);
  const counts = () => ['memory_source_versions', 'memory_commits', 'memory_events', 'conversation_memories']
    .map(table => f.database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
  const beforeCounts = counts();
  let actions = 0;
  let derived = 0;
  assert.throws(() => record(f, assistant, {
    applyActions: () => { actions++; }, enqueueDerived: () => { derived++; }
  }), error => error.code === 'MEMORY_CORE_GAP');
  assert.deepEqual(getMemoryProcessingState(f.database, f.userId, f.conversationId), before);
  assert.deepEqual(counts(), beforeCounts);
  assert.equal(actions, 0);
  assert.equal(derived, 0);
}

test('accepting a failed prefix permits the next actual core worker without editing the old failed flag', async t => {
  const f = fixture(t);
  const old = f.message('failed');
  transition(f, f.job(old), 'failed');
  requestConversationStateRebuild(f.database, f.userId, f.conversationId, { acceptCurrent: true });
  assert.equal(f.database.prepare('SELECT postprocess_state FROM messages WHERE id=?').get(old.id).postprocess_state, 'failed');
  const next = f.message();
  const queued = f.job(next);
  const job = claimNextJob(f.database, 'next-worker', { types: ['conversation.postprocess'] });
  assert.equal(job.id, queued.id);
  const { committed } = await runMockCore(f, job);
  assert.equal(committed.coreOrder, next.narrative_order);
  assert.equal(listMemoryRecords(f.database, f.userId, f.conversationId).length, 1);
  assert.equal(getStatusBar(f.database, f.userId, f.conversationId).variables[0].value, next.id);
  assert.equal(getConversationProcessingSummary(f.database, f.userId, f.conversationId).coreReady, true);
});

for (const terminal of ['failed', 'cancelled']) test(`an explicitly optional ${terminal} predecessor permits a required core commit`, async t => {
  const f = fixture(t);
  const old = f.message('failed');
  transition(f, f.job(old, { requiredStages: [], memoryMode: 'raw' }), terminal);
  const next = f.message();
  const queued = f.job(next);
  const job = claimNextJob(f.database, 'required-worker', { types: ['conversation.postprocess'] });
  assert.equal(job.id, queued.id);
  await runMockCore(f, job);
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).coreMessageId, next.id);
  assert.equal(getConversationProcessingSummary(f.database, f.userId, f.conversationId).coreReady, true);
});

for (const requiredStages of [['memory'], undefined]) for (const status of ['queued', 'running', 'failed', 'cancelled']) {
  test(`${requiredStages ? 'required' : 'legacy'} ${status} jobs reject later commits even with a completed message flag`, t => {
    const f = fixture(t);
    const old = f.message('completed');
    transition(f, f.job(old, { requiredStages }), status);
    const next = f.message();
    assertAtomicGap(f, next);
  });
}

for (const status of ['queued', 'running']) test(`optional ${status} work remains serial until it settles`, t => {
  const f = fixture(t);
  const old = f.message('completed');
  transition(f, f.job(old, { requiredStages: [] }), status);
  assertAtomicGap(f, f.message());
});

test('a succeeded current core job overrides a retained failed message flag', t => {
  const f = fixture(t);
  const old = f.message('failed');
  transition(f, f.job(old), 'succeeded');
  const next = f.message();
  const receipt = record(f, next);
  assert.equal(receipt.coreOrder, next.narrative_order);
});

for (const staleField of ['timelineRevision', 'assistantRevision']) {
  test(`a stale ${staleField} failure cannot override a succeeded current source job`, t => {
    const f = fixture(t);
    const old = f.message('failed');
    transition(f, f.job(old), 'succeeded');
    transition(f, f.job(old, { [staleField]: 0 }), 'failed');
    assert.equal(record(f, f.message()).accepted, 1);
  });
  test(`a stale ${staleField} success cannot hide an unfinished current source job`, t => {
    const f = fixture(t);
    const old = f.message('completed');
    transition(f, f.job(old, { [staleField]: 0 }), 'succeeded');
    f.job(old);
    assertAtomicGap(f, f.message());
  });
}

for (const state of ['queued', 'pending', 'running', 'failed']) test(`an orphan ${state} predecessor above accepted coverage remains a gap`, t => {
  const f = fixture(t);
  f.message(state);
  assertAtomicGap(f, f.message());
});

test('a bootstrap opening below an author correction head is still unprocessed without a turn receipt', t => {
  const f = fixture(t);
  const opening = f.message('failed');
  ensureMemoryBaseline(f.database, f.userId, f.conversationId, { kind: 'bootstrap', messageId: opening.id });
  commitMemoryPacket(f.database, f.userId, f.conversationId, {
    idempotencyKey: 'manual-after-bootstrap', events: [{ key: 'canon', content: 'The north gate is ancient.' }]
  }, { kind: 'author_correction', enforceOrder: false });
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).coreOrder, opening.narrative_order);
  assertAtomicGap(f, f.message());
});

test('an accepted turn beneath an author correction head covers an orphan stale failure flag', t => {
  const f = fixture(t);
  const accepted = f.message();
  record(f, accepted);
  f.database.prepare("UPDATE messages SET postprocess_state='failed' WHERE id=?").run(accepted.id);
  commitMemoryPacket(f.database, f.userId, f.conversationId, {
    idempotencyKey: 'manual-after-turn', events: [{ key: 'canon', content: 'The north gate is ancient.' }]
  }, { kind: 'author_correction', enforceOrder: false });
  assert.equal(record(f, f.message()).accepted, 1);
});

test('restoring a checkpoint does not reuse discarded future turn coverage', t => {
  const f = fixture(t);
  const first = f.message();
  record(f, first);
  f.database.prepare("UPDATE messages SET postprocess_state='completed' WHERE id=?").run(first.id);
  const checkpoint = captureMemoryCheckpoint(f.database, f.userId, f.conversationId);
  const discarded = f.message();
  record(f, discarded);
  f.database.prepare("UPDATE messages SET postprocess_state='failed' WHERE id=?").run(discarded.id);
  restoreMemoryCheckpoint(f.database, f.userId, f.conversationId, checkpoint);
  assert.equal(listMemoryRecords(f.database, f.userId, f.conversationId).length, 1);
  assertAtomicGap(f, f.message());
});

test('known orphan dependencies reject postprocessing before either model is invoked', async t => {
  const f = fixture(t);
  f.message('failed');
  const next = f.message();
  const queued = f.job(next);
  const job = claimNextJob(f.database, 'blocked-worker', { types: ['conversation.postprocess'] });
  assert.equal(job.id, queued.id);
  let memoryCalls = 0;
  let accessoryCalls = 0;
  await assert.rejects(runConversationPostprocessing(f.database, { job, payload: job.payload }, {
    runMemoryAgent: async () => { memoryCalls++; return { mode: 'raw' }; },
    runAccessoryAgents: async () => { accessoryCalls++; return []; }
  }), error => error.code === 'MEMORY_CORE_GAP');
  assert.equal(memoryCalls, 0);
  assert.equal(accessoryCalls, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM memory_commits').get().n, 0);
});

test('manual retry finishes the failed source and the following queued turn in order', async t => {
  const f = fixture(t);
  const first = f.message();
  const queuedFirst = f.job(first);
  const failed = claimNextJob(f.database, 'failing-worker', { types: ['conversation.postprocess'] });
  assert.equal(failed.id, queuedFirst.id);
  const error = Object.assign(new Error('fixture model unavailable'), { code: 'FIXTURE_MODEL_FAILED' });
  await assert.rejects(runConversationPostprocessing(f.database, { job: failed, payload: failed.payload }, {
    runMemoryAgent: async () => { throw error; }
  }), candidate => candidate === error);
  failJob(f.database, failed.id, failed.leaseOwner, error);
  const next = f.message();
  const queuedNext = f.job(next);
  assert.equal(claimNextJob(f.database, 'blocked-worker', { types: ['conversation.postprocess'] }), null);
  retryJob(f.database, f.userId, failed.id);
  const retried = claimNextJob(f.database, 'retry-worker', { types: ['conversation.postprocess'] });
  assert.equal(retried.id, failed.id);
  await runMockCore(f, retried);
  const following = claimNextJob(f.database, 'following-worker', { types: ['conversation.postprocess'] });
  assert.equal(following.id, queuedNext.id);
  await runMockCore(f, following);
  assert.equal(listMemoryRecords(f.database, f.userId, f.conversationId).length, 2);
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).coreMessageId, next.id);
  assert.equal(getConversationProcessingSummary(f.database, f.userId, f.conversationId).coreReady, true);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('the shared order assertion returns its live anchor and rejects backwards or missing sources', t => {
  const f = fixture(t);
  const first = f.message('completed');
  const later = f.message('completed');
  record(f, later);
  assert.equal(assertMemoryCoreOrder(f.database, f.userId, f.conversationId, later.id).id, later.id);
  assert.throws(() => assertMemoryCoreOrder(f.database, f.userId, f.conversationId, first.id),
    error => error.code === 'MEMORY_CORE_ORDER');
  assert.throws(() => assertMemoryCoreOrder(f.database, f.userId, f.conversationId, 'missing-assistant'),
    error => error.code === 'JOB_SOURCE_STALE');
});
