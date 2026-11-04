import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-memory-agent';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationMemory, listConversationMemories, pinConversationMemory } = await import('../modules/conversationMemories.js');
const { upsertStatusBar } = await import('../modules/statusBars.js');
const { normalizeAccessorySkills } = await import('../modules/advancedSettings.js');
const {
  MEMORY_AGENT_TOOLS,
  buildMemoryAgentToolDefinitions,
  resolveMemoryAgentTools,
  runConversationMemoryAgent
} = await import('../services/conversationMemoryAgent.js');
const { resolveAccessorySkillSettings } = await import('../services/accessorySkillProvider.js');
const { describeAiTool } = await import('../services/toolRegistry.js');
const { createProviderProfile } = await import('../repositories/providerProfileRepository.js');
const { encryptSecret } = await import('../security.js');
const { insertUser } = await import('./routeTestUtils.js');
const { executeProviderTool } = await import('../services/providerToolResults.js');

const usableSettings = Object.freeze({
  id: 'main-profile',
  providerType: 'custom',
  gatewayName: 'Main Gateway',
  baseUrl: 'https://memory-agent-provider.test/v1',
  model: 'main-model',
  apiKey: 'sk-main',
  supportsReasoning: false,
  extraBody: {}
});

function setup(skill = {}) {
  const database = createAppDatabase(':memory:');
  const userId = 'memory-agent-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Mira' });
  const conversationId = 'memory-agent-conversation';
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at, state_status)
    VALUES (?, ?, ?, 'Story', ?, ?, 'ready')`).run(conversationId, userId, character.id, timestamp, timestamp);
  const insertMessage = database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
     VALUES (?, ?, ?, ?, ?, '[]', '', NULL, ?)`
  );
  insertMessage.run('turn-user', userId, conversationId, 'user', 'I prefer moon tea. I handed Mira the silver key.', timestamp);
  insertMessage.run('turn-assistant', userId, conversationId, 'assistant', 'Mira took the silver key and promised to open the harbor gate tomorrow.', timestamp);
  const conversation = {
    id: conversationId,
    characterId: character.id,
    settings: { accessorySkills: { memoryAgent: skill } }
  };
  const userMessage = { id: 'turn-user', role: 'user', content: 'I prefer moon tea. I handed Mira the silver key.' };
  const assistantMessage = { id: 'turn-assistant', role: 'assistant', content: 'Mira took the silver key and promised to open the harbor gate tomorrow.' };
  return { database, userId, character, conversationId, conversation, userMessage, assistantMessage };
}

function scriptedRunner(script) {
  const seen = [];
  const runner = async (settings, messages, tools, execute) => {
    seen.push({ settings, messages, tools: tools.map((tool) => tool.function.name) });
    const results = [];
    for (const [name, args] of script) {
      const result = await execute(name, args);
      results.push(result);
      if (result?.stop) break;
    }
    runner.results = results;
    return { content: '', usage: { total_tokens: 12 } };
  };
  runner.seen = seen;
  return runner;
}

function validatedRunner(script) {
  const runner = async (_settings, _messages, tools, execute) => {
    runner.results = [];
    for (const [name, args] of script) {
      const prepared = await executeProviderTool(execute, name, JSON.stringify(args), {}, undefined, tools);
      runner.results.push(prepared.result);
      if (prepared.stop) break;
    }
    return {};
  };
  return runner;
}

test('all memory tools share catalog descriptions and validate their advertised minimum arguments', async () => {
  const definitions = buildMemoryAgentToolDefinitions(MEMORY_AGENT_TOOLS.map(tool => tool.name));
  const minimumArguments = {
    search_memories: {}, search_history: { query: 'key' },
    record_memory: { memoryType: 'event', content: 'Key received.', sourceMessageId: 'turn-user' },
    update_memory: { memoryId: 'memory', revision: 1 },
    merge_memories: { targetId: 'target', targetRevision: 1, sourceItems: [{ id: 'source', revision: 1 }] },
    invalidate_memory: { memoryId: 'memory', revision: 1, reason: 'Evidence contradicts current state.', sourceMessageId: 'turn-user' },
    pin_memory: { memoryId: 'memory', revision: 1 }, finish_memory_review: {},
    batch_memory_changes: { changes: [{ tool: 'record_memory', args: { memoryType: 'fact', content: 'Key received.', sourceMessageId: 'turn-user' } }] },
  };
  for (const tool of definitions) {
    const catalogTool = MEMORY_AGENT_TOOLS.find(entry => entry.name === tool.function.name);
    assert.equal(tool.function.description, catalogTool.modelDescription);
    assert.doesNotMatch(tool.function.description, /[^\x00-\x7F]/);
    assert.match(catalogTool.description, /[\u3400-\u9fff]/, 'settings retain their Chinese UI description');
    const prepared = await executeProviderTool(async () => ({ ok: true }), tool.function.name, minimumArguments[tool.function.name], {}, undefined, definitions);
    assert.equal(prepared.result.ok, true, tool.function.name);
  }
  for (const [name, args] of [['search_history', { query: '  ' }], ['record_memory', { ...minimumArguments.record_memory, content: '' }]]) {
    const rejected = await executeProviderTool(() => { throw new Error('must not execute'); }, name, args, {}, undefined, definitions);
    assert.equal(rejected.result.error, 'TOOL_ARGUMENTS_INVALID');
  }
});

