import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { saveConversationAppearance } from '../modules/conversationAppearance.js';
import {
  createCastMember,
  ensureConversationProtagonist,
} from '../services/cast/castCommandService.js';
import { getCastRoster } from '../services/cast/castQueryService.js';
import { projectConversationCast } from '../services/cast/castProjector.js';
import { organizeConversationCast } from '../services/cast/castOrganizer.js';
import {
  clearCastSyncStatusForTests,
  subscribeCastSyncStatus,
} from '../services/cast/castSyncStatus.js';
import { listCastMemories } from '../repositories/castRepository.js';

test('cast tracking has one boolean setting and persists without a model override', () => {
  const normalized = normalizeAdvancedSettings({
    castTracking: { enabled: 'true', modelOverride: 'must-not-survive' },
  });
  assert.deepEqual(normalized.castTracking, { enabled: true });
  assert.equal('modelOverride' in normalized.castTracking, false);

  const fixture = createFixture();
  try {
    saveConversationAppearance(fixture.database, fixture.userId, fixture.conversationId, {
      castTracking: { enabled: true },
    });
    const stored = JSON.parse(fixture.database.prepare(
      'SELECT user_advanced_settings FROM conversations WHERE id = ?'
    ).get(fixture.conversationId).user_advanced_settings);
    assert.deepEqual(stored.castTracking, { enabled: true });
  } finally {
    fixture.database.close();
  }
});

test('cast projector uses the current chat model without tools and applies an idempotent plan', async () => {
  clearCastSyncStatusForTests();
  const fixture = createFixture({ castTracking: true });
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    const userMessage = insertMessage(database, fixture, {
      id: 'message-user', role: 'user', content: 'Who is at the tower?'
    });
    const assistantMessage = insertMessage(database, fixture, {
      id: 'message-assistant',
      role: 'assistant',
      content: 'Alice arrived at the tower and revealed the iron key.'
    });
    const settings = {
      providerType: 'openai-compatible',
      gatewayName: 'Current Chat Gateway',
      baseUrl: 'https://provider.invalid/v1',
      model: 'current-chat-model',
      apiKey: 'test',
      supportsReasoning: false,
      extraBody: {},
    };
    const calls = [];
    const statuses = [];
    const unsubscribe = subscribeCastSyncStatus(conversationId, (status) => statuses.push(status));
    const generate = async (receivedSettings, messages, options) => {
      calls.push({ receivedSettings, messages, options });
      return {
        content: JSON.stringify({
          version: 1,
          summary: 'Alice joined the cast.',
          operations: [
            {
              op: 'member.create',
              target: { name: 'Alice' },
              changes: { currentLocationLabel: 'Tower' },
              evidence: { messageId: assistantMessage.id, quote: 'Alice arrived at the tower' },
              confidence: 0.98,
            },
            {
              op: 'memory.create',
              target: { name: 'Alice' },
              changes: { content: 'Alice revealed the iron key.', importance: 0.8 },
              evidence: { messageId: assistantMessage.id, quote: 'revealed the iron key' },
            },
          ],
        }),
      };
    };

    const first = await projectConversationCast({
      database,
      userId,
      conversation: fixture.conversation,
      userMessage,
      assistantMessage,
      settings,
      generate,
    });
    unsubscribe();
    assert.equal(first.ok, true);
    assert.equal(first.batch.status, 'applied');
    assert.deepEqual(statuses.map((status) => status.status), ['queued', 'running', 'applied']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].receivedSettings, settings);
    assert.equal(calls[0].receivedSettings.model, 'current-chat-model');
    assert.equal(calls[0].options.tools, undefined);
    assert.equal(calls[0].options.executeTool, undefined);
    assert.match(calls[0].messages[0].content, /return exactly one CastChangePlanV1 JSON object/);
    assert.doesNotMatch(calls[0].messages[0].content, /call (?:a )?tool/i);
    const promptPayload = JSON.parse(calls[0].messages[1].content);
    const promptVariants = promptPayload.contract.jsonSchema.properties.operations.items.oneOf;
    assert.equal(promptPayload.contract.name, 'CastChangePlanV1');
    assert.equal(promptPayload.contract.jsonSchema.properties.operations.maxItems, 40);
    assert.equal(promptVariants.length, 8);
    assert.equal(promptVariants.every((variant) => variant.required.includes('evidence')), true);

    const alice = getCastRoster(database, userId, conversationId).npcs[0];
    assert.equal(alice.canonicalName, 'Alice');
    assert.equal(listCastMemories(database, conversationId, alice.id).length, 1);

    const repeated = await projectConversationCast({
      database,
      userId,
      conversation: fixture.conversation,
      userMessage,
      assistantMessage,
      settings,
      generate,
    });
    assert.equal(repeated.skipped, true);
    assert.equal(calls.length, 1);
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 1);
  } finally {
    database.close();
    clearCastSyncStatusForTests();
  }
});

