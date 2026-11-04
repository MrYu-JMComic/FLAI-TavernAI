import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'background-memory-isolated-tests';
const { createAppDatabase } = await import('../db/runtime.js');
const { insertUser } = await import('./routeTestUtils.js');
const { createCharacter } = await import('../modules/characters.js');
const { getConversationForUser } = await import('../routes/helpers.js');
const { submitJob, claimNextJob, failJob } = await import('../services/jobs/jobQueue.js');
const { prepareMemoryGeneration } = await import('../services/conversationMemory/processingPolicy.js');
const { readMemoryShortTerm, mergeMemoryShortTerm } = await import('../services/conversationMemory/shortTerm.js');
const { buildPromptPipeline } = await import('../services/promptPipeline.js');
const { normalizeMemoryPolicy, portableMemoryDefaults } = await import('../../../shared/memoryPolicy.js');

const settings = { providerType: 'custom', baseUrl: 'https://background.invalid/v1', model: 'isolated', apiKey: 'fixture-key' };

/** Persist actual ordered turns and required jobs; no provider is called by preparation or compilation. */
function fixture(t, policy = {}, turns = 3) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'background-user', conversationId = 'background-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira', authorAdvancedSettings: {
    accessorySkills: { memoryAgent: { enabled: true, memoryPolicy: policy } }
  } });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at)
    VALUES(?,?,?,'Background','ready','2026-11-01','2026-11-01')`).run(conversationId, userId, character.id);
  const insert = database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,postprocess_state,created_at)
    VALUES(?,?,?,?,?,?,?)`);
  for (let index = 0; index < turns; index++) {
    insert.run(`user-${index}`, userId, conversationId, 'user', `User action ${index}. ${'detail '.repeat(200)}`, 'completed', `2026-11-01T00:00:${String(index * 2).padStart(2, '0')}Z`);
    insert.run(`assistant-${index}`, userId, conversationId, 'assistant', `Story outcome ${index}. ${'evidence '.repeat(200)}`, 'queued', `2026-11-01T00:00:${String(index * 2 + 1).padStart(2, '0')}Z`);
    submitJob(database, userId, 'conversation.postprocess', { conversationId, assistantMessageId: `assistant-${index}`,
      assistantRevision: 1, userMessageId: `user-${index}`, userRevision: 1, requiredStages: ['memory'] },
    { internal: true, idempotencyKey: `core-${index}`, maxAttempts: 1 });
  }
  const current = () => getConversationForUser(database, userId, conversationId, { includeUsage: false });
  return { database, userId, conversationId, character, current };
}

test('background defaults preserve workflow choices and private actor bindings remain nonportable', () => {
  assert.equal(normalizeMemoryPolicy().syncMode, 'background');
  assert.equal(normalizeMemoryPolicy().autoConsolidate, true);
  assert.equal(normalizeMemoryPolicy().statusLink, false);
  assert.equal(normalizeMemoryPolicy().shortTermTurns, 8);
  const policy = normalizeMemoryPolicy({ syncMode: 'blocking', shortTermTurns: 99, autoConsolidate: false, statusLink: true });
  assert.equal(policy.shortTermTurns, 32);
  assert.equal(policy.syncMode, 'blocking');
  const portable = portableMemoryDefaults({ memoryPolicy: { ...policy, actorId: 'private' } });
  assert.equal(portable.memoryPolicy.actorId, '');
  assert.equal(portable.memoryPolicy.statusLink, true);
});