test('batch writes reuse child permissions, revisions and evidence and exact edits preserve unrelated text', async t => {
  const env = setup({ enabled: true });
  t.after(() => env.database.close());
  const seed = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', subject: 'Mira', content: 'Mira holds a silver key. The cloak is blue.' });
  const runTools = async (_settings, _messages, tools, execute) => {
    const call = async (name, args) => (await executeProviderTool(execute, name, args, {}, undefined, tools)).result;
    const result = await call('batch_memory_changes', { changes: [
      { tool: 'update_memory', args: { memoryId: seed.id, revision: seed.revision, search: 'silver key', replacement: 'gate key', sourceMessageId: 'turn-assistant' } },
      { tool: 'record_memory', args: { memoryType: 'fact', content: 'Invalid evidence.', sourceMessageId: 'not-current' } },
      { tool: 'record_memory', args: { memoryType: 'intent', subject: 'Mira', content: 'Mira plans to open the gate tomorrow.', sourceMessageId: 'turn-assistant' } }
    ] });
    assert.equal(result.ok, false);
    assert.equal(result.staged, 2);
    assert.equal(result.results[0].memory.content, 'Mira holds a gate key. The cloak is blue.');
    assert.equal(result.results[1].ok, false);
    assert.equal(result.results[2].ok, true);
    const mismatch = await call('update_memory', { memoryId: seed.id, revision: seed.revision + 1, search: 'missing key', replacement: 'other', sourceMessageId: 'turn-assistant' });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.occurrences, 0);
    const rejected = await call('batch_memory_changes', { changes: [{ tool: 'pin_memory', args: { memoryId: seed.id, revision: seed.revision + 1 } }] });
    assert.equal(rejected.error, 'TOOL_ARGUMENTS_INVALID', 'disabled child tools are absent from the batch schema');
    assert.equal(listConversationMemories(env.database, env.userId, env.conversationId).length, 1, 'all changes remain staged');
    await call('finish_memory_review', {});
    return {};
  };
  const result = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools });
  assert.equal(result.memories.length, 1);
  const memories = listConversationMemories(env.database, env.userId, env.conversationId);
  assert.equal(memories.length, 2);
  assert.equal(memories.find(memory => memory.id === seed.id).content, 'Mira holds a gate key. The cloak is blue.');
});

test('automatic consolidation switch removes merge capability and compatible text merges retain provenance', async t => {
  const env = setup({ enabled: true, memoryPolicy: { autoConsolidate: false } });
  t.after(() => env.database.close());
  assert.equal(resolveMemoryAgentTools(env.conversation.settings.accessorySkills.memoryAgent).includes('merge_memories'), false);
  const first = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', subject: 'Mira', content: 'Mira holds the key.' });
  const second = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', subject: 'Mira', content: 'The key is held by Mira.' });
  const third = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', subject: 'Noel', content: 'Noel holds a different key.' });
  let prepared;
  const blockedRunner = async (_settings, messages, tools, execute) => {
    assert.match(messages[0].content, /Automatic consolidation is disabled/);
    assert.equal(tools.some(tool => tool.function.name === 'merge_memories'), false);
    assert.equal((await execute('merge_memories', { targetId: first.id, targetRevision: first.revision, sourceItems: [{ id: second.id, revision: second.revision }] })).ok, false);
    await execute('finish_memory_review', {}); return {};
  };
  prepared = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools: blockedRunner, prepareOnly: true });
  assert.deepEqual(prepared.packet.actions, []);
  env.conversation.settings.accessorySkills.memoryAgent.memoryPolicy.autoConsolidate = true;
  const runner = validatedRunner([
    ['merge_memories', { targetId: first.id, targetRevision: first.revision, sourceItems: [{ id: third.id, revision: third.revision }] }],
    ['merge_memories', { targetId: first.id, targetRevision: first.revision, sourceItems: [{ id: second.id, revision: second.revision }] }],
    ['finish_memory_review', {}]
  ]);
  await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools: runner });
  assert.equal(runner.results[0].ok, false);
  assert.equal(runner.results[1].ok, true);
  const memories = listConversationMemories(env.database, env.userId, env.conversationId, { includeArchived: true });
  assert.equal(memories.find(memory => memory.id === second.id).archived, true);
  assert.equal(memories.find(memory => memory.id === third.id).archived, false);
});

