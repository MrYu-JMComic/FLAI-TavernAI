import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-cast-agent-settings';

const { createAppDatabase } = await import('../db.js');
const { CAST_AUTO_SYNC_OPERATIONS, CAST_OPERATION_NAMES } = await import('../domain/cast/constants.js');
const { assertCastPlanPermissions } = await import('../domain/cast/changePlan.js');
const { describeCastAgentOperations, resolveCastAgentOperations, resolveCastAgentSettings } = await import('../services/cast/castAgentSettings.js');
const { buildCastProjectionMessages } = await import('../services/prompts/castProjectionPrompt.js');
const { buildCastOrganizerMessages } = await import('../services/prompts/castOrganizerPrompt.js');
const { buildCastPlanRepairMessages } = await import('../services/prompts/castPlanRepairPrompt.js');
const { projectConversationCast } = await import('../services/cast/castProjector.js');
const { organizeConversationCast } = await import('../services/cast/castOrganizer.js');
const { ensureConversationProtagonist } = await import('../services/cast/castCommandService.js');
const { getCastRoster } = await import('../services/cast/castQueryService.js');
const { clearCastSyncStatusForTests } = await import('../services/cast/castSyncStatus.js');
const { createProviderProfile } = await import('../repositories/providerProfileRepository.js');
const { encryptSecret } = await import('../security.js');

const mainSettings = Object.freeze({
  id: 'main-profile',
  providerType: 'custom',
  gatewayName: 'Main Gateway',
  baseUrl: 'https://cast-agent-provider.test/v1',
  model: 'main-model',
  apiKey: 'sk-main',
  supportsReasoning: false,
  extraBody: {}
});

