import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { createCharacter } from '../modules/characters.js';
import { createConversationMemory, mergeConversationMemories, undoConversationMemoryMerge } from '../modules/conversationMemories.js';
import { upsertStatusBar } from '../modules/statusBars.js';
import { createSave, getSave, listSaves, loadSave } from '../modules/saves.js';
import { branchConversation } from '../modules/branches.js';
import { createSwipe, setActiveSwipe } from '../modules/swipes.js';
import { createCastMember, createCastMemory, ensureConversationProtagonist, upsertCastMemberItem } from '../services/cast/castCommandService.js';
import { captureConversationSnapshot, restoreConversationSnapshot, SNAPSHOT_STATE_TABLES, writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { beginConversationGeneration, endConversationGeneration, enqueueConversationPostprocessing, invalidateConversationTimeline, requestConversationStateRebuild } from '../services/conversationTimeline.js';
import { cancelJob, claimNextJob, completeJob, failJob, getJob, recoverExpiredJobs, retryJob, submitJob } from '../services/jobs/jobQueue.js';
import { startJobWorker } from '../services/jobs/jobWorker.js';
import { runConversationPostprocessing, runRecoverableConversationStep } from '../services/jobs/conversationPostprocessing.js';
import { createDefaultJobHandlers } from '../services/jobs/jobHandlers.js';
import { createConversationAssistantResultService } from '../services/conversationAssistantResults.js';
import { createConversationMessage, deleteConversationMessage, deleteConversationMessagesFrom, updateConversationMessage, updateConversationTimestamp } from '../routes/helpers.js';
import { pruneConversationDerivedStorage } from '../services/conversationRetention.js';
import { appConfig } from '../config.js';
import { executeProviderTool } from '../services/providerToolResults.js';
import { newId, nowIso } from '../security.js';
import { insertUser } from './routeTestUtils.js';

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'timeline-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Timeline Character' });
  const conversationId = 'timeline-conversation';
  database.prepare("INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at, state_status) VALUES (?, ?, ?, 'Timeline', ?, ?, 'ready')")
    .run(conversationId, userId, character.id, nowIso(), nowIso());
  ensureConversationProtagonist(database, userId, conversationId);
  const message = (role, content, attachments = []) => createConversationMessage(database, newId, nowIso, { userId, conversationId, role, content, attachments });
  writeConversationCheckpoint(database, userId, conversationId);
  return { database, userId, character, conversationId, message };
}

