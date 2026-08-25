import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createConversationCastRouter } from '../routes/conversationCast.js';
import { ensureConversationProtagonist } from '../services/cast/castCommandService.js';
import {
  clearCastSyncStatusForTests,
  publishCastSyncStatus,
} from '../services/cast/castSyncStatus.js';
import { withServer } from './routeTestUtils.js';

test('cast routes provide strict CRUD, audit rollback, and optimistic conflicts', async () => {
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'owner', 'conversation-owner');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  const app = createCastRoutesApp(database, owner.userId);

  try {
    await withServer(app, async (baseUrl) => {
      const initial = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`);
      assert.equal(initial.response.status, 200);
      assert.equal(initial.body.protagonist.canonicalName, 'Hero owner');
      assert.deepEqual(initial.body.npcs, []);

      const rejected = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Alice', actor: 'injected' },
      });
      assert.equal(rejected.response.status, 400);
      assert.match(rejected.body.error, /Unrecognized key|actor/i);

      const created = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Alice', aliases: ['Al'], currentLocationLabel: 'Inn' },
      });
      assert.equal(created.response.status, 201);
      assert.equal(created.body.canonicalName, 'Alice');
      assert.deepEqual(created.body.aliases, ['Al']);

      const stale = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}`,
        { method: 'PATCH', body: { relationship: 'ally', revision: created.body.revision + 1 } }
      );
      assert.equal(stale.response.status, 409);
      assert.equal(stale.body.code, 'CAST_CONFLICT');

      const updated = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}`,
        { method: 'PATCH', body: { relationship: 'ally', revision: created.body.revision } }
      );
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.relationship, 'ally');

      const memory = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}/memories`,
        { method: 'POST', body: { content: 'Alice keeps the map.', importance: 0.8 } }
      );
      assert.equal(memory.response.status, 201);
      assert.equal(memory.body.content, 'Alice keeps the map.');

      const wrongMemberRead = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${initial.body.protagonist.id}/memories/${memory.body.id}`
      );
      assert.equal(wrongMemberRead.response.status, 404);

      const audit = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}/audit?limit=20`
      );
      assert.equal(audit.response.status, 200);
      const profileUpdate = audit.body.items.find((event) => event.action === 'member.update');
      assert.ok(profileUpdate);

      const rollback = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/audit/${profileUpdate.id}/rollback`,
        { method: 'POST', body: {} }
      );
      assert.equal(rollback.response.status, 200);
      assert.equal(rollback.body.resource.relationship, '');

      const deleted = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}/memories/${memory.body.id}`,
        { method: 'DELETE', body: { revision: memory.body.revision } }
      );
      assert.equal(deleted.response.status, 200);
      assert.equal(deleted.body.deletedId, memory.body.id);
    });
  } finally {
    database.close();
  }
});