test('memory-status cooperation shares only the authoritative pre-update status when enabled', async t => {
  const env = setup({ enabled: true });
  t.after(() => env.database.close());
  upsertStatusBar(env.database, env.userId, env.conversationId, { name: 'Current', variables: [{ name: 'HP', value: 75 }] });
  for (const statusLink of [false, true]) {
    env.conversation.settings.accessorySkills.memoryAgent.memoryPolicy = { statusLink };
    await runConversationMemoryAgent({ ...env, settings: usableSettings, prepareOnly: true,
      runTools: async (_settings, messages, _tools, execute) => {
        const input = JSON.parse(messages[1].content);
        assert.equal(Boolean(input.statusContext), statusLink);
        if (statusLink) assert.equal(input.statusContext.variables[0].value, 75);
        assert.equal(input.memoryWorkflow.statusLink, statusLink);
        await execute('finish_memory_review', {}); return {};
      } });
  }
});

test('finish validates direct calls before sealing and preserves staged work during a corrected attempt', async t => {
  const env = setup({ enabled: true });
  t.after(() => env.database.close());
  const runTools = async (_settings, messages, _tools, execute, options) => {
    assert.equal(options.maxRounds, 8);
    assert.equal(JSON.parse(messages[1].content).toolCallLimits.finish_memory_review, 3);
    assert.match(messages[0].content, /arrays of objects, never objects keyed by IDs/);
    const staged = await execute('record_memory', {
      memoryType: 'event', content: 'Mira took the silver key.', sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key'
    });
    assert.equal(staged.ok, true);
    const invalid = await execute('finish_memory_review', { packet: { entities: { mira: { name: 'Mira' } } } });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'MEMORY_PACKET_INVALID');
    assert.match(invalid.error, /packet.entities/);
    assert.equal(invalid.stop, false);
    assert.equal(invalid.remainingAttempts, 2);
    assert.equal(listConversationMemories(env.database, env.userId, env.conversationId).length, 0);
    const accepted = await execute('finish_memory_review', { packet: { entities: [{ key: 'mira', name: 'Mira' }] }, summary: 'Key received.' });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.stop, true);
    const afterFinish = await execute('record_memory', {
      memoryType: 'fact', content: 'Late mutation.', sourceMessageId: 'turn-user'
    });
    assert.equal(afterFinish.ok, false);
    assert.match(afterFinish.error, /封存/);
    assert.equal((await execute('finish_memory_review', {})).ok, false);
    return {};
  };
  const prepared = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools, prepareOnly: true });
  assert.equal(prepared.mode, 'prepared');
  assert.equal(prepared.packet.events.length, 1);
  assert.equal(prepared.packet.summary, 'Key received.');
  assert.equal(prepared.packet.version, 1);
  assert.equal(prepared.packet.messageId, 'turn-assistant');
  assert.deepEqual(prepared.packet.sources.map(source => source.messageId), ['turn-user', 'turn-assistant']);
  assert.equal(env.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n, 0);
  const receipt = prepared.commit();
  assert.equal(receipt.eventIds.length, 1);
  assert.equal(listConversationMemories(env.database, env.userId, env.conversationId).length, 1);
});

test('repeated invalid finish attempts remain bounded and cannot turn malformed output into an empty success', async t => {
  const env = setup({ enabled: true });
  t.after(() => env.database.close());
  let results;
  const runTools = async (_settings, _messages, _tools, execute) => {
    results = [];
    for (let index = 0; index < 3; index += 1) {
      results.push(await execute('finish_memory_review', { packet: { events: 'invalid array' } }));
    }
    return {};
  };
  await assert.rejects(runConversationMemoryAgent({ ...env, settings: usableSettings, runTools, prepareOnly: true }), error => {
    assert.equal(error.code, 'MEMORY_PACKET_INVALID');
    assert.match(error.message, /packet.events/);
    return true;
  });
  assert.deepEqual(results.map(result => result.remainingAttempts), [2, 1, 0]);
  assert.deepEqual(results.map(result => result.stop), [false, false, true]);
  assert.equal(env.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n, 0);
  assert.equal(listConversationMemories(env.database, env.userId, env.conversationId).length, 0);
});