function seedState(f) {
  const { database, userId, conversationId } = f;
  const member = createCastMember(database, userId, conversationId, { canonicalName: 'Mira' });
  const memory = createCastMemory(database, userId, conversationId, member.id, { content: 'Mira knows the harbor.' });
  upsertCastMemberItem(database, userId, conversationId, member.id, { name: 'Silver key', itemCode: 'KEY-1', quantity: 1 });
  createConversationMemory(database, userId, conversationId, { content: 'The key belongs to Mira.' });
  upsertStatusBar(database, userId, conversationId, { name: 'State', variables: [{ name: 'HP', value: 80, max: 100 }] });
  const now = nowIso();
  database.prepare('INSERT INTO scene_nodes (id, conversation_id, node_type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('harbor', conversationId, 'main_scene', 'Harbor', now, now);
  database.prepare('INSERT INTO scene_nodes (id, conversation_id, parent_id, node_type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('warehouse', conversationId, 'harbor', 'building', 'Warehouse', now, now);
  database.prepare('UPDATE cast_members SET current_scene_node_id = ? WHERE id = ?').run('warehouse', member.id);
  database.prepare('INSERT INTO economy_accounts (id, user_id, conversation_id, currency_type, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('gold-account', userId, conversationId, 'gold', 40, now, now);
  database.prepare('INSERT INTO economy_transactions (id, account_id, amount, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('gold-transaction', 'gold-account', 40, 'income', now);
  database.prepare('INSERT INTO quests (id, conversation_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('quest-1', conversationId, 'Find the harbor', now, now);
  database.prepare('INSERT INTO quest_objectives (id, quest_id, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('objective-1', 'quest-1', 'Visit Mira', now, now);
  database.prepare('INSERT INTO world_clocks (conversation_id, current_day, minute_of_day, weather, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(conversationId, 3, 400, 'rain', now);
  return { member, memory };
}

test('versioned save restores all domain tables and image asset references, not just text', (t) => {
  const f = fixture(t);
  const { database, userId, conversationId, message } = f;
  message('user', 'At the harbor', [{ type: 'image', url: '/api/assets/asset-image', name: 'map.png' }]);
  message('assistant', 'Mira arrived.');
  seedState(f);
  const before = captureConversationSnapshot(database, userId, conversationId);
  const save = createSave(database, userId, conversationId, { name: 'Complete save' });
  assert.equal(getSave(database, userId, save.id).snapshot.version, 2);
  assert.deepEqual(Object.keys(before.state).sort(), [...SNAPSHOT_STATE_TABLES].sort());
  database.prepare('UPDATE economy_accounts SET balance = 0 WHERE conversation_id = ?').run(conversationId);
  database.prepare('UPDATE scene_nodes SET name = ? WHERE id = ?').run('Future place', 'warehouse');
  message('assistant', 'Future event');
  const restored = loadSave(database, userId, save.id);
  assert.equal(restored.stateStatus, 'ready');
  const after = captureConversationSnapshot(database, userId, conversationId);
  assert.deepEqual(after.state, before.state);
  assert.deepEqual(after.messages, before.messages);
  assert.equal(after.messages[0].attachments[0].url, '/api/assets/asset-image');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('branch restores the selected checkpoint with remapped ownership and excludes future memories', (t) => {
  const f = fixture(t);
  const { database, userId, conversationId, message } = f;
  const user = message('user', 'Visit the harbor.');
  const assistant = message('assistant', 'Mira arrived.');
  const { member } = seedState(f);
  const sourceMemory = createCastMemory(database, userId, conversationId, member.id, { content: 'The map was handed over.', sourceMessageId: user.id });
  writeConversationCheckpoint(database, userId, conversationId);
  message('user', 'Travel away');
  message('assistant', 'Mira learned the secret.');
  createCastMemory(database, userId, conversationId, member.id, { content: 'Future secret' });
  database.prepare('UPDATE economy_accounts SET balance = 5 WHERE conversation_id = ?').run(conversationId);
  const branch = branchConversation(database, userId, conversationId, assistant.id);
  const branched = captureConversationSnapshot(database, userId, branch.id);
  assert.equal(branched.state.economy_accounts[0].balance, 40);
  assert.ok(!branched.state.cast_memories.some((memory) => memory.content === 'Future secret'));
  const mira = branched.state.cast_members.find((entry) => entry.canonical_name === 'Mira');
  assert.notEqual(mira.id, member.id);
  assert.equal(branched.state.scene_items[0].owner_member_id, mira.id);
  assert.ok(branched.state.scene_nodes.some((node) => node.id === mira.current_scene_node_id));
  const remappedMemory = branched.state.cast_memories.find((entry) => entry.content === sourceMemory.content);
  assert.equal(remappedMemory.source_message_id, branched.messages[0].id);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('older version 2 snapshots default only missing memory review state without mutating the snapshot', (t) => {
  const f = fixture(t);
  seedState(f);
  const oldV2 = captureConversationSnapshot(f.database, f.userId, f.conversationId);
  delete oldV2.state.conversation_memory_review_operations;
  delete oldV2.state.conversation_memory_review_members;
  delete oldV2.settings.context_budget_json;
  const beforeRestore = JSON.stringify(oldV2);

  restoreConversationSnapshot(f.database, f.userId, f.conversationId, oldV2);

  assert.equal(JSON.stringify(oldV2), beforeRestore);
  const restored = captureConversationSnapshot(f.database, f.userId, f.conversationId);
  assert.deepEqual(restored.state.conversation_memory_review_operations, []);
  assert.deepEqual(restored.state.conversation_memory_review_members, []);

  const incomplete = structuredClone(oldV2);
  delete incomplete.state.economy_accounts;
  assert.throws(
    () => restoreConversationSnapshot(f.database, f.userId, f.conversationId, incomplete),
    (error) => error.code === 'SNAPSHOT_INCOMPLETE'
  );
});

test('branch remaps memory review merge references and preserves undo behavior', (t) => {
  const f = fixture(t);
  const sourceMessage = f.message('user', 'Remember both harbor reports.');
  const target = createConversationMemory(f.database, f.userId, f.conversationId, {
    memoryType: 'fact', subject: 'Harbor', content: 'The harbor is guarded.', sourceMessageId: sourceMessage.id
  });
  const source = createConversationMemory(f.database, f.userId, f.conversationId, {
    memoryType: 'fact', subject: 'Harbor', content: 'The harbor closes at dusk.', sourceMessageId: sourceMessage.id
  });
  const merged = mergeConversationMemories(f.database, f.userId, f.conversationId, {
    targetId: target.id,
    targetRevision: target.revision,
    sourceItems: [{ id: source.id, revision: source.revision }],
    content: 'The guarded harbor closes at dusk.'
  });
  const tip = f.message('assistant', 'I will remember the harbor reports together.');

  const branch = branchConversation(f.database, f.userId, f.conversationId, tip.id);
  const branched = captureConversationSnapshot(f.database, f.userId, branch.id);
  const operation = branched.state.conversation_memory_review_operations[0];
  const members = branched.state.conversation_memory_review_members;
  const memories = branched.state.conversation_memories;
  const payload = JSON.parse(operation.payload_json);

  assert.notEqual(operation.id, merged.operationId);
  assert.ok(memories.some((memory) => memory.id === payload.targetId));
  assert.ok(payload.sourceIds.every((id) => memories.some((memory) => memory.id === id)));
  assert.ok(members.every((member) => member.operation_id === operation.id));
  assert.ok(members.every((member) => memories.some((memory) => memory.id === member.memory_id)));
  for (const member of members) {
    const before = JSON.parse(member.before_json);
    assert.equal(before.id, member.memory_id);
    assert.equal(before.sourceMessageId, branched.messages[0].id);
  }

  const undone = undoConversationMemoryMerge(f.database, f.userId, branch.id, operation.id);
  assert.equal(undone.memories.length, 2);
  assert.ok(undone.memories.every((memory) => memory.enabled && !memory.archived && memory.mergedIntoId === null));
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('legacy history never inherits future state and legacy saves report incomplete restoration', (t) => {
  const f = fixture(t);
  const { database, userId, conversationId, message } = f;
  database.prepare('DELETE FROM conversation_checkpoints WHERE conversation_id = ?').run(conversationId);
  const first = message('assistant', 'Old point');
  message('assistant', 'Future point');
  seedState(f);
  const branch = branchConversation(database, userId, conversationId, first.id);
  assert.equal(branch.stateStatus, 'legacy_partial');
  assert.ok(branch.warnings.length);
  assert.equal(captureConversationSnapshot(database, userId, branch.id).state.cast_memories.length, 0);
  const save = createSave(database, userId, conversationId, { name: 'Legacy' });
  database.prepare('UPDATE saves SET snapshot = ? WHERE id = ?').run(JSON.stringify({ messages: [{ id: first.id, role: 'assistant', content: first.content }] }), save.id);
  const result = loadSave(database, userId, save.id);
  assert.equal(result.snapshotVersion, 1);
  assert.ok(result.warnings.length);
  assert.equal(captureConversationSnapshot(database, userId, conversationId).state.economy_accounts.length, 0);
});

test('malformed snapshot restore rolls back deletions and preserves the existing state', (t) => {
  const f = fixture(t);
  seedState(f);
  f.message('assistant', 'Still here');
  const save = createSave(f.database, f.userId, f.conversationId, { name: 'Corrupt' });
  const before = captureConversationSnapshot(f.database, f.userId, f.conversationId);
  const corrupt = structuredClone(before);
  corrupt.state.cast_members[0].current_scene_node_id = 'missing-scene';
  f.database.prepare('UPDATE saves SET snapshot = ? WHERE id = ?').run(JSON.stringify(corrupt), save.id);
  assert.throws(() => loadSave(f.database, f.userId, save.id));
  const after = captureConversationSnapshot(f.database, f.userId, f.conversationId);
  assert.deepEqual(after.state, before.state);
  assert.deepEqual(after.messages, before.messages);
});

test('actual assistant persistence enqueues postprocessing atomically and blocks stale responses', (t) => {
  const f = fixture(t);
  const ticket = beginConversationGeneration(f.database, f.userId, f.conversationId);
  f.message('user', 'Find Mira');
  const results = createConversationAssistantResultService({ db: f.database, newId, nowIso, createConversationMessage, updateConversationTimestamp,
    onAssistantSaved: ({ assistantMessage }) => enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistantMessage.id) });
  const assistant = results.saveAssistantResult({ userId: f.userId, conversation: { id: f.conversationId }, character: f.character, rules: [], result: { content: 'Mira arrived.' }, ticket });
  assert.ok(assistant.postprocessJobId);
  assert.equal(getJob(f.database, f.userId, assistant.postprocessJobId).payload.assistantMessageId, assistant.id);
  assert.equal(claimNextJob(f.database, 'worker'), null, 'worker waits for generation to release its lease');
  endConversationGeneration(f.database, ticket);
  assert.throws(() => beginConversationGeneration(f.database, f.userId, f.conversationId), (error) => error.code === 'CONVERSATION_STATE_PENDING');
  invalidateConversationTimeline(f.database, f.userId, f.conversationId, 'ready');
  assert.throws(() => results.saveAssistantResult({ userId: f.userId, conversation: { id: f.conversationId }, character: f.character, rules: [], result: { content: 'Stale' }, ticket }), (error) => error.code === 'CONVERSATION_TIMELINE_CHANGED');
});

test('postprocessing keeps the originating chat thinking level for cast projection', async (t) => {
  const f = fixture(t);
  f.message('user', 'Find Mira');
  const assistant = f.message('assistant', 'Mira arrived.');
  const queued = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistant.id, {
    thinkingLevel: 'xhigh',
  });
  assert.equal(queued.payload.thinkingLevel, 'xhigh');
  assert.equal(queued.payload.thinkingEnabled, true);

  const job = claimNextJob(f.database, 'thinking-worker');
  let castOptions = null;
  await runConversationPostprocessing(f.database, {
    job,
    payload: job.payload,
    signal: new AbortController().signal,
    progress: () => {},
  }, {
    settings: { providerType: 'mock' },
    runAccessoryAgents: async () => [],
    projectConversationCast: async (options) => {
      castOptions = options;
      return { ok: true, skipped: false, reviewRequired: false };
    },
  });
  assert.equal(castOptions.mainThinkingLevel, 'xhigh');
  assert.equal(castOptions.mainThinkingEnabled, true);
});

test('postprocessing runs through the real handler and supports durable memory extraction', async (t) => {
  const f = fixture(t);
  f.message('user', 'I prefer tea.');
  const assistant = f.message('assistant', 'Mira found a key.');
  const queued = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistant.id);
  const job = claimNextJob(f.database, 'real-worker');
  const handlers = createDefaultJobHandlers(f.database, { providerSettings: () => ({ providerType: 'mock' }) });
  const result = await handlers[job.type]({ job, payload: job.payload, signal: new AbortController().signal, progress: () => {} });
  completeJob(f.database, job.id, job.leaseOwner, result);
  assert.equal(getJob(f.database, f.userId, queued.id).status, 'succeeded');
  assert.ok(f.database.prepare('SELECT COUNT(*) AS count FROM conversation_memories WHERE conversation_id = ?').get(f.conversationId).count > 0);
  assert.equal(f.database.prepare('SELECT postprocess_state FROM messages WHERE id = ?').get(assistant.id).postprocess_state, 'completed');
  assert.ok(f.database.prepare('SELECT id FROM conversation_checkpoints WHERE anchor_message_id = ?').get(assistant.id));
});

test('expired step recovery rolls back partial writes before retry and reuses completed steps', async (t) => {
  const f = fixture(t);
  seedState(f);
  const assistant = f.message('assistant', 'Mira earned gold.');
  enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistant.id);
  const first = claimNextJob(f.database, 'lost-worker');
  const before = captureConversationSnapshot(f.database, f.userId, f.conversationId, { includeMessages: false });
  f.database.prepare('INSERT INTO job_steps (job_id, step_key, status, before_json, attempt, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(first.id, 'economy', 'running', JSON.stringify(before), first.attempt, nowIso());
  f.database.prepare('UPDATE economy_accounts SET balance = 999 WHERE conversation_id = ?').run(f.conversationId);
  recoverExpiredJobs(f.database, first.leaseExpiresAt + 1);
  const second = claimNextJob(f.database, 'new-worker');
  let calls = 0;
  const environment = { job: second, payload: second.payload, signal: new AbortController().signal };
  const operation = (db) => {
    calls += 1;
    assert.equal(db.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 40);
    db.prepare('UPDATE economy_accounts SET balance = balance + 10 WHERE conversation_id = ?').run(f.conversationId);
    return { ok: true };
  };
  await runRecoverableConversationStep(f.database, environment, 'economy', operation);
  await runRecoverableConversationStep(f.database, environment, 'economy', operation);
  assert.equal(calls, 1);
  assert.equal(f.database.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 50);
});

test('a stale provider callback cannot write after a history change or roll back the new state', async (t) => {
  const f = fixture(t);
  seedState(f);
  const assistant = f.message('assistant', 'Mira earned gold.');
  enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistant.id);
  const job = claimNextJob(f.database, 'worker');
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const promise = runRecoverableConversationStep(f.database, { job, payload: job.payload, signal: new AbortController().signal }, 'economy', async (db) => {
    await barrier;
    db.prepare('UPDATE economy_accounts SET balance = 999 WHERE conversation_id = ?').run(f.conversationId);
  });
  const rejection = assert.rejects(promise, (error) => ['JOB_CANCELLED', 'JOB_SOURCE_STALE'].includes(error.code));
  invalidateConversationTimeline(f.database, f.userId, f.conversationId, 'ready');
  f.database.prepare('UPDATE economy_accounts SET balance = 7 WHERE conversation_id = ?').run(f.conversationId);
  release();
  await rejection;
  assert.equal(f.database.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 7);
});

test('jobs serialize within a conversation while independent work and retries stay available', (t) => {
  const f = fixture(t);
  const first = submitJob(f.database, f.userId, 'memory.extract', { conversationId: f.conversationId }, { idempotencyKey: 'first' });
  submitJob(f.database, f.userId, 'cast.organize', { conversationId: f.conversationId }, { idempotencyKey: 'second' });
  const claimed = claimNextJob(f.database, 'worker-1');
  assert.equal(claimed.id, first.id);
  assert.equal(claimNextJob(f.database, 'worker-2'), null);
  failJob(f.database, first.id, claimed.leaseOwner, new Error('Retry me'));
  retryJob(f.database, f.userId, first.id);
  assert.equal(claimNextJob(f.database, 'worker-2').id, first.id);
});

test('message edits and swipes restore a prior checkpoint and expose versioned recovery state', (t) => {
  const f = fixture(t);
  seedState(f);
  const user = f.message('user', 'Walk');
  writeConversationCheckpoint(f.database, f.userId, f.conversationId);
  const assistant = f.message('assistant', 'Mira earned gold.');
  f.database.prepare('UPDATE economy_accounts SET balance = 90 WHERE conversation_id = ?').run(f.conversationId);
  const edited = updateConversationMessage(f.database, nowIso, f.userId, f.conversationId, assistant.id, { content: 'Mira stayed home.' });
  assert.equal(edited.revision, 2);
  assert.ok(edited.timeline.recoverySaveId);
  assert.equal(f.database.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 40);
  const swipe = createSwipe(f.database, f.userId, assistant.id, { content: 'Mira rested.' });
  const selected = setActiveSwipe(f.database, f.userId, assistant.id, swipe.id);
  // Switching candidates keeps the previous text as a swipe instead of writing a recovery save.
  assert.equal(selected.timeline.recoverySaveId, '');
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM saves WHERE conversation_id = ? AND kind = 'recovery'").get(f.conversationId).count, 1);
  assert.equal(f.database.prepare('SELECT revision FROM messages WHERE id = ?').get(assistant.id).revision, 3);
  const removed = deleteConversationMessage(f.database, nowIso, f.userId, f.conversationId, assistant.id);
  assert.equal(removed.timeline.stateStatus, 'ready');
  assert.equal(f.database.prepare('SELECT id FROM messages WHERE id = ?').get(user.id).id, user.id);
});

test('older multi-turn history changes require explicit rebuild confirmation', (t) => {
  const f = fixture(t);
  const user = f.message('user', 'First action');
  f.message('assistant', 'Mira arrived.');
  f.message('user', 'Second action');
  f.message('assistant', 'Mira left.');
  const result = updateConversationMessage(f.database, nowIso, f.userId, f.conversationId, user.id, { content: 'Revised action' });
  assert.equal(result.timeline.stateStatus, 'needs_rebuild');
  assert.throws(() => beginConversationGeneration(f.database, f.userId, f.conversationId));
  const preview = requestConversationStateRebuild(f.database, f.userId, f.conversationId);
  assert.equal(preview.turnCount, 2);
  assert.equal(preview.confirmationRequired, true);
  const confirmed = requestConversationStateRebuild(f.database, f.userId, f.conversationId, { confirmed: true });
  assert.equal(confirmed.jobs.length, 2);
});

test('tool executions expose classified write policy and keep secrets out of audit data', async (t) => {
  const f = fixture(t);
  const definition = [{ type: 'function', function: { name: 'update_status_bar', parameters: { type: 'object' } } }];
  const result = await executeProviderTool(async () => ({ ok: true, apiKey: 'private-value' }), 'update_status_bar', { token: 'private-value' }, {}, undefined, definition,
    { database: f.database, userId: f.userId, conversationId: f.conversationId });
  assert.equal(result.policy.effect, 'write');
  const audit = f.database.prepare('SELECT * FROM ai_tool_executions').get();
  assert.equal(audit.status, 'succeeded');
  assert.doesNotMatch(audit.arguments_json + audit.result_json, /private-value/);
});

test('timeline migration replays idempotently and all runtime tables remain foreign-key clean', (t) => {
  const f = fixture(t);
  initializeDatabase(f.database);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(f.database.prepare("SELECT version FROM schema_migrations WHERE version = '0014'").get());
});

test('cancelling a replay leaves later turns queued and retry restores their serial order', (t) => {
  const f = fixture(t);
  const firstMessage = f.message('assistant', 'First turn');
  const secondMessage = f.message('assistant', 'Second turn');
  const first = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, firstMessage.id);
  const second = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, secondMessage.id);
  cancelJob(f.database, f.userId, first.id);
  // A cancelled turn no longer blocks later queued turns (background synchronization update).
  assert.equal(getJob(f.database, f.userId, second.id).status, 'queued');
  retryJob(f.database, f.userId, first.id);
  assert.equal(getJob(f.database, f.userId, first.id).status, 'queued');
  assert.equal(claimNextJob(f.database, 'worker').id, first.id);
  assert.equal(claimNextJob(f.database, 'second-worker'), null);
});

test('truncating a tail deletes messages as one history change with a single recovery save', (t) => {
  const f = fixture(t);
  const user = f.message('user', 'One');
  const firstReply = f.message('assistant', 'A1');
  const secondUser = f.message('user', 'Two');
  const secondReply = f.message('assistant', 'A2');
  const result = deleteConversationMessagesFrom(f.database, nowIso, f.userId, f.conversationId, secondUser.id);
  assert.deepEqual(result.deletedIds, [secondUser.id, secondReply.id]);
  assert.ok(result.timeline.recoverySaveId);
  assert.deepEqual(
    f.database.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid').all(f.conversationId).map((row) => row.id),
    [user.id, firstReply.id]
  );
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM saves WHERE conversation_id = ? AND kind = 'recovery'").get(f.conversationId).count, 1);
  assert.equal(deleteConversationMessagesFrom(f.database, nowIso, f.userId, f.conversationId, 'missing'), null);
});

test('recovery saves are bounded per conversation and settled job steps are pruned', (t) => {
  const f = fixture(t);
  const reply = f.message('assistant', 'Reply');
  const manual = createSave(f.database, f.userId, f.conversationId, { name: 'Keep me' });
  assert.equal(manual.kind, 'manual');
  for (let index = 0; index < 8; index += 1) {
    updateConversationMessage(f.database, nowIso, f.userId, f.conversationId, reply.id, { content: `Edit ${index}` });
  }
  const recoveryCount = f.database.prepare("SELECT COUNT(*) AS count FROM saves WHERE conversation_id = ? AND kind = 'recovery'").get(f.conversationId).count;
  assert.equal(recoveryCount, appConfig.conversationRetention.recoverySaveLimit);
  const listed = listSaves(f.database, f.userId, f.conversationId);
  assert.equal(listed.filter((save) => save.kind === 'recovery').length, recoveryCount);
  assert.equal(listed.some((save) => save.id === manual.id && save.kind === 'manual'), true);

  const job = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, reply.id);
  const claimed = claimNextJob(f.database, 'worker');
  f.database.prepare("INSERT INTO job_steps (job_id, step_key, status, before_json, result_json, attempt, updated_at) VALUES (?, 'memory', 'completed', '{}', '{}', 1, ?)")
    .run(job.id, nowIso());
  completeJob(f.database, claimed.id, claimed.leaseOwner, {});
  assert.equal(pruneConversationDerivedStorage(f.database, f.userId, f.conversationId).jobSteps, 0);
  f.database.prepare("UPDATE jobs SET finished_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(job.id);
  const pruned = pruneConversationDerivedStorage(f.database, f.userId, f.conversationId);
  assert.equal(pruned.jobSteps, 1);
  assert.equal(pruned.checkpoints, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS count FROM job_steps WHERE job_id = ?').get(job.id).count, 0);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM saves WHERE id = ?").get(manual.id).count, 1);
});

test('worker shutdown rolls back the active step and a restarted worker finishes it once', async (t) => {
  const f = fixture(t);
  seedState(f);
  const assistant = f.message('assistant', 'Earn gold');
  const queued = enqueueConversationPostprocessing(f.database, f.userId, f.conversationId, assistant.id);
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const firstWorker = startJobWorker(f.database, { workerId: 'shutdown-worker', handlers: {
    'conversation.postprocess': (environment) => runRecoverableConversationStep(f.database, environment, 'economy', async (db) => {
      db.prepare('UPDATE economy_accounts SET balance = balance + 10 WHERE conversation_id = ?').run(f.conversationId);
      started();
      await new Promise((resolve, reject) => environment.signal.addEventListener('abort', () => reject(environment.signal.reason), { once: true }));
    })
  } });
  await entered;
  await firstWorker();
  assert.equal(f.database.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 40);
  assert.equal(getJob(f.database, f.userId, queued.id).status, 'queued');
  let completed;
  const finished = new Promise((resolve) => { completed = resolve; });
  const secondWorker = startJobWorker(f.database, { workerId: 'restart-worker', handlers: {
    'conversation.postprocess': async (environment) => {
      const result = await runRecoverableConversationStep(f.database, environment, 'economy', (db) => {
        db.prepare('UPDATE economy_accounts SET balance = balance + 10 WHERE conversation_id = ?').run(f.conversationId);
        return { ok: true };
      });
      completed();
      return result;
    }
  } });
  await finished;
  await new Promise((resolve) => setImmediate(resolve));
  await secondWorker();
  assert.equal(getJob(f.database, f.userId, queued.id).status, 'succeeded');
  assert.equal(f.database.prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ?').get(f.conversationId).balance, 50);
});