test('cast routes do not reveal another user conversation or child resources', async () => {
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'owner-a', 'conversation-a');
  const other = seedConversation(database, 'owner-b', 'conversation-b');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  ensureConversationProtagonist(database, other.userId, other.conversationId);
  const app = createCastRoutesApp(database, owner.userId);

  try {
    await withServer(app, async (baseUrl) => {
      const roster = await requestJson(baseUrl, `/api/conversations/${other.conversationId}/cast`);
      assert.equal(roster.response.status, 404);
      assert.equal(roster.body.code, 'CAST_NOT_FOUND');

      const create = await requestJson(baseUrl, `/api/conversations/${other.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Injected NPC' },
      });
      assert.equal(create.response.status, 404);
      assert.equal(
        database.prepare(
          "SELECT COUNT(*) AS count FROM cast_members WHERE conversation_id = ? AND member_type = 'npc'"
        ).get(other.conversationId).count,
        0
      );
    });
  } finally {
    database.close();
  }
});

test('cast organize route streams ordered progress with the current provider settings', async () => {
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'organize', 'conversation-organize');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  const currentSettings = { providerType: 'mock', model: 'current-chat-model' };
  const calls = [];
  const app = createCastRoutesApp(database, owner.userId, {
    getChatProviderSettings: () => ({ ok: true, value: currentSettings }),
    organizeConversationCast: async (options) => {
      calls.push(options);
      await options.onProgress('context', { scope: options.scope });
      await options.onProgress('generating', { memberCount: 1 });
      await options.onProgress('validating', {});
      await options.onProgress('applying', { operationCount: 0 });
      await options.onProgress('done', { applied: 0, batchId: 'batch-test' });
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/conversations/${owner.conversationId}/cast/organize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'conversation', requirement: 'Remove duplicates.' }),
      });
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.deepEqual(
        [...body.matchAll(/"phase":"([^"]+)"/g)].map((match) => match[1]),
        ['context', 'generating', 'validating', 'applying', 'done']
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].settings, currentSettings);
      assert.equal(calls[0].scope, 'conversation');
      assert.equal(calls[0].requirement, 'Remove duplicates.');
      assert.equal(calls[0].signal.aborted, false);
    });
  } finally {
    database.close();
  }
});

test('cast routes cover profile, location, memory, behavior, appearance, and cast-owned items', async () => {
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'full-api', 'conversation-full-api');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  const app = createCastRoutesApp(database, owner.userId);

  try {
    await withServer(app, async (baseUrl) => {
      const roster = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`);
      const protagonist = roster.body.protagonist;
      const created = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Alice', aliases: ['Captain Alice'] },
      });
      const alice = created.body;

      const profile = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}`
      );
      assert.equal(profile.response.status, 200);
      assert.equal(profile.body.member.canonicalName, 'Alice');

      const updated = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}`,
        {
          method: 'PATCH',
          body: {
            relationship: 'trusted ally',
            currentLocationLabel: 'North Gate',
            revision: alice.revision,
          },
        }
      );
      assert.equal(updated.body.relationship, 'trusted ally');
      assert.equal(updated.body.currentLocationLabel, 'North Gate');

      const memory = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/memories`,
        { method: 'POST', body: { content: 'Alice guards the north gate.', importance: 0.7 } }
      );
      const changedMemory = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/memories/${memory.body.id}`,
        {
          method: 'PATCH',
          body: { importance: 0.9, revision: memory.body.revision },
        }
      );
      assert.equal(changedMemory.body.importance, 0.9);
      const memories = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/memories?limit=1&offset=0`
      );
      assert.equal(memories.body.limit, 1);
      assert.equal(memories.body.total, 1);

      const behavior = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/behaviors`,
        {
          method: 'POST',
          body: { triggerCondition: 'The gate is threatened', action: 'Raise the alarm', priority: 5 },
        }
      );
      const changedBehavior = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/behaviors/${behavior.body.id}`,
        { method: 'PATCH', body: { enabled: false, revision: behavior.body.revision } }
      );
      assert.equal(changedBehavior.body.enabled, false);
      const behaviorList = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/behaviors`
      );
      assert.equal(behaviorList.body.length, 1);

      const appearance = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/appearance`,
        {
          method: 'PATCH',
          body: { summary: 'Alert and composed.', outfit: 'Blue watch coat.' },
        }
      );
      assert.equal(appearance.body.outfit, 'Blue watch coat.');

      const clothing = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${protagonist.id}/items`,
        {
          method: 'POST',
          body: {
            name: 'Travel cloak',
            itemKind: 'clothing',
            clothingSlot: 'outer',
            equipped: true,
            coverage: ['torso'],
          },
        }
      );
      assert.equal(clothing.response.status, 201);
      assert.equal(clothing.body.equipped, true);
      const changedClothing = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${protagonist.id}/items/${clothing.body.id}`,
        {
          method: 'PATCH',
          body: { description: 'A weatherproof cloak.', revision: clothing.body.revision },
        }
      );
      const transferred = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${protagonist.id}/items/${clothing.body.id}/transfer`,
        {
          method: 'POST',
          body: { memberId: alice.id, revision: changedClothing.body.revision },
        }
      );
      assert.equal(transferred.body.ownerMemberId, alice.id);
      const aliceItems = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/items?limit=1&offset=0`
      );
      assert.equal(aliceItems.body.length, 1);
      assert.equal(aliceItems.body[0].clothingSlot, 'outer');

      const detail = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}`
      );
      assert.equal(detail.body.appearance.summary, 'Alert and composed.');
      assert.equal(detail.body.counts.memories, 1);
      assert.equal(detail.body.counts.behaviors, 1);
      assert.equal(detail.body.counts.items, 1);

      const firstAuditPage = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/audit?limit=2`
      );
      assert.equal(firstAuditPage.body.items.length, 2);
      assert.equal(firstAuditPage.body.hasMore, true);
      const cursor = new URLSearchParams({
        limit: '2',
        beforeCreatedAt: firstAuditPage.body.nextCursor.createdAt,
        beforeId: firstAuditPage.body.nextCursor.id,
      });
      const secondAuditPage = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${alice.id}/audit?${cursor}`
      );
      assert.equal(secondAuditPage.response.status, 200);
      assert.ok(secondAuditPage.body.items.length > 0);

      const emptyNpc = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Empty Record' },
      });
      assert.equal(emptyNpc.response.status, 201);
      const cleanup = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/cleanup`,
        { method: 'POST', body: {} }
      );
      assert.equal(cleanup.body.count, 1);
      assert.deepEqual(cleanup.body.hiddenMemberIds, [emptyNpc.body.id]);
      const visibleRoster = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast?includeHidden=false`
      );
      assert.equal(visibleRoster.body.npcs.some((member) => member.id === emptyNpc.body.id), false);
    });
  } finally {
    database.close();
  }
});