test('the extraction schema rejects model attempts to supply trusted server fields before a safe finish', async t => {
  const env = setup({ enabled: true });
  t.after(() => env.database.close());
  const runTools = validatedRunner([
    ['finish_memory_review', { packet: { version: 2, sources: [], actions: [], messageId: 'forged', idempotencyKey: 'forged' } }],
    ['finish_memory_review', {}]
  ]);
  const result = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools, idempotencyKey: 'trusted-turn', prepareOnly: true });
  assert.equal(runTools.results[0].error, 'TOOL_ARGUMENTS_INVALID');
  assert.equal(runTools.results[1].ok, true);
  assert.equal(result.packet.version, 1);
  assert.equal(result.packet.messageId, 'turn-assistant');
  assert.equal(result.packet.idempotencyKey, 'trusted-turn');
  assert.equal(result.packet.sources.length, 2);
  assert.deepEqual(result.packet.actions, []);
});

test('event capacity includes final metadata, pin, merge and invalidation projections once per memory', async t => {
  const env = setup({ enabled: true, tools: { pin_memory: true, invalidate_memory: true } });
  t.after(() => env.database.close());
  const seeds = ['First key', 'Second key', 'Duplicate key', 'Old key'].map(content =>
    createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', content }));
  const eventCount = env.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n;
  const events = Array.from({ length: 77 }, (_, index) => ({
    key: `new-${index}`, content: `Gate detail ${index}.`,
    evidence: [{ messageId: 'turn-assistant', quote: 'Mira took the silver key' }]
  }));
  const runTools = async (_settings, _messages, _tools, execute) => {
    assert.equal((await execute('update_memory', { memoryId: seeds[0].id, revision: seeds[0].revision, subject: 'Key' })).ok, true);
    assert.equal((await execute('pin_memory', { memoryId: seeds[0].id, revision: seeds[0].revision + 1 })).ok, true);
    assert.equal((await execute('merge_memories', {
      targetId: seeds[1].id, targetRevision: seeds[1].revision,
      sourceItems: [{ id: seeds[2].id, revision: seeds[2].revision }]
    })).ok, true);
    assert.equal((await execute('invalidate_memory', {
      memoryId: seeds[3].id, revision: seeds[3].revision, reason: 'The key changed hands.',
      sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key'
    })).ok, true);
    const rejected = await execute('finish_memory_review', { packet: { events } });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /events.*80.*81/);
    assert.equal(env.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n, eventCount);
    assert.equal((await execute('finish_memory_review', { packet: { events: events.slice(0, 76) } })).ok, true);
    return {};
  };
  const prepared = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools, prepareOnly: true });
  assert.equal(prepared.packet.events.length, 80);
  const projections = prepared.packet.events.filter(event => event.key.startsWith('projection:'));
  assert.equal(projections.length, 4);
  assert.equal(projections.find(event => event.key === `projection:${seeds[0].id}`).layer, 'canon');
  for (const seed of seeds.slice(2)) assert.equal(projections.find(event => event.key === `projection:${seed.id}`).lifecycle, 'rejected');
  const receipt = prepared.commit();
  assert.equal(receipt.eventIds.length, 80);
  assert.equal(env.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n, eventCount + 80);
});

test('validated memory writes preserve optional quotes and apply evidence confidence caps on updates', async () => {
  const env = setup({ enabled: true });
  try {
    const seed = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', content: 'The player holds the key.', confidence: 0.95 });
    const runTools = validatedRunner([
      ['update_memory', { memoryId: seed.id, revision: seed.revision, content: 'Mira now holds the key.' }],
      ['update_memory', { memoryId: seed.id, revision: seed.revision, content: 'Mira now holds the key.', sourceMessageId: 'turn-assistant', quote: 'Mira received the key.', confidence: 0.99 }],
      ['record_memory', { memoryType: 'intent', content: 'Mira plans to open the gate.', sourceMessageId: 'turn-assistant', confidence: 0.99 }],
      ['update_memory', { memoryId: seed.id, revision: seed.revision + 1, confidence: 0.99 }],
      ['finish_memory_review', {}],
    ]);
    const result = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools });
    assert.equal(result.finished, true);
    assert.equal(runTools.results[0].ok, false, 'changing facts needs the advertised source');
    assert.equal(runTools.results[1].memory.confidence, 0.6);
    assert.equal(runTools.results[2].memory.confidence, 0.5, 'omitted quote remains supported');
    assert.equal(runTools.results[3].memory.confidence, 0.6, 'confidence-only changes cannot bypass the cap');
    assert.equal(runTools.results[3].unchanged, true);
  } finally { env.database.close(); }
});

