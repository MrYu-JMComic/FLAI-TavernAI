import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Application imports follow isolation, including imports that transitively reach provider configuration.
process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'memory-packet-postprocessing-isolated-tests';
const { createAppDatabase } = await import('../db/runtime.js');
const { createCharacter } = await import('../modules/characters.js');
const { getStatusBar, upsertStatusBar } = await import('../modules/statusBars.js');
const { insertUser } = await import('./routeTestUtils.js');
const { runConversationMemoryAgent } = await import('../services/conversationMemoryAgent.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');
const { runConversationPostprocessing } = await import('../services/jobs/conversationPostprocessing.js');
const { startJobWorker } = await import('../services/jobs/jobWorker.js');
const { getJob, getConversationProcessingSummary, submitJob } = await import('../services/jobs/jobQueue.js');
const { getMemoryProcessingState } = await import('../services/conversationMemory/commit.js');

const SETTINGS = Object.freeze({ providerType: 'custom', model: 'local-scripted-memory',
  baseUrl: 'https://memory-packet.invalid/v1', apiKey: 'isolated-fixture-key' });

/** Creates a pending opening with real queue ownership, source revisions and an authoritative domain row. */
function fixture(t) {
  const database = createAppDatabase(':memory:');
  let stopWorker;
  t.after(async () => { await stopWorker?.(); database.close(); });
  const userId = 'packet-postprocess-user';
  const conversationId = 'packet-postprocess-conversation';
  const messageId = 'packet-postprocess-opening';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira',
    authorAdvancedSettings: { accessorySkills: {
      memoryAgent: { enabled: true, memoryPolicy: { summaryEnabled: false } }, statusBarAgent: { enabled: true }
    } } });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at)
    VALUES(?,?,?,'Packet protocol regression','pending','2026-11-01','2026-11-01')`)
    .run(conversationId, userId, character.id);
  database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,postprocess_state,created_at)
    VALUES(?,?,?,'assistant','Mira opens the gate and keeps its key.','pending','2026-11-01T00:00:00.000Z')`)
    .run(messageId, userId, conversationId);
  upsertStatusBar(database, userId, conversationId, { variables: [{ name: 'HP', value: 80 }] });
  const submitted = submitJob(database, userId, 'conversation.postprocess', {
    conversationId, assistantMessageId: messageId, assistantRevision: 1, userMessageId: '', userRevision: 0,
    requiredStages: ['memory']
  }, { internal: true, idempotencyKey: 'opening-core', maxAttempts: 1 });
  const state = { modelInvocations: 0, memoryInvocations: 0, accessoryInvocations: 0,
    results: [], packets: [], rounds: 0 };
  const event = (key = 'opened') => ({ key, kind: 'event', content: `Gate observation ${key}.`,
    truthStatus: 'established', evidence: [{ messageId, quote: 'Mira opens the gate' }] });

  // Mock the model transport only. Each scripted call still passes through the production wire validator and session handler.
  const run = async (script, accessory = () => []) => {
    const runTools = async (_settings, _messages, tools, execute, options) => {
      state.modelInvocations++;
      state.rounds = options.maxRounds;
      const call = async (name, args) => {
        const raw = JSON.stringify(args);
        const prepared = await executeProviderTool(execute, name, raw,
          { raw: { function: { name, arguments: raw } } }, options.signal, tools,
          { database, userId, conversationId, jobId: submitted.id, stepKey: 'memory-protocol' });
        state.results.push({ name, ...prepared });
        return prepared;
      };
      await script(call, options);
      return { content: '', usage: { input_tokens: 0, output_tokens: 0 } };
    };
    stopWorker = startJobWorker(database, { workerId: 'packet-protocol-worker', pollMs: 50, concurrency: 1,
      handlers: { 'conversation.postprocess': environment => runConversationPostprocessing(database, environment, {
        settings: SETTINGS,
        runMemoryAgent: input => {
          state.memoryInvocations++;
          return runConversationMemoryAgent({ ...input, runTools, retryDelaysMs: [] });
        },
        runAccessoryAgents: input => {
          state.accessoryInvocations++;
          state.packets.push(structuredClone(input.extractionPacket));
          return accessory(input);
        }
      }) } });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const job = getJob(database, userId, submitted.id);
      if (['succeeded', 'failed', 'cancelled'].includes(job.status)) {
        await stopWorker();
        stopWorker = undefined;
        return job;
      }
      await delay(10);
    }
    assert.fail(`Opening core did not settle: ${JSON.stringify(getJob(database, userId, submitted.id))}`);
  };
  return { database, userId, conversationId, messageId, submitted, state, event, run };
}