function createFixture(castTracking = {}) {
  const database = createAppDatabase(':memory:');
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = 'cast-agent-user';
  const characterId = 'cast-agent-character';
  const conversationId = 'cast-agent-conversation';
  const settings = { castTracking: { enabled: true, ...castTracking } };
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(characterId, userId, 'Hero', timestamp, timestamp);
  database.prepare(`INSERT INTO conversations (id, user_id, character_id, title, user_advanced_settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(conversationId, userId, characterId, 'Cast agent', JSON.stringify(settings), timestamp, timestamp);
  ensureConversationProtagonist(database, userId, conversationId);
  const insert = database.prepare(`INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', '', NULL, ?)`);
  insert.run('cast-user', userId, conversationId, 'user', 'Who is at the tower?', timestamp);
  insert.run('cast-assistant', userId, conversationId, 'assistant', 'Alice arrived at the tower and revealed the iron key.', timestamp);
  return {
    database, userId, characterId, conversationId,
    conversation: { id: conversationId, characterId, settings },
    userMessage: { id: 'cast-user', role: 'user', content: 'Who is at the tower?', revision: 1 },
    assistantMessage: { id: 'cast-assistant', role: 'assistant', content: 'Alice arrived at the tower and revealed the iron key.', revision: 1 }
  };
}

function planText(operations) {
  return JSON.stringify({ version: 1, summary: 'test plan', operations });
}

test('cast agent operation library defaults to every plan operation and can be narrowed per conversation', () => {
  const catalog = describeCastAgentOperations();
  assert.deepEqual(catalog.map((operation) => operation.name), [...CAST_OPERATION_NAMES]);
  assert.deepEqual(catalog.filter((operation) => operation.autoSync).map((operation) => operation.name), [...CAST_AUTO_SYNC_OPERATIONS]);
  assert.deepEqual(resolveCastAgentOperations({}, 'auto_sync'), [...CAST_AUTO_SYNC_OPERATIONS]);
  assert.deepEqual(resolveCastAgentOperations({}, 'ai_organize'), [...CAST_OPERATION_NAMES]);
  const narrowed = resolveCastAgentOperations({ autoSyncOperations: { 'member.create': false, 'memory.delete': true } }, 'auto_sync');
  assert.equal(narrowed.includes('member.create'), false);
  assert.equal(narrowed.includes('memory.delete'), false, 'auto sync can never grow beyond its base operation set');
  const organize = resolveCastAgentOperations({ organizeOperations: { 'memory.delete': false, 'member.hide': false } }, 'ai_organize');
  assert.equal(organize.includes('memory.delete'), false);
  assert.equal(organize.includes('member.hide'), false);
  assert.equal(organize.includes('member.update'), true);

  const projection = buildCastProjectionMessages({ observation: [], castSnapshot: {}, allowedOperations: narrowed });
  const projectionSchema = JSON.parse(projection[1].content).contract.jsonSchema;
  assert.deepEqual(projectionSchema.properties.operations.items.oneOf.map((variant) => variant.properties.op.const), narrowed);
  const organizer = buildCastOrganizerMessages({ scope: 'conversation', requirement: '', castSnapshot: [], messages: [], allowedOperations: organize });
  const organizerSchema = JSON.parse(organizer[1].content).contract.jsonSchema;
  assert.deepEqual(organizerSchema.properties.operations.items.oneOf.map((variant) => variant.properties.op.const), organize);

  const plan = { version: 1, summary: 's', operations: [{ op: 'member.create', target: { name: 'Bob' }, changes: {} }] };
  assert.throws(() => assertCastPlanPermissions(structuredClone(plan), { sourceKind: 'auto_sync', scope: 'conversation', allowedOperations: narrowed }), /does not allow/);
  assert.doesNotThrow(() => assertCastPlanPermissions(structuredClone(plan), { sourceKind: 'auto_sync', scope: 'conversation', allowedOperations: [...CAST_AUTO_SYNC_OPERATIONS] }));
  assert.doesNotThrow(() => assertCastPlanPermissions(structuredClone(plan), { sourceKind: 'manual', scope: 'conversation', allowedOperations: [] }));
});

test('cast agent prompts require one raw CastChangePlanV1 JSON object', () => {
  const prompts = [
    buildCastProjectionMessages({ observation: [], castSnapshot: {}, allowedOperations: CAST_AUTO_SYNC_OPERATIONS }),
    buildCastOrganizerMessages({ scope: 'conversation', requirement: '', castSnapshot: [], messages: [], allowedOperations: CAST_OPERATION_NAMES }),
  ];
  for (const messages of prompts) {
    assert.match(messages[0].content, /OUTPUT CONTRACT \(mandatory\)/);
    assert.match(messages[0].content, /first non-whitespace character must be \{/);
    assert.match(messages[0].content, /Never wrap the JSON in Markdown fences/);
    assert.match(messages[0].content, /top-level object must contain exactly the keys "version", "summary", and "operations"/);
    const contract = JSON.parse(messages[1].content).contract;
    assert.deepEqual(contract.format, {
      mediaType: 'application/json',
      rawObjectOnly: true,
      requiredTopLevelKeys: ['version', 'summary', 'operations'],
      example: { version: 1, summary: 'No safe changes', operations: [] },
    });
  }

  const repaired = buildCastPlanRepairMessages(prompts[0], '```json\n{}\n```', {
    code: 'CAST_PLAN_JSON',
    message: 'Invalid JSON',
  });
  const repairRequest = JSON.parse(repaired.at(-1).content);
  assert.equal(repairRequest.outputContract.rawObjectOnly, true);
  assert.deepEqual(repairRequest.outputContract.requiredTopLevelKeys, ['version', 'summary', 'operations']);
  assert.ok(repairRequest.outputContract.rules.some((rule) => /Do not use Markdown fences/.test(rule)));
  assert.ok(repairRequest.outputContract.rules.some((rule) => /Do not add facts or operations/.test(rule)));
});

test('cast agent thinking inherits the main conversation and allows an explicit override', () => {
  const fixture = createFixture();
  const reasoningSettings = {
    ...mainSettings,
    providerType: 'openai',
    model: 'gpt-5.4',
    supportsReasoning: true,
  };
  try {
    const inherited = resolveCastAgentSettings(
      fixture.database,
      fixture.userId,
      reasoningSettings,
      {},
      { mainThinkingLevel: 'high' }
    );
    assert.equal(inherited.thinkingLevel, 'high');
    assert.equal(inherited.thinkingEnabled, true);
    assert.equal(inherited.thinkingSource, 'main');

    const overridden = resolveCastAgentSettings(
      fixture.database,
      fixture.userId,
      reasoningSettings,
      { thinkingLevel: 'low' },
      { mainThinkingLevel: 'xhigh' }
    );
    assert.equal(overridden.thinkingLevel, 'low');
    assert.equal(overridden.thinkingSource, 'agent');

    const disabled = resolveCastAgentSettings(
      fixture.database,
      fixture.userId,
      reasoningSettings,
      { thinkingLevel: 'off' },
      { mainThinkingLevel: 'high' }
    );
    assert.equal(disabled.thinkingLevel, 'off');
    assert.equal(disabled.thinkingEnabled, false);

    const mapped = resolveCastAgentSettings(
      fixture.database,
      fixture.userId,
      { ...reasoningSettings, providerType: 'deepseek', model: 'deepseek-chat' },
      {},
      { mainThinkingLevel: 'medium' }
    );
    assert.equal(mapped.thinkingLevel, 'high');

    const unsupported = resolveCastAgentSettings(
      fixture.database,
      fixture.userId,
      mainSettings,
      { thinkingLevel: 'high' },
      { mainThinkingLevel: 'high' }
    );
    assert.equal(unsupported.thinkingEnabled, false);
    assert.equal(unsupported.thinkingSource, 'unsupported');
  } finally {
    fixture.database.close();
  }
});

test('cast projector sends the inherited or agent-specific thinking level to the provider', async () => {
  clearCastSyncStatusForTests();
  const fixture = createFixture();
  const reasoningSettings = {
    ...mainSettings,
    providerType: 'openai',
    model: 'gpt-5.4',
    supportsReasoning: true,
  };
  const calls = [];
  const generate = async (_settings, _messages, options) => {
    calls.push(options);
    return { content: planText([]) };
  };
  try {
    const inherited = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      userMessage: fixture.userMessage,
      assistantMessage: fixture.assistantMessage,
      settings: reasoningSettings,
      mainThinkingLevel: 'xhigh',
      generate,
      publish: (_id, state) => state,
    });
    assert.equal(inherited.ok, true, inherited.error);
    assert.equal(calls[0].thinkingLevel, 'xhigh');
    assert.equal(calls[0].thinkingEnabled, true);
    assert.equal(inherited.status.thinkingSource, 'main');

    fixture.conversation.settings.castTracking.thinkingLevel = 'low';
    const overridden = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      userMessage: fixture.userMessage,
      assistantMessage: fixture.assistantMessage,
      settings: reasoningSettings,
      mainThinkingLevel: 'xhigh',
      idempotencyKey: 'cast-thinking-override',
      generate,
      publish: (_id, state) => state,
    });
    assert.equal(overridden.ok, true, overridden.error);
    assert.equal(calls[1].thinkingLevel, 'low');
    assert.equal(calls[1].thinkingEnabled, true);
    assert.equal(overridden.status.thinkingSource, 'agent');
  } finally {
    fixture.database.close();
  }
});

