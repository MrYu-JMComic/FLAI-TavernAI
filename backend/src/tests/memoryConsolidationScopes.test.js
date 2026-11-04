import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-consolidation-scopes';
const { createAppDatabase } = await import('../db/runtime.js');
const { insertUser } = await import('./routeTestUtils.js');
const { createCharacter } = await import('../modules/characters.js');
const { commitMemoryPacket } = await import('../services/conversationMemory/commit.js');
const { getMemoryMessage, ensureMemoryStateRow, insertMemoryEntity, getCurrentMemoryEvent } = await import('../repositories/conversationMemoryRepository.js');
const { memoryHash } = await import('../domain/conversationMemory/contracts.js');
const { listConversationMemories } = await import('../modules/conversationMemories.js');
const { runConversationMemoryAgent } = await import('../services/conversationMemoryAgent.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');
const settings = { providerType: 'custom', baseUrl: 'https://consolidation.invalid/v1', model: 'isolated', apiKey: 'fixture-only' };

/** Seed real canonical records and equal display names, retaining independent IDs for the merge guard. */
function fixture(t, sourcePatch = {}, targetPatch = {}) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'scope-owner', conversationId = 'scope-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Guide' });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at)
    VALUES(?,?,?,'Scopes','ready','2026-11-01','2026-11-01')`).run(conversationId, userId, character.id);
  ensureMemoryStateRow(database, userId, conversationId);
  for (const [id, name, kind] of [['mira-a', 'Mira', 'actor'], ['mira-b', 'Mira', 'actor'],
    ['noel', 'Noel', 'actor'], ['bo', 'Bo', 'actor'], ['gate', 'Gate', 'place'], ['harbor', 'Harbor', 'place']]) {
    insertMemoryEntity(database, userId, conversationId, { id, name, kind, castKey: id });
  }
  const insert = database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)');
  insert.run('old', userId, conversationId, 'assistant', 'Mira holds the key. Mira keeps the same key.', '2026-11-01T00:00:00Z');
  const old = getMemoryMessage(database, userId, conversationId, 'old');
  const scope = { kind: 'event', subjectEntityId: 'mira-a', narrativeTime: 'day one', locationEntityId: 'gate',
    participants: ['mira-a', 'noel'], visibility: 'public', truthStatus: 'established', evidence: [{ messageId: 'old' }] };
  commitMemoryPacket(database, userId, conversationId, { version: 1, messageId: 'old', idempotencyKey: 'scope-seed',
    sources: [{ messageId: 'old', revision: old.revision, contentHash: memoryHash({ role: old.role, content: old.content, attachments: [] }) }],
    events: [{ ...scope, ...targetPatch, key: 'target', content: 'Mira holds the key.' },
      { ...scope, ...sourcePatch, key: 'source', content: 'Mira keeps the same key.' }]
  });
  const memories = listConversationMemories(database, userId, conversationId);
  const target = memories.find(memory => memory.content === 'Mira holds the key.');
  const source = memories.find(memory => memory.content === 'Mira keeps the same key.');
  insert.run('current', userId, conversationId, 'assistant', 'Mira waits.', '2026-11-01T00:00:01Z');
  return { database, userId, conversationId, target, source,
    conversation: { id: conversationId, settings: { accessorySkills: { memoryAgent: { enabled: true } } } },
    assistantMessage: { id: 'current', role: 'assistant', content: 'Mira waits.' } };
}

async function proposeMerge(f, extra = {}) {
  let merge;
  const prepared = await runConversationMemoryAgent({ ...f, settings, prepareOnly: true,
    runTools: async (_settings, _messages, tools, execute) => {
      merge = (await executeProviderTool(execute, 'merge_memories', { ...extra, targetId: f.target.id, targetRevision: f.target.revision,
        sourceItems: [{ id: f.source.id, revision: f.source.revision }] }, {}, undefined, tools)).result;
      const finish = (await executeProviderTool(execute, 'finish_memory_review', {}, {}, undefined, tools)).result;
      assert.equal(finish.ok, true);
      return {};
    }
  });
  return { merge, prepared };
}

for (const [name, patch] of [
  ['same-name actors with distinct canonical identities', { subjectEntityId: 'mira-b' }],
  ['different narrative times', { narrativeTime: 'day two' }],
  ['different event kinds sharing the same review memory type', { kind: 'outcome' }],
  ['different locations', { locationEntityId: 'harbor' }],
  ['different participants', { participants: ['mira-a', 'bo'] }],
  ['different canonical truth scope', { truthStatus: 'disputed' }],
  ['different actor audiences', { visibility: 'restricted', actorIds: ['mira-a'] }]
]) {
  test(`automatic consolidation rejects ${name} before staging`, async t => {
    const f = fixture(t, patch);
    assert.equal(f.target.subject, f.source.subject, 'both projections intentionally use the same display name');
    assert.equal(f.target.memoryType, f.source.memoryType, 'canonical kind differences cannot hide behind review normalization');
    const before = listConversationMemories(f.database, f.userId, f.conversationId, { includeArchived: true });
    const { merge, prepared } = await proposeMerge(f);
    assert.equal(merge.ok, false);
    assert.match(merge.error, /语义范围/);
    assert.deepEqual(prepared.packet.actions, []);
    assert.deepEqual(listConversationMemories(f.database, f.userId, f.conversationId, { includeArchived: true }), before);
  });
}

test('automatic consolidation accepts the same canonical scope and treats participant ordering as irrelevant', async t => {
  const f = fixture(t, { participants: ['noel', 'mira-a'] });
  const targetEvent = getCurrentMemoryEvent(f.database, f.userId, f.conversationId, f.target.id);
  const sourceEvent = getCurrentMemoryEvent(f.database, f.userId, f.conversationId, f.source.id);
  assert.equal(targetEvent.subject_entity_id, sourceEvent.subject_entity_id);
  assert.equal(targetEvent.narrative_time, sourceEvent.narrative_time);
  const { merge, prepared } = await proposeMerge(f);
  assert.equal(merge.ok, true, JSON.stringify(merge));
  assert.equal(prepared.packet.actions.length, 1);
  assert.equal(prepared.packet.actions[0].type, 'merge');
  assert.deepEqual(prepared.packet.actions[0].payload.sourceItems, [{ id: f.source.id, revision: f.source.revision }]);
  assert.equal(listConversationMemories(f.database, f.userId, f.conversationId).length, 2, 'accepted proposal remains staged until final core acceptance');
});

test('automatic consolidation cannot relabel two compatible records to a different subject', async t => {
  const f = fixture(t);
  const { merge, prepared } = await proposeMerge(f, { subject: 'Noel' });
  assert.equal(merge.ok, false);
  assert.match(merge.error, /不能改变角色主体/);
  assert.deepEqual(prepared.packet.actions, []);
});

test('automatic consolidation permits subject normalization without changing its identity', async t => {
  const f = fixture(t);
  const { merge, prepared } = await proposeMerge(f, { subject: '  Ｍｉｒａ  ' });
  assert.equal(merge.ok, true);
  assert.equal(prepared.packet.actions.length, 1);
  assert.equal(prepared.packet.actions[0].type, 'merge');
});

for (const stagedTarget of [false, true]) {
  test(`automatic consolidation rejects a new staged ${stagedTarget ? 'target' : 'source'} paired with an existing canonical record`, async t => {
    const f = fixture(t, {}, { truthStatus: 'unverified' });
    let merged;
    const prepared = await runConversationMemoryAgent({ ...f, settings, prepareOnly: true,
      runTools: async (_settings, _messages, tools, execute) => {
        const call = async (name, args) => (await executeProviderTool(execute, name, args, {}, undefined, tools)).result;
        const created = await call('record_memory', { memoryType: 'event', subject: 'Mira', content: 'Mira continues holding the key.', sourceMessageId: 'current' });
        assert.equal(created.ok, true);
        assert.equal(f.target.truthStatus, 'unverified', 'editable truth scope intentionally matches the new proposal');
        const target = stagedTarget ? created.memory : f.target;
        const source = stagedTarget ? f.target : created.memory;
        merged = await call('merge_memories', { targetId: target.id, targetRevision: target.revision,
          sourceItems: [{ id: source.id, revision: source.revision }] });
        assert.equal((await call('finish_memory_review', {})).ok, true);
        return {};
      }
    });
    assert.equal(merged.ok, false);
    assert.match(merged.error, /语义范围/);
    assert.deepEqual(prepared.packet.actions.map(action => action.type), ['create'], 'the valid new proposal remains; uncertain cross-scope merge makes no proposal');
    assert.equal(listConversationMemories(f.database, f.userId, f.conversationId).length, 2, 'the rejected mixed merge cannot archive or rewrite the old canonical record');
  });
}