test('cast projector repairs one realistic schema mismatch without tools and then applies it', async () => {
  const fixture = createFixture({ castTracking: true });
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    const assistantMessage = insertMessage(fixture.database, fixture, {
      id: 'assistant-repair-success',
      role: 'assistant',
      content: 'Alice arrived at the tower.',
    });
    const calls = [];
    const invalidPlan = JSON.stringify({
      version: 1,
      operations: [{
        op: 'member.create',
        name: 'Alice',
        location: 'Tower',
        evidence: { messageId: assistantMessage.id, quote: 'Alice arrived at the tower' },
      }],
    });
    const repairedPlan = JSON.stringify({
      version: 1,
      summary: 'Alice joined the cast.',
      operations: [{
        op: 'member.create',
        target: { name: 'Alice' },
        changes: { currentLocationLabel: 'Tower' },
        evidence: { messageId: assistantMessage.id, quote: 'Alice arrived at the tower' },
      }],
    });
    const result = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      assistantMessage,
      settings: { model: 'current-chat-model' },
      generate: async (settings, messages, options) => {
        calls.push({ settings, messages, options });
        return { content: calls.length === 1 ? invalidPlan : repairedPlan };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.status.repairAttempted, true);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.options.tools === undefined), true);
    assert.equal(calls.every((call) => call.options.executeTool === undefined), true);
    assert.equal(calls[1].messages.at(-2).content, invalidPlan);
    const repairRequest = JSON.parse(calls[1].messages.at(-1).content);
    assert.equal(repairRequest.validation.code, 'CAST_PLAN_SCHEMA');
    assert.equal(repairRequest.validation.issues.some((issue) => issue.path.includes('target')), true);
    const alice = getCastRoster(fixture.database, fixture.userId, fixture.conversationId).npcs[0];
    assert.equal(alice.canonicalName, 'Alice');
    assert.equal(alice.currentLocationLabel, 'Tower');
  } finally {
    fixture.database.close();
  }
});

test('cast projector reports final schema paths after one failed repair', async () => {
  clearCastSyncStatusForTests();
  const fixture = createFixture({ castTracking: true });
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    const assistantMessage = insertMessage(fixture.database, fixture, {
      id: 'assistant-repair-failure',
      role: 'assistant',
      content: 'Alice arrived at the tower.',
    });
    const statuses = [];
    const unsubscribe = subscribeCastSyncStatus(fixture.conversationId, (status) => statuses.push(status));
    let calls = 0;
    const result = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      assistantMessage,
      settings: { model: 'current-chat-model' },
      generate: async () => {
        calls += 1;
        return {
          content: JSON.stringify({
            version: 1,
            operations: [{
              op: 'member.create',
              name: 'Alice',
              evidence: { messageId: assistantMessage.id, quote: 'Alice arrived at the tower' },
            }],
          }),
        };
      },
    });
    unsubscribe();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAST_PLAN_SCHEMA');
    assert.equal(result.repairAttempted, true);
    assert.equal(result.details.some((issue) => issue.path.includes('target')), true);
    assert.equal(calls, 2);
    assert.deepEqual(statuses.map((status) => status.status), ['queued', 'running', 'error']);
    assert.equal(statuses.at(-1).code, 'CAST_PLAN_SCHEMA');
    assert.equal(statuses.at(-1).repairAttempted, true);
    assert.equal(statuses.at(-1).details.some((issue) => issue.path.includes('target')), true);
    assert.equal(getCastRoster(fixture.database, fixture.userId, fixture.conversationId).npcs.length, 0);
  } finally {
    fixture.database.close();
    clearCastSyncStatusForTests();
  }
});