test('validated merge refuses pinned targets, self sources, and archived targets without resurrecting them', async () => {
  const env = setup({ enabled: true, tools: { invalidate_memory: true, pin_memory: true } });
  try {
    const target = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', content: 'The player holds the key.' });
    const source = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', content: 'The key is with the player.' });
    const pinSeed = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', content: 'Harbor guard.' });
    const pinned = pinConversationMemory(env.database, env.userId, env.conversationId, pinSeed.id, { pinned: true, revision: pinSeed.revision });
    const runTools = validatedRunner([
      ['merge_memories', { targetId: pinned.id, targetRevision: pinned.revision, sourceItems: [{ id: source.id, revision: source.revision }] }],
      ['merge_memories', { targetId: target.id, targetRevision: target.revision, sourceItems: [{ id: target.id, revision: target.revision }] }],
      ['invalidate_memory', { memoryId: target.id, revision: target.revision, reason: 'The player handed the key to Mira.', sourceMessageId: 'turn-user', quote: 'I handed Mira the silver key.' }],
      ['merge_memories', { targetId: target.id, targetRevision: target.revision + 1, sourceItems: [{ id: source.id, revision: source.revision }] }],
      ['pin_memory', { memoryId: target.id, revision: target.revision + 1 }],
      ['pin_memory', { memoryId: source.id, revision: source.revision }],
      ['finish_memory_review', {}],
    ]);
    const result = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools });
    assert.equal(result.finished, true);
    assert.deepEqual(runTools.results.slice(0, 6).map(entry => entry.ok), [false, false, true, false, false, true]);
    const stored = new Map(listConversationMemories(env.database, env.userId, env.conversationId, { includeArchived: true }).map(entry => [entry.id, entry]));
    assert.equal(stored.get(target.id).archived, true);
    assert.equal(stored.get(source.id).pinned, true);
    assert.equal(stored.get(pinned.id).revision, pinned.revision);
  } finally { env.database.close(); }
});

test('memory searches return complete content and correct totals while history filtering preserves requested hits', async () => {
  const env = setup({ enabled: true });
  try {
    const longContent = 'key '.repeat(100).trim();
    createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', content: longContent });
    createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', content: 'Another key.' });
    env.database.prepare('INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?,?)')
      .run('old-key-message', env.userId, env.conversationId, 'assistant', 'The silver key was at the gate.', '2025-01-01');
    const runTools = validatedRunner([
      ['search_memories', { limit: 1 }], ['search_history', { query: 'key', limit: 1 }], ['finish_memory_review', {}],
    ]);
    await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools });
    assert.equal(runTools.results[0].total, 2);
    assert.equal(runTools.results[0].memories.length, 1);
    assert.equal(runTools.results[0].memories[0].contentTruncated, false);
    assert.equal(runTools.results[1].messages.length, 1);
    assert.equal(runTools.results[1].messages[0].messageId, 'old-key-message');
  } finally { env.database.close(); }
});