test('cast routes reject unauthenticated requests and bounded or empty inputs', async () => {
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'limits', 'conversation-limits');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  const app = createCastRoutesApp(database, owner.userId);

  try {
    await withServer(app, async (baseUrl) => {
      const created = await requestJson(baseUrl, `/api/conversations/${owner.conversationId}/cast`, {
        method: 'POST',
        body: { canonicalName: 'Alice' },
      });
      const revisionOnly = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}`,
        { method: 'PATCH', body: { revision: created.body.revision } }
      );
      assert.equal(revisionOnly.response.status, 400);

      const excessivePage = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}/memories?limit=201`
      );
      assert.equal(excessivePage.response.status, 400);
      const unknownQuery = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast?unexpected=true`
      );
      assert.equal(unknownQuery.response.status, 400);
      const incompleteCursor = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${created.body.id}/audit?beforeId=event-only`
      );
      assert.equal(incompleteCursor.response.status, 400);
      const invalidId = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/${'a'.repeat(161)}`
      );
      assert.equal(invalidId.response.status, 400);
      assert.equal(invalidId.body.code, 'CAST_INVALID_ID');
      const invalidOrganize = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/organize`,
        { method: 'POST', body: { scope: 'member' } }
      );
      assert.equal(invalidOrganize.response.status, 400);
      const injectedRollback = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast/audit/event-id/rollback`,
        { method: 'POST', body: { actor: 'forged' } }
      );
      assert.equal(injectedRollback.response.status, 400);
    });

    const unauthorizedApp = createCastRoutesApp(database, owner.userId, {
      requireAuth: (_request, response) => response.status(401).json({ error: 'Unauthorized' }),
    });
    await withServer(unauthorizedApp, async (baseUrl) => {
      const unauthorized = await requestJson(
        baseUrl,
        `/api/conversations/${owner.conversationId}/cast`
      );
      assert.equal(unauthorized.response.status, 401);
    });
  } finally {
    database.close();
  }
});

test('cast sync and organization SSE endpoints emit scoped status and terminal errors', async () => {
  clearCastSyncStatusForTests();
  const database = createAppDatabase(':memory:');
  const owner = seedConversation(database, 'sse', 'conversation-sse');
  ensureConversationProtagonist(database, owner.userId, owner.conversationId);
  publishCastSyncStatus(owner.conversationId, {
    status: 'applied',
    messageId: 'message-sse',
    summary: 'Cast updated.',
    applied: 2,
  });
  const app = createCastRoutesApp(database, owner.userId, {
    getChatProviderSettings: () => ({ ok: true, value: { providerType: 'mock', model: 'current' } }),
    organizeConversationCast: async () => {
      const error = new Error('Plan rejected');
      error.code = 'CAST_PLAN_SCHEMA';
      throw error;
    },
  });

  try {
    await withServer(app, async (baseUrl) => {
      const controller = new AbortController();
      const syncResponse = await fetch(
        `${baseUrl}/api/conversations/${owner.conversationId}/cast/sync-events`,
        { signal: controller.signal }
      );
      assert.equal(syncResponse.status, 200);
      assert.match(syncResponse.headers.get('content-type'), /text\/event-stream/);
      const reader = syncResponse.body.getReader();
      const first = await reader.read();
      const firstEvent = new TextDecoder().decode(first.value);
      assert.match(firstEvent, /event: cast-sync/);
      assert.match(firstEvent, /"conversationId":"conversation-sse"/);
      assert.match(firstEvent, /"status":"applied"/);
      await reader.cancel();
      controller.abort();

      const organizeResponse = await fetch(
        `${baseUrl}/api/conversations/${owner.conversationId}/cast/organize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: 'conversation', requirement: '' }),
        }
      );
      const organizeBody = await organizeResponse.text();
      assert.equal(organizeResponse.status, 200);
      assert.match(organizeBody, /event: error/);
      assert.match(organizeBody, /"code":"CAST_PLAN_SCHEMA"/);
    });
  } finally {
    database.close();
    clearCastSyncStatusForTests();
  }
});

function createCastRoutesApp(database, userId, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations/:id', createConversationCastRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    },
    ...overrides,
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
    });
  });
  return app;
}

function seedConversation(database, suffix, conversationId) {
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = `user-${suffix}`;
  const characterId = `character-${suffix}`;
  database.prepare(
    `INSERT INTO users (id, username, password_hash, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, userId, 'hash', timestamp);
  database.prepare(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(characterId, userId, `Hero ${suffix}`, timestamp, timestamp);
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, `Conversation ${suffix}`, timestamp, timestamp);
  return { userId, characterId, conversationId };
}

async function requestJson(baseUrl, path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  return { response, body: await response.json() };
}