test('several pending or failed cores permit generation immediately while retaining complete uncovered turns', async t => {
  const f = fixture(t);
  const timer = t.mock.method(globalThis, 'setTimeout', () => assert.fail('background preparation must not wait'));
  const first = await prepareMemoryGeneration(f.database, f.userId, f.current, { settings });
  assert.equal(first.summary.coreReady, false);
  assert.equal(first.shortTerm.turns, 3);
  assert.equal(first.shortTerm.messages.length, 6);
  const claimed = claimNextJob(f.database, 'worker', { types: ['conversation.postprocess'] });
  failJob(f.database, claimed.id, claimed.leaseOwner, new Error('isolated failure'));
  f.database.prepare("UPDATE messages SET postprocess_state='failed' WHERE id='assistant-0'").run();
  const failed = await prepareMemoryGeneration(f.database, f.userId, f.current, { settings });
  assert.equal(failed.summary.coreFailedCount, 1);
  assert.equal(failed.shortTerm.messages.length, 6);
  assert.equal(claimNextJob(f.database, 'later-worker', { types: ['conversation.postprocess'] }), null, 'acceptance ordering still cannot skip a failed gap');
  assert.equal(f.database.prepare('SELECT active_generation_id FROM conversations').get().active_generation_id, '');
  timer.mock.restore();
});

test('background capacity and invalid historical state fail explicitly rather than losing raw continuity', async t => {
  const f = fixture(t, { shortTermTurns: 2 });
  await assert.rejects(prepareMemoryGeneration(f.database, f.userId, f.current, { settings }), error =>
    error.code === 'MEMORY_SHORT_TERM_CAPACITY' && error.accepted === false);
  f.database.prepare("UPDATE conversations SET state_status='needs_rebuild'").run();
  await assert.rejects(prepareMemoryGeneration(f.database, f.userId, f.current, { settings }), error => error.code === 'CONVERSATION_STATE_REBUILD_REQUIRED');
});

test('strict actor isolation retains failure checking instead of injecting an unclassified raw bridge', async t => {
  const f = fixture(t, { isolation: 'actor', actorId: 'actor-1' });
  const claimed = claimNextJob(f.database, 'worker', { types: ['conversation.postprocess'] });
  failJob(f.database, claimed.id, claimed.leaseOwner, new Error('fixture core failure'));
  await assert.rejects(prepareMemoryGeneration(f.database, f.userId, f.current, { settings }), error => error.code === 'MEMORY_CORE_FAILED');
  assert.equal(readMemoryShortTerm(f.database, f.userId, f.conversationId, { policy: { isolation: 'actor' } }).enabled, false);
});

test('uncovered original messages remain in the final prompt under tight budgets and internal flags stay private', t => {
  const f = fixture(t);
  const pipeline = buildPromptPipeline(f.database, { conversation: f.current(), character: f.character,
    user: { id: f.userId }, history: [], content: 'Continue the scene.', providerSettings: settings,
    contextBudgetCharacters: 1000, tokenBudget: { inputTokenLimit: 200 } });
  const uncovered = pipeline.selectionManifest.filter(row => /^(user|assistant)-/.test(row.sourceId));
  assert.equal(uncovered.length, 6);
  assert.ok(uncovered.every(row => row.included && row.reason === 'protected'));
  assert.equal(pipeline.budget.overTokenBudget, true, 'generation can report the insufficient budget instead of sending amnesia');
  assert.ok(pipeline.modelMessages.every(message => !('_promptSource' in message) && !('shortTermRequired' in message)));
});

test('short-term cutoff, completion and ordered merge exclude future messages without duplication', t => {
  const f = fixture(t);
  const bridge = readMemoryShortTerm(f.database, f.userId, f.conversationId, { asOfOrder: 4 });
  assert.deepEqual(bridge.messages.map(row => row.id), ['user-0', 'assistant-0', 'user-1', 'assistant-1']);
  const merged = mergeMemoryShortTerm([{ id: 'old', content: 'Older' }, bridge.messages[1]], bridge);
  assert.deepEqual(merged.map(row => row.id), ['old', 'user-0', 'assistant-0', 'user-1', 'assistant-1']);
  f.database.prepare("UPDATE messages SET postprocess_state='completed' WHERE id IN ('assistant-0','assistant-1')").run();
  assert.deepEqual(readMemoryShortTerm(f.database, f.userId, f.conversationId).messages.map(row => row.id), ['user-2', 'assistant-2']);
  f.database.prepare("UPDATE messages SET postprocess_state='completed'").run();
  assert.deepEqual(readMemoryShortTerm(f.database, f.userId, f.conversationId).messages, []);
});
