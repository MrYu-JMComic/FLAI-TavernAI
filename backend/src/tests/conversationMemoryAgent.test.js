import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-memory-agent';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationMemory, listConversationMemories, pinConversationMemory } = await import('../modules/conversationMemories.js');
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

test('memory agent skill defaults to auto and exposes a switchable tool library', () => {
  const skills = normalizeAccessorySkills({});
  assert.deepEqual(skills.memoryAgent, { enabled: 'auto', modelOverride: '', providerProfileId: '', tools: {} });
  const normalized = normalizeAccessorySkills({ memoryAgent: { enabled: true, providerProfileId: ' profile-1 ', tools: { record_memory: 'off', invalidate_memory: true, 'Bad Name': true } } });
  assert.deepEqual(normalized.memoryAgent, { enabled: true, modelOverride: '', providerProfileId: 'profile-1', tools: { record_memory: false, invalidate_memory: true } });

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

test('memory agent falls back to rule extraction when the model is unavailable, disabled or failing', async () => {
  const unavailable = setup({ enabled: 'auto' });
  let called = 0;
  const counting = async () => { called += 1; return {}; };
  const offline = await runConversationMemoryAgent({
    database: unavailable.database, userId: unavailable.userId, conversation: unavailable.conversation,
    userMessage: unavailable.userMessage, assistantMessage: unavailable.assistantMessage,
    settings: {}, runTools: counting
  });
  assert.equal(offline.mode, 'rules');
  assert.equal(offline.reason, 'provider_unavailable');
  assert.equal(called, 0);
  assert.equal(offline.memories.some((memory) => memory.memoryType === 'preference'), true);

  const disabled = setup({ enabled: false });
  const off = await runConversationMemoryAgent({
    database: disabled.database, userId: disabled.userId, conversation: disabled.conversation,
    userMessage: disabled.userMessage, assistantMessage: disabled.assistantMessage,
    settings: usableSettings, runTools: counting
  });
  assert.equal(off.mode, 'rules');
  assert.equal(off.reason, 'agent_disabled');
  assert.equal(called, 0);
  assert.ok(off.memories.length > 0);

  const failing = setup({ enabled: true });
  const failed = await runConversationMemoryAgent({
    database: failing.database, userId: failing.userId, conversation: failing.conversation,
    userMessage: failing.userMessage, assistantMessage: failing.assistantMessage,
    settings: usableSettings, runTools: async () => { throw Object.assign(new Error('gateway exploded'), { status: 502 }); }
  });
  assert.equal(failed.mode, 'rules');
  assert.equal(failed.fallback, true);
  assert.equal(failed.error, 'gateway exploded');
  assert.ok(failed.memories.length > 0);

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
    ['invalidate_memory', { memoryId: first.id, revision: first.revision + 2, reason: 'The assistant narrated that Mira lost the key.' }],
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