test('cast projector follows the main chat provider by default and a saved profile when configured', async () => {
  clearCastSyncStatusForTests();
  const fixture = createFixture();
  try {
    const calls = [];
    const generate = async (settings, messages) => {
      calls.push({ settings, messages });
      return { content: planText([{ op: 'member.create', target: { name: 'Alice' }, changes: { currentLocationLabel: 'Tower' }, evidence: { messageId: 'cast-assistant', quote: 'Alice arrived at the tower', kind: 'fact' } }]) };
    };
    const first = await projectConversationCast({
      database: fixture.database, userId: fixture.userId, conversation: fixture.conversation,
      userMessage: fixture.userMessage, assistantMessage: fixture.assistantMessage,
      settings: mainSettings, generate, publish: (_id, state) => state
    });
    assert.equal(first.ok, true, first.error);
    assert.equal(calls[0].settings, mainSettings, 'no override keeps the exact main settings object');
    assert.equal(first.status.providerSource, 'main');
    assert.equal(first.status.model, 'main-model');
    assert.equal(getCastRoster(fixture.database, fixture.userId, fixture.conversationId).npcs.length, 1);

    const profile = createProviderProfile(fixture.database, fixture.userId, {
      providerType: 'custom', gatewayName: 'Cast Gateway', baseUrl: 'https://cast-profile.test/v1', model: 'cast-model',
      encryptedApiKey: encryptSecret('sk-cast'), apiKeyHint: 'sk-****cast', supportsReasoning: false, extraBody: '{}'
    }, { select: false });
    fixture.conversation.settings.castTracking = { enabled: true, providerProfileId: profile.id, modelOverride: 'cast-mini', autoSyncOperations: { 'member.create': false } };
    fixture.database.prepare('UPDATE conversations SET user_advanced_settings = ? WHERE id = ?')
      .run(JSON.stringify(fixture.conversation.settings), fixture.conversationId);
    const second = await projectConversationCast({
      database: fixture.database, userId: fixture.userId, conversation: fixture.conversation,
      userMessage: fixture.userMessage, assistantMessage: { ...fixture.assistantMessage, id: 'cast-assistant' },
      settings: mainSettings, generate, publish: (_id, state) => state, idempotencyKey: 'second-run'
    });
    // A forbidden operation is repairable, so the projector asks once more; both calls use the profile.
    assert.ok(calls.length >= 2);
    for (const call of calls.slice(1)) {
      assert.equal(call.settings.model, 'cast-mini');
      assert.equal(call.settings.apiKey, 'sk-cast');
      assert.equal(call.settings.gatewayName, 'Cast Gateway');
    }
    const variants = JSON.parse(calls[1].messages[1].content).contract.jsonSchema.properties.operations.items.oneOf;
    assert.equal(variants.some((variant) => variant.properties.op.const === 'member.create'), false);
    // The model still proposed member.create; the narrowed library rejects it before anything is written.
    assert.equal(second.ok, false);
    assert.equal(second.code, 'CAST_PLAN_FORBIDDEN_OPERATION');
    assert.equal(second.status.providerSource, undefined);
  } finally {
    fixture.database.close();
  }
});