test('cast projector does not retry provider failures', async () => {
  const fixture = createFixture({ castTracking: true });
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    const assistantMessage = insertMessage(fixture.database, fixture, {
      id: 'assistant-provider-failure',
      role: 'assistant',
      content: 'Alice arrived.',
    });
    let calls = 0;
    const result = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      assistantMessage,
      settings: { model: 'current-chat-model' },
      generate: async () => {
        calls += 1;
        throw new Error('Provider unavailable');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.repairAttempted, false);
    assert.equal(calls, 1);
  } finally {
    fixture.database.close();
  }
});

test('disabled or malformed cast projection leaves the domain unchanged', async () => {
  const disabled = createFixture({ castTracking: false });
  try {
    ensureConversationProtagonist(disabled.database, disabled.userId, disabled.conversationId);
    let calls = 0;
    const result = await projectConversationCast({
      database: disabled.database,
      userId: disabled.userId,
      conversation: disabled.conversation,
      assistantMessage: { id: 'assistant-disabled', role: 'assistant', content: 'Alice appeared.' },
      settings: { model: 'same-model' },
      generate: async () => {
        calls += 1;
        return { content: '{}' };
      },
    });
    assert.equal(result.skipped, true);
    assert.equal(calls, 0);
    assert.equal(getCastRoster(disabled.database, disabled.userId, disabled.conversationId).npcs.length, 0);
  } finally {
    disabled.database.close();
  }

  const malformed = createFixture({ castTracking: true });
  try {
    ensureConversationProtagonist(malformed.database, malformed.userId, malformed.conversationId);
    const assistantMessage = insertMessage(malformed.database, malformed, {
      id: 'assistant-malformed', role: 'assistant', content: 'Alice appeared.'
    });
    const result = await projectConversationCast({
      database: malformed.database,
      userId: malformed.userId,
      conversation: malformed.conversation,
      assistantMessage,
      settings: { model: 'same-model' },
      generate: async () => ({ content: 'I would call a tool now.' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAST_PLAN_JSON');
    assert.equal(getCastRoster(malformed.database, malformed.userId, malformed.conversationId).npcs.length, 0);
  } finally {
    malformed.database.close();
  }
});

test('cast projection rejects evidence from outside the completed turn', async () => {
  const fixture = createFixture({ castTracking: true });
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    insertMessage(fixture.database, fixture, {
      id: 'assistant-old', role: 'assistant', content: 'Alice once visited the harbor.'
    });
    const assistantMessage = insertMessage(fixture.database, fixture, {
      id: 'assistant-current', role: 'assistant', content: 'The room remains empty.'
    });
    const result = await projectConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversation: fixture.conversation,
      assistantMessage,
      settings: { model: 'same-model' },
      generate: async () => ({
        content: JSON.stringify({
          version: 1,
          operations: [{
            op: 'member.create',
            target: { name: 'Alice' },
            changes: {},
            evidence: { messageId: 'assistant-old', quote: 'Alice once visited the harbor' },
          }],
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAST_PLAN_EVIDENCE');
    assert.equal(getCastRoster(fixture.database, fixture.userId, fixture.conversationId).npcs.length, 0);
  } finally {
    fixture.database.close();
  }
});

test('cast organizer emits ordered progress and applies one no-tool plan', async () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    const alice = createCastMember(database, userId, conversationId, { canonicalName: 'Alice' });
    const controller = new AbortController();
    const phases = [];
    const calls = [];
    const result = await organizeConversationCast({
      database,
      userId,
      conversationId,
      settings: { model: 'current-chat-model' },
      scope: 'member',
      scopeMemberId: alice.id,
      requirement: 'Normalize the relationship.',
      messages: [{ id: 'evidence-1', role: 'assistant', content: 'Alice is now an ally.' }],
      signal: controller.signal,
      onProgress: async (phase, data) => phases.push({ phase, data }),
      generate: async (settings, messages, options) => {
        calls.push({ settings, messages, options });
        return {
          content: JSON.stringify({
            version: 1,
            summary: 'Relationship normalized.',
            operations: [{
              op: 'member.update',
              target: { memberId: alice.id },
              changes: { relationship: 'ally', revision: alice.revision },
            }],
          }),
        };
      },
    });
    assert.deepEqual(phases.map((entry) => entry.phase), [
      'context', 'generating', 'validating', 'applying', 'done'
    ]);
    assert.equal(result.applied, 1);
    assert.equal(getCastRoster(database, userId, conversationId).npcs[0].relationship, 'ally');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].settings.model, 'current-chat-model');
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.tools, undefined);
    assert.equal(calls[0].options.executeTool, undefined);
    assert.match(calls[0].messages[1].content, /Normalize the relationship/);
    const organizerPayload = JSON.parse(calls[0].messages[1].content);
    assert.equal(organizerPayload.contract.name, 'CastChangePlanV1');
    assert.equal(organizerPayload.contract.jsonSchema.properties.operations.maxItems, 80);
  } finally {
    database.close();
  }
});

test('conversation-wide cast organization can create members through the shared plan service', async () => {
  const fixture = createFixture();
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    const result = await organizeConversationCast({
      database: fixture.database,
      userId: fixture.userId,
      conversationId: fixture.conversationId,
      settings: { model: 'current-chat-model' },
      scope: 'conversation',
      messages: [],
      generate: async (_settings, _messages, options) => {
        assert.equal(options.maxTokens, 12_000);
        assert.equal(options.timeoutMs, 120_000);
        return {
          content: JSON.stringify({
            version: 1,
            operations: [{
              op: 'member.create',
              target: { name: 'Bob' },
              changes: { relationship: 'merchant' },
            }],
          }),
        };
      },
    });
    assert.equal(result.applied, 1);
    assert.equal(getCastRoster(fixture.database, fixture.userId, fixture.conversationId).npcs[0].canonicalName, 'Bob');
  } finally {
    fixture.database.close();
  }
});

test('cast organizer stops before generation when cancelled and classifies timeouts', async () => {
  const fixture = createFixture();
  try {
    ensureConversationProtagonist(fixture.database, fixture.userId, fixture.conversationId);
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await assert.rejects(
      organizeConversationCast({
        database: fixture.database,
        userId: fixture.userId,
        conversationId: fixture.conversationId,
        settings: { model: 'current-chat-model' },
        scope: 'conversation',
        signal: controller.signal,
        generate: async () => {
          calls += 1;
          return { content: '{"version":1,"operations":[]}' };
        },
      }),
      (error) => error.code === 'CAST_ORGANIZE_ABORTED'
    );
    assert.equal(calls, 0);

    await assert.rejects(
      organizeConversationCast({
        database: fixture.database,
        userId: fixture.userId,
        conversationId: fixture.conversationId,
        settings: { model: 'current-chat-model' },
        scope: 'conversation',
        generate: async () => {
          throw new DOMException('Provider timed out', 'TimeoutError');
        },
      }),
      (error) => error.code === 'CAST_ORGANIZE_TIMEOUT'
    );
  } finally {
    fixture.database.close();
  }
});

function createFixture(options = {}) {
  const database = createAppDatabase(':memory:');
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = `user-auto-${Math.random()}`;
  const characterId = `character-auto-${Math.random()}`;
  const conversationId = `conversation-auto-${Math.random()}`;
  const settings = { castTracking: { enabled: options.castTracking === true } };
  database.prepare(
    `INSERT INTO users (id, username, password_hash, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, userId, 'hash', timestamp);
  database.prepare(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(characterId, userId, 'Hero', timestamp, timestamp);
  database.prepare(
    `INSERT INTO conversations (
       id, user_id, character_id, title, user_advanced_settings, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, 'Automation test', JSON.stringify(settings), timestamp, timestamp);
  return {
    database,
    userId,
    characterId,
    conversationId,
    conversation: { id: conversationId, characterId, settings },
  };
}

function insertMessage(database, fixture, message) {
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    message.id,
    fixture.userId,
    fixture.conversationId,
    message.role,
    message.content,
    '2025-01-01T00:01:00.000Z'
  );
  return { ...message };
}