test('memory retries refresh revisions after a partial write instead of replaying the initial snapshot', async () => {
  const env = setup({ enabled: true });
  try {
    const seed = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', content: 'The player holds the key.' });
    let calls = 0;
    const runTools = async (_settings, messages, _tools, execute) => {
      calls += 1;
      const snapshot = JSON.parse(messages[1].content);
      if (calls === 1) {
        const updated = await execute('update_memory', { memoryId: seed.id, revision: seed.revision, content: 'Mira received the key.', sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key' });
        assert.equal(updated.ok, true);
        throw Object.assign(new Error('temporary gateway failure'), { status: 502 });
      }
      assert.equal(snapshot.existingMemories.find(memory => memory.id === seed.id).revision, seed.revision + 1);
      assert.equal(snapshot.previousToolCalls[0].ok, true);
      await execute('finish_memory_review', {});
      return {};
    };
    const result = await runConversationMemoryAgent({ ...env, settings: usableSettings, runTools, retryDelaysMs: [0] });
    assert.equal(result.finished, true);
    assert.equal(calls, 2);
    assert.equal(result.updated.length, 1);
    assert.equal(listConversationMemories(env.database, env.userId, env.conversationId).length, 1);
  } finally { env.database.close(); }
});

test('memory agent skill defaults to auto and exposes a switchable tool library', () => {
  const skills = normalizeAccessorySkills({});
  assert.equal(skills.memoryAgent.enabled, 'auto');
  assert.equal(skills.memoryAgent.memoryPolicy.mode, 'structured');
  assert.equal(skills.memoryAgent.embedding.enabled, false);
  const normalized = normalizeAccessorySkills({ memoryAgent: { enabled: true, providerProfileId: ' profile-1 ', tools: { record_memory: 'off', invalidate_memory: true, 'Bad Name': true } } });
  assert.equal(normalized.memoryAgent.providerProfileId, 'profile-1');
  assert.deepEqual(normalized.memoryAgent.tools, { record_memory:false, invalidate_memory:true });
  assert.deepEqual(normalized.memoryAgent.memoryPolicy, skills.memoryAgent.memoryPolicy);

  const enabled = resolveMemoryAgentTools({ tools: { record_memory: false, invalidate_memory: true, finish_memory_review: false } });
  assert.equal(enabled.includes('record_memory'), false);
  assert.equal(enabled.includes('invalidate_memory'), true);
  assert.equal(enabled.includes('finish_memory_review'), true, 'the terminating tool cannot be switched off');
  assert.deepEqual(resolveMemoryAgentTools({}), MEMORY_AGENT_TOOLS.filter((tool) => tool.enabledByDefault).map((tool) => tool.name));
  assert.deepEqual(buildMemoryAgentToolDefinitions(enabled).map((tool) => tool.function.name), enabled);
  for (const tool of MEMORY_AGENT_TOOLS) {
    const policy = describeAiTool(tool.name);
    assert.equal(policy.domain, 'memory');
    assert.equal(policy.effect, tool.effect);
  }
});

test('memory agent records evidence-backed memories through tools and rejects invalid evidence', async () => {
  const env = setup({ enabled: 'auto', modelOverride: 'memory-model' });
  const runTools = scriptedRunner([
    ['record_memory', { memoryType: 'event', content: 'Mira received the silver key.', sourceMessageId: 'unknown-message', quote: 'took the silver key' }],
    ['record_memory', { memoryType: 'event', subject: 'Mira', content: 'Mira received the silver key from the player.', sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key', confidence: 0.95 }],
    ['record_memory', { memoryType: 'intent', subject: 'Mira', content: 'Mira plans to open the harbor gate tomorrow.', sourceMessageId: 'turn-assistant', quote: 'she will open the gate at dawn', confidence: 0.9 }],
    ['record_memory', { memoryType: 'event', subject: 'Mira', content: 'Mira received the silver key from the player.', sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key' }],
    ['record_memory', { memoryType: 'secret', content: 'nonsense', sourceMessageId: 'turn-user' }],
    ['finish_memory_review', { summary: 'Recorded the key handover.' }]
  ]);

  const result = await runConversationMemoryAgent({
    database: env.database, userId: env.userId, conversation: env.conversation,
    userMessage: env.userMessage, assistantMessage: env.assistantMessage,
    settings: usableSettings, runTools
  });

  assert.equal(result.mode, 'agent');
  assert.equal(result.finished, true);
  assert.equal(result.summary, 'Recorded the key handover.');
  assert.equal(result.providerSource, 'main');
  assert.equal(runTools.seen[0].settings.model, 'memory-model');
  assert.equal(runTools.seen[0].settings.apiKey, 'sk-main');
  assert.deepEqual(runTools.seen[0].tools, resolveMemoryAgentTools({}));
  const systemPrompt = runTools.seen[0].messages[0].content;
  assert.doesNotMatch(systemPrompt, /[\u3400-\u9fff]/);
  assert.match(systemPrompt, /Write evidence is limited to the current user and assistant messages/);
  assert.match(systemPrompt, /Write each memory concisely in Chinese when the conversation is Chinese/);
  const [invalidSource, quoted, paraphrased, duplicate, badType, finished] = runTools.results;
  assert.equal(invalidSource.ok, false);
  assert.match(invalidSource.error, /sourceMessageId/);
  assert.equal(quoted.ok, true);
  assert.equal(quoted.evidence, 'quote');
  assert.equal(paraphrased.ok, true);
  assert.equal(paraphrased.evidence, 'paraphrase');
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(badType.ok, false);
  assert.equal(finished.stop, true);
  assert.equal(result.memories.length, 2);
  assert.equal(result.rejected.length, 3);

  const stored = listConversationMemories(env.database, env.userId, env.conversationId, { includeArchived: true });
  assert.equal(stored.length, 2);
  const event = stored.find((memory) => memory.memoryType === 'event');
  const intent = stored.find((memory) => memory.memoryType === 'intent');
  assert.equal(event.sourceKind, 'auto');
  assert.equal(event.enabled, true);
  assert.equal(event.sourceMessageId, 'turn-assistant');
  assert.equal(event.sourceExcerpt, 'Mira took the silver key');
  assert.equal(event.confidence, 0.95);
  assert.equal(intent.confidence, 0.6, 'a quote that is not in the source is a paraphrase with capped confidence');
  const userPayload = JSON.parse(runTools.seen[0].messages[1].content);
  assert.deepEqual(userPayload.observation.map((message) => message.id), ['turn-user', 'turn-assistant']);
  assert.ok(userPayload.enabledTools.includes('record_memory'));
});

test('memory agent uses raw mode without configuration and leaves failed structured extraction retryable', async () => {
  const unavailable = setup({ enabled: 'auto' });
  let called = 0;
  const counting = async () => { called += 1; return {}; };
  const offline = await runConversationMemoryAgent({
    database: unavailable.database, userId: unavailable.userId, conversation: unavailable.conversation,
    userMessage: unavailable.userMessage, assistantMessage: unavailable.assistantMessage,
    settings: {}, runTools: counting
  });
  assert.equal(offline.mode, 'raw');
  assert.equal(offline.reason, 'provider_unavailable');
  assert.equal(called, 0);
  assert.deepEqual(offline.memories, []);

  const disabled = setup({ enabled: false });
  const off = await runConversationMemoryAgent({
    database: disabled.database, userId: disabled.userId, conversation: disabled.conversation,
    userMessage: disabled.userMessage, assistantMessage: disabled.assistantMessage,
    settings: usableSettings, runTools: counting
  });
  assert.equal(off.mode, 'raw');
  assert.equal(off.reason, 'agent_disabled');
  assert.equal(called, 0);
  assert.deepEqual(off.memories, []);

  const failing = setup({ enabled: true });
  await assert.rejects(() => runConversationMemoryAgent({
    database: failing.database, userId: failing.userId, conversation: failing.conversation,
    userMessage: failing.userMessage, assistantMessage: failing.assistantMessage,
    settings: usableSettings, runTools: async () => { throw Object.assign(new Error('gateway exploded'), { status: 502 }); }
  }), /gateway exploded/);
  assert.deepEqual(listConversationMemories(failing.database,failing.userId,failing.conversationId), []);

  const cancelled = setup({ enabled: true });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => runConversationMemoryAgent({
    database: cancelled.database, userId: cancelled.userId, conversation: cancelled.conversation,
    userMessage: cancelled.userMessage, assistantMessage: cancelled.assistantMessage,
    settings: usableSettings, signal: controller.signal,
    runTools: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }
  }), /aborted/);
});

test('memory agent updates, merges and invalidates only with matching revisions and never touches pinned memories', async () => {
  const env = setup({ enabled: true, tools: { invalidate_memory: true } });
  env.assistantMessage.content += ' Mira then lost the silver key.';
  env.database.prepare('UPDATE messages SET content = ? WHERE id = ?').run(env.assistantMessage.content, env.assistantMessage.id);
  const pinnedSeed = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'fact', subject: 'Mira', content: 'Mira guards the harbor.' });
  const pinned = pinConversationMemory(env.database, env.userId, env.conversationId, pinnedSeed.id, { pinned: true, revision: pinnedSeed.revision });
  const first = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', subject: 'key', content: 'The key is with the player.' });
  const second = createConversationMemory(env.database, env.userId, env.conversationId, { memoryType: 'event', subject: 'key', content: 'The player keeps the silver key.' });
  const runTools = scriptedRunner([
    ['update_memory', { memoryId: pinned.id, revision: pinned.revision, content: 'Rewritten' }],
    ['update_memory', { memoryId: first.id, revision: first.revision + 5, content: 'Stale revision' }],
    ['update_memory', { memoryId: first.id, revision: first.revision, content: 'Mira now holds the silver key.', sourceMessageId: 'turn-assistant', quote: 'Mira took the silver key' }],
    ['merge_memories', { targetId: first.id, targetRevision: first.revision + 1, sourceItems: [{ id: second.id, revision: second.revision }] }],
    ['merge_memories', { targetId: first.id, targetRevision: first.revision + 2, sourceItems: [{ id: pinned.id, revision: pinned.revision }] }],
    ['invalidate_memory', { memoryId: first.id, revision: first.revision + 2, reason: 'The assistant narrated that Mira lost the key.', sourceMessageId: 'turn-assistant', quote: 'Mira then lost the silver key.' }],
    ['pin_memory', { memoryId: first.id, revision: first.revision + 3 }],
    ['finish_memory_review', {}]
  ]);

  const result = await runConversationMemoryAgent({
    database: env.database, userId: env.userId, conversation: env.conversation,
    userMessage: env.userMessage, assistantMessage: env.assistantMessage,
    settings: usableSettings, runTools
  });
  const [pinnedUpdate, staleUpdate, update, merge, pinnedMerge, invalidate, pin] = runTools.results;
  assert.equal(pinnedUpdate.ok, false);
  assert.match(pinnedUpdate.error, /置顶/);
  assert.equal(staleUpdate.ok, false);
  assert.equal(staleUpdate.currentRevision, first.revision);
  assert.equal(update.ok, true);
  assert.equal(merge.ok, true);
  assert.deepEqual(merge.archivedSourceIds, [second.id]);
  assert.equal(pinnedMerge.ok, false);
  assert.equal(invalidate.ok, true);
  assert.equal(pin.ok, false, 'pin_memory stays off unless the conversation enables it');
  assert.match(pin.error, /未启用/);
  assert.equal(result.updated.length, 1);
  assert.equal(result.merged.length, 1);
  assert.equal(result.invalidated.length, 1);

  const stored = new Map(listConversationMemories(env.database, env.userId, env.conversationId, { includeArchived: true }).map((memory) => [memory.id, memory]));
  assert.equal(stored.get(pinned.id).content, 'Mira guards the harbor.');
  assert.equal(stored.get(pinned.id).pinned, true);
  assert.equal(stored.get(first.id).content, 'Mira now holds the silver key.');
  assert.equal(stored.get(first.id).sourceExcerpt, 'Mira took the silver key');
  assert.equal(stored.get(first.id).archived, true, 'invalidated after the merge');
  assert.equal(stored.get(second.id).archived, true);
  assert.equal(stored.get(second.id).mergedIntoId, first.id);
});

test('accessory skill provider resolution follows the main chat or a saved provider profile', () => {
  const env = setup();
  const main = { ...usableSettings };
  assert.deepEqual(resolveAccessorySkillSettings(env.database, env.userId, main, { providerProfileId: '', modelOverride: '' }), { settings: main, source: 'main', profileId: '' });
  const overridden = resolveAccessorySkillSettings(env.database, env.userId, main, { modelOverride: 'cheap-model' });
  assert.equal(overridden.settings.model, 'cheap-model');
  assert.equal(overridden.settings.apiKey, 'sk-main');
  assert.equal(overridden.source, 'main');

  const missing = resolveAccessorySkillSettings(env.database, env.userId, main, { providerProfileId: 'gone', modelOverride: 'x' });
  assert.equal(missing.source, 'main');
  assert.equal(missing.warning, 'profile_missing');
  assert.equal(missing.settings.model, 'x');

  const profile = createProviderProfile(env.database, env.userId, {
    providerType: 'custom', gatewayName: 'Memory Gateway', baseUrl: 'https://memory-profile.test/v1', model: 'profile-model',
    encryptedApiKey: encryptSecret('sk-profile'), apiKeyHint: 'sk-****file', supportsReasoning: false, extraBody: '{}'
  }, { select: false });
  const resolved = resolveAccessorySkillSettings(env.database, env.userId, main, { providerProfileId: profile.id });
  assert.equal(resolved.source, 'profile', resolved.warning);
  assert.equal(resolved.settings.model, 'profile-model');
  assert.equal(resolved.settings.apiKey, 'sk-profile');
  assert.equal(resolved.settings.gatewayName, 'Memory Gateway');
  const resolvedWithModel = resolveAccessorySkillSettings(env.database, env.userId, main, { providerProfileId: profile.id, modelOverride: 'profile-mini' });
  assert.equal(resolvedWithModel.settings.model, 'profile-mini');

  const unusable = createProviderProfile(env.database, env.userId, {
    providerType: 'custom', gatewayName: 'Empty', baseUrl: '', model: '', extraBody: '{}'
  }, { select: false });
  const fallback = resolveAccessorySkillSettings(env.database, env.userId, main, { providerProfileId: unusable.id });
  assert.equal(fallback.source, 'main');
  assert.equal(fallback.warning, 'profile_unusable');
});