test('cast organizer rejects operations outside the conversation library before applying anything', async () => {
  const fixture = createFixture();
  try {
    const progress = [];
    const generate = async () => ({ content: planText([{ op: 'memory.delete', target: { name: 'Alice', memoryId: 'missing-memory' } }]) });
    await assert.rejects(() => organizeConversationCast({
      database: fixture.database, userId: fixture.userId, conversationId: fixture.conversationId,
      settings: mainSettings, scope: 'conversation', requirement: 'Clean up', messages: [], generate,
      allowedOperations: resolveCastAgentOperations({ organizeOperations: { 'memory.delete': false } }, 'ai_organize'),
      onProgress: async (phase) => { progress.push(phase); }
    }), (error) => error.code === 'CAST_PLAN_FORBIDDEN_OPERATION');
    assert.deepEqual(progress, ['context', 'generating', 'validating', 'validating']);
  } finally {
    fixture.database.close();
  }
});

test('cast agent provider resolution reuses the accessory skill resolver', () => {
  const fixture = createFixture();
  try {
    const followed = resolveCastAgentSettings(fixture.database, fixture.userId, mainSettings, { providerProfileId: '', modelOverride: '' });
    assert.equal(followed.settings, mainSettings);
    assert.equal(followed.source, 'main');
    const overridden = resolveCastAgentSettings(fixture.database, fixture.userId, mainSettings, { modelOverride: 'mini' });
    assert.equal(overridden.settings.model, 'mini');
    assert.equal(overridden.settings.apiKey, 'sk-main');
    const missing = resolveCastAgentSettings(fixture.database, fixture.userId, mainSettings, { providerProfileId: 'nope' });
    assert.equal(missing.warning, 'profile_missing');
    assert.equal(missing.settings, mainSettings);
  } finally {
    fixture.database.close();
  }
});
