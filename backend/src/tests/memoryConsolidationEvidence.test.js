import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'memory-consolidation-evidence-fixture';
const { createAppDatabase } = await import('../db.js');
const { insertUser } = await import('./routeTestUtils.js');
const { createCharacter } = await import('../modules/characters.js');
const { listConversationMemories } = await import('../modules/conversationMemories.js');
const { commitMemoryPacket, getMemoryProcessingState, invalidateMemorySources } = await import('../services/conversationMemory/commit.js');
const { getCurrentMemoryEvent } = await import('../repositories/conversationMemoryRepository.js');
const { runConversationMemoryAgent } = await import('../services/conversationMemoryAgent.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');
const settings = { providerType: 'custom', baseUrl: 'https://memory-evidence.invalid/v1', model: 'isolated', apiKey: 'fixture-only' };

/** Create independently sourced accepted records before a new extraction turn. All providers remain scripted. */
function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'evidence-owner', conversationId = 'evidence-story';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira' });
  database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,state_status,created_at,updated_at)
    VALUES(?,?,?,'Evidence','ready','2026-11-01','2026-11-01')`).run(conversationId, userId, character.id);
  const insert = database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)');
  const texts = ['Mira holds the silver key.', 'The silver key belongs to Mira.', 'Mira keeps the silver gate key.'];
  for (const [index, content] of texts.entries()) insert.run(`old-${index}`, userId, conversationId, 'assistant', content, `2026-11-01T00:00:0${index}Z`);
  commitMemoryPacket(database, userId, conversationId, { version: 1, messageId: 'old-2', idempotencyKey: 'seed',
    sources: texts.map((_, index) => ({ messageId: `old-${index}`, revision: 1 })),
    entities: [{ key: 'mira', name: 'Mira', kind: 'actor', castKey: 'main-character' }],
    events: texts.map((content, index) => ({ key: `record-${index}`, kind: 'fact', content, subjectEntityId: 'mira',
      evidence: [{ messageId: `old-${index}`, quote: content }] }))
  });
  const memories = texts.map(content => listConversationMemories(database, userId, conversationId).find(memory => memory.content === content));
  insert.run('current', userId, conversationId, 'assistant', 'Mira holds the silver gate key in her left hand.', '2026-11-01T00:00:03Z');
  return { database, userId, conversationId, memories,
    conversation: { id: conversationId, characterId: character.id, settings: { accessorySkills: { memoryAgent: { enabled: true } } } },
    assistantMessage: { id: 'current', role: 'assistant', content: 'Mira holds the silver gate key in her left hand.' } };
}

/** Exercise schema validation and actual staged acceptance rather than calling a merge helper directly. */
async function prepare(f, script) {
  return runConversationMemoryAgent({ ...f, settings, prepareOnly: true,
    runTools: async (_settings, _messages, tools, execute) => {
      const call = async (name, args) => (await executeProviderTool(execute, name, args, {}, undefined, tools)).result;
      await script(call);
      assert.equal((await call('finish_memory_review', {})).ok, true);
      return {};
    }
  });
}

function evidenceMessages(f, memoryId) {
  const event = getCurrentMemoryEvent(f.database, f.userId, f.conversationId, memoryId);
  return f.database.prepare(`SELECT source.message_id FROM memory_evidence evidence
    JOIN memory_source_versions source ON source.id=evidence.source_version_id WHERE evidence.event_id=? ORDER BY source.message_id`)
    .all(event.id).map(row => row.message_id);
}

test('compressed historical merges retain every accepted source through chained targets and idempotent acceptance', async t => {
  const f = fixture(t);
  const [first, second, third] = f.memories;
  const prepared = await prepare(f, async call => {
    assert.equal((await call('merge_memories', { targetId: first.id, targetRevision: first.revision,
      sourceItems: [{ id: second.id, revision: second.revision }], content: 'Mira owns and holds the silver key.' })).ok, true);
    assert.equal((await call('merge_memories', { targetId: third.id, targetRevision: third.revision,
      sourceItems: [{ id: first.id, revision: first.revision + 1 }], content: 'Mira holds her silver gate key.' })).ok, true);
  });
  assert.deepEqual(prepared.packet.sources.map(source => source.messageId), ['current'], 'historical sources are inherited, never forged as current observations');
  const receipt = prepared.commit();
  assert.equal(receipt.eventIds.length, 3);
  assert.deepEqual(evidenceMessages(f, third.id), ['old-0', 'old-1', 'old-2']);
  assert.equal(listConversationMemories(f.database, f.userId, f.conversationId).length, 1);
  assert.equal(prepared.commit().duplicate, true);
  assert.deepEqual(evidenceMessages(f, third.id), ['old-0', 'old-1', 'old-2']);
});

test('a current evidence correction after compression preserves merged provenance and its new source', async t => {
  const f = fixture(t);
  const [first, second] = f.memories;
  const prepared = await prepare(f, async call => {
    const merged = await call('merge_memories', { targetId: first.id, targetRevision: first.revision,
      sourceItems: [{ id: second.id, revision: second.revision }], content: 'Mira owns the silver gate key.' });
    assert.equal(merged.ok, true);
    assert.equal((await call('update_memory', { memoryId: first.id, revision: merged.memory.revision,
      content: f.assistantMessage.content, sourceMessageId: 'current', quote: f.assistantMessage.content })).ok, true);
  });
  prepared.commit();
  assert.deepEqual(evidenceMessages(f, first.id), ['current', 'old-0', 'old-1']);
});

for (const changeRevision of [true, false]) {
  test(`historical merge rejects ${changeRevision ? 'changed revisions' : 'unversioned content changes'} without partial writes`, async t => {
    const f = fixture(t);
    const [first, second] = f.memories;
    f.database.prepare(`UPDATE messages SET content='The source changed.',revision=revision+? WHERE id='old-1'`).run(changeRevision ? 1 : 0);
    invalidateMemorySources(f.database, f.userId, f.conversationId);
    const prepared = await prepare(f, async call => {
      assert.equal((await call('merge_memories', { targetId: first.id, targetRevision: first.revision,
        sourceItems: [{ id: second.id, revision: second.revision }], content: 'Mira holds her gate key.' })).ok, true);
    });
    const state = getMemoryProcessingState(f.database, f.userId, f.conversationId);
    const projections = listConversationMemories(f.database, f.userId, f.conversationId, { includeArchived: true });
    const commits = f.database.prepare('SELECT COUNT(*) AS count FROM memory_commits').get().count;
    assert.throws(() => prepared.commit(), /旧证据来源已失效/);
    assert.deepEqual(getMemoryProcessingState(f.database, f.userId, f.conversationId), state);
    assert.deepEqual(listConversationMemories(f.database, f.userId, f.conversationId, { includeArchived: true }), projections);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS count FROM memory_commits').get().count, commits);
  });
}