/** Fails if rejected model output escapes into either canonical storage, derived outbox or authoritative state. */
function assertNoStoryWrites(f) {
  for (const table of ['memory_commits', 'memory_entities', 'memory_events', 'memory_source_versions',
    'memory_evidence', 'conversation_memories']) {
    assert.equal(f.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} must remain empty`);
  }
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM jobs WHERE stage<>'core'").get().n, 0);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM job_steps WHERE step_key='core'").get().n, 0);
  assert.equal(getStatusBar(f.database, f.userId, f.conversationId).variables[0].value, 80);
}

test('worker corrects an entities object map within one extraction before accessory planning or canonical acceptance', async t => {
  const f = fixture(t);
  const legal = { entities: [{ key: 'mira', name: 'Mira', kind: 'actor' }],
    events: [{ ...f.event(), subjectKey: 'mira', visibility: 'restricted', actorIds: ['mira'] }] };
  const job = await f.run(async call => {
    const rejected = await call('finish_memory_review', {
      packet: { ...legal, entities: { mira: { name: 'Mira', kind: 'actor' } } }
    });
    assert.equal(rejected.result.ok, false);
    assert.equal(rejected.stop, false, 'invalid finish must leave the correction loop open');
    assert.ok(rejected.result.issues.some(issue => issue.path === 'packet.entities'));
    assert.match(JSON.stringify(rejected.result), /array/i);
    assert.equal(f.state.accessoryInvocations, 0);
    assertNoStoryWrites(f);
    const corrected = await call('finish_memory_review', { summary: 'Gate continuity accepted.', packet: legal });
    assert.equal(corrected.result.ok, true);
    assert.equal(corrected.stop, true);
  }, ({ db, extractionPacket }) => {
    assert.ok(Array.isArray(extractionPacket.entities));
    assert.equal(extractionPacket.entities.length, 2, 'legacy fixtures also enroll the primary card identity in the accepted packet');
    assert.equal(extractionPacket.entities[0].key, 'mira');
    assert.equal(extractionPacket.events.length, 1);
    assert.equal(extractionPacket.messageId, f.messageId);
    assert.equal(extractionPacket.sources[0].messageId, f.messageId);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n, 0);
    upsertStatusBar(db, f.userId, f.conversationId, { variables: [{ name: 'HP', value: 65 }] });
    assert.equal(getStatusBar(f.database, f.userId, f.conversationId).variables[0].value, 80);
    return [{ skill: 'statusBarAgent', ok: true }];
  });
  assert.equal(job.status, 'succeeded', job.error?.message || JSON.stringify(job));
  assert.equal(job.attempt, 1);
  assert.equal(job.result.memories, 1);
  assert.equal(f.state.memoryInvocations, 1);
  assert.equal(f.state.modelInvocations, 1, 'correction must not require another extraction or job attempt');
  assert.equal(f.state.accessoryInvocations, 1);
  assert.equal(getStatusBar(f.database, f.userId, f.conversationId).variables[0].value, 65);
  const event = f.database.prepare('SELECT * FROM memory_events').get();
  const actor = f.database.prepare("SELECT id FROM memory_entities WHERE name='Mira'").get();
  assert.equal(event.visibility, 'restricted');
  assert.deepEqual(JSON.parse(event.actor_ids_json), [actor.id]);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n, 1);
  assert.equal(f.database.prepare('SELECT postprocess_state FROM messages WHERE id=?').get(f.messageId).postprocess_state, 'completed');
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).coreMessageId, f.messageId);
  const audit = f.database.prepare("SELECT status FROM ai_tool_executions WHERE tool_name='finish_memory_review' ORDER BY rowid").all();
  assert.deepEqual(audit.map(row => row.status), ['failed', 'succeeded']);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('uncorrected malformed finish exhausts the bounded extraction and fails core before any accessory or story write', async t => {
  const f = fixture(t);
  const job = await f.run(async (call, options) => {
    const staged = await call('record_memory', { memoryType: 'event', content: 'Mira keeps the key.',
      sourceMessageId: f.messageId, quote: 'keeps its key' });
    assert.equal(staged.result.ok, true);
    for (let round = 1; round < options.maxRounds; round++) {
      const rejected = await call('finish_memory_review', {
        packet: { entities: { mira: { name: 'Mira', kind: 'actor' } } }
      });
      assert.equal(rejected.result.ok, false);
      assert.equal(rejected.stop, false);
    }
    assertNoStoryWrites(f);
  }, () => { assert.fail('invalid prepared memory must not reach accessory planning'); });
  assert.equal(job.status, 'failed');
  assert.equal(job.attempt, 1);
  assert.equal(f.state.modelInvocations, 1);
  assert.equal(f.state.memoryInvocations, 1);
  assert.equal(f.state.accessoryInvocations, 0);
  assert.equal(f.state.results.length, f.state.rounds);
  assert.equal(f.state.results.filter(entry => entry.result.ok === true).length, 1,
    'only the isolated record_memory proposal was accepted');
  assertNoStoryWrites(f);
  assert.equal(f.database.prepare('SELECT postprocess_state FROM messages WHERE id=?').get(f.messageId).postprocess_state, 'failed');
  const summary = getConversationProcessingSummary(f.database, f.userId, f.conversationId);
  assert.equal(summary.coreReady, false);
  assert.equal(summary.coreFailedCount, 1);
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).coreOrder, 0);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('record_memory projections count toward the 80-event cap and oversized finish can be corrected before downstream agents run', async t => {
  const f = fixture(t);
  let stagedId;
  const explicitEvents = Array.from({ length: 80 }, (_, index) => f.event(`explicit-${index}`));
  const job = await f.run(async call => {
    const staged = await call('record_memory', { memoryType: 'event', content: 'Mira keeps the gate key.',
      sourceMessageId: f.messageId, quote: 'keeps its key' });
    assert.equal(staged.result.ok, true);
    stagedId = staged.result.memory.id;
    const rejected = await call('finish_memory_review', { packet: { events: explicitEvents } });
    assert.equal(rejected.result.ok, false);
    assert.equal(rejected.stop, false);
    assert.match(JSON.stringify(rejected.result), /events/);
    assert.match(JSON.stringify(rejected.result), /80/);
    assert.equal(f.state.accessoryInvocations, 0);
    assertNoStoryWrites(f);
    const corrected = await call('finish_memory_review', { packet: { events: explicitEvents.slice(0, 79) } });
    assert.equal(corrected.result.ok, true);
    assert.equal(corrected.stop, true);
  }, ({ extractionPacket }) => {
    assert.equal(extractionPacket.events.length, 80);
    assert.equal(extractionPacket.events.filter(event => event.key === `projection:${stagedId}`).length, 1);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversation_memories').get().n, 0);
    return [];
  });
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  assert.equal(job.attempt, 1);
  assert.equal(job.result.memories, 80);
  assert.equal(f.state.modelInvocations, 1);
  assert.equal(f.state.accessoryInvocations, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n, 80);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversation_memories').get().n, 80);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events WHERE memory_id=?').get(stagedId).n, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n, 1);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});
