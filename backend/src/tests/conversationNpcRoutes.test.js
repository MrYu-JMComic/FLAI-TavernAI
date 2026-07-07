import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-conversation-npc-routes';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createConversationsRouter } = await import('../routes/conversations.js');
const { hasUsableProvider } = await import('../services/providers.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('conversation NPC routes expose profile audit and rollback', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'npc-route-user';
  const conversationId = 'npc-route-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'NPC Route Character', visibility: 'private' });
  insertConversation(database, userId, character.id, conversationId);

  const app = createNpcRouteApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentLocation: 'Library', relationship: 'Trusts the party' })
    });
    assert.equal(firstResponse.status, 200);

    const secondResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentLocation: 'Hall', relationship: 'Angry about the missing tome', aliases: ['Archivist'] })
    });
    assert.equal(secondResponse.status, 200);

    const auditResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC/audit`);
    const audit = await auditResponse.json();
    assert.equal(auditResponse.status, 200);
    assert.equal(audit.length, 2);
    assert.equal(audit[0].action, 'update');
    assert.equal(audit[0].actor, 'manual');
    assert.equal(audit[0].before.currentLocation, 'Library');
    assert.equal(audit[0].before.relationship, 'Trusts the party');
    assert.equal(audit[0].after.currentLocation, 'Hall');
    assert.equal(audit[0].after.relationship, 'Angry about the missing tome');

    const rollbackResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC/audit/${audit[0].id}/rollback`, {
      method: 'POST'
    });
    const rollback = await rollbackResponse.json();
    assert.equal(rollbackResponse.status, 200);
    assert.equal(rollback.rolledBack, true);
    assert.equal(rollback.npc.currentLocation, 'Library');
    assert.equal(rollback.npc.relationship, 'Trusts the party');
    assert.deepEqual(rollback.npc.aliases, []);

    const rollbackAuditResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC/audit`);
    const rollbackAudit = await rollbackAuditResponse.json();
    assert.equal(rollbackAudit[0].action, 'rollback');
    assert.equal(rollbackAudit[0].after.currentLocation, 'Library');
    assert.equal(rollbackAudit[0].after.relationship, 'Trusts the party');
  });
});

test('conversation NPC audit routes include memory and behavior rollback', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'npc-route-item-user';
  const conversationId = 'npc-route-item-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'NPC Route Item Character', visibility: 'private' });
  insertConversation(database, userId, character.id, conversationId);

  const app = createNpcRouteApp(database, userId);

  await withServer(app, async (baseUrl) => {
    const memoryCreateResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'first memory' })
    });
    const memory = await memoryCreateResponse.json();
    assert.equal(memoryCreateResponse.status, 201);

    const memoryUpdateResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/memories/${memory.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'changed memory' })
    });
    assert.equal(memoryUpdateResponse.status, 200);

    let auditResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/audit`);
    let audit = await auditResponse.json();
    assert.equal(audit[0].targetType, 'memory');
    assert.equal(audit[0].action, 'update');

    const memoryRollbackResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/audit/${audit[0].id}/rollback`, {
      method: 'POST'
    });
    const memoryRollback = await memoryRollbackResponse.json();
    assert.equal(memoryRollbackResponse.status, 200);
    assert.equal(memoryRollback.targetType, 'memory');
    assert.equal(memoryRollback.memory.content, 'first memory');

    const behaviorCreateResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/behaviors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'watch the stairway', priority: 12 })
    });
    const behavior = await behaviorCreateResponse.json();
    assert.equal(behaviorCreateResponse.status, 201);

    const behaviorDeleteResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/behaviors/${behavior.id}`, {
      method: 'DELETE'
    });
    assert.equal(behaviorDeleteResponse.status, 200);

    auditResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/audit`);
    audit = await auditResponse.json();
    assert.equal(audit[0].targetType, 'behavior');
    assert.equal(audit[0].action, 'delete');

    const behaviorRollbackResponse = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Item%20NPC/audit/${audit[0].id}/rollback`, {
      method: 'POST'
    });
    const behaviorRollback = await behaviorRollbackResponse.json();
    assert.equal(behaviorRollbackResponse.status, 200);
    assert.equal(behaviorRollback.targetType, 'behavior');
    assert.equal(behaviorRollback.behavior.action, 'watch the stairway');
  });
});

test('conversation NPC audit routes respect conversation ownership', async () => {
  const database = createAppDatabase(':memory:');
  const userId = 'npc-route-owner';
  const otherUserId = 'npc-route-other';
  const conversationId = 'npc-route-owned-conversation';
  insertUser(database, userId);
  insertUser(database, otherUserId);
  const character = createCharacter(database, userId, { name: 'NPC Route Owner Character', visibility: 'private' });
  insertConversation(database, userId, character.id, conversationId);

  const app = createNpcRouteApp(database, otherUserId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/conversations/${conversationId}/npcs/Route%20NPC/audit`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, '对话不存在');
  });
});

function createNpcRouteApp(database, userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', createConversationsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    newId: createSequentialId('npc-route'),
    nowIso: () => new Date().toISOString(),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    providerWithSecret: (row) => row,
    getProviderRow: () => null,
    hasUsableProvider
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}

function createSequentialId(prefix) {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

function insertConversation(database, userId, characterId, conversationId) {
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, 'NPC Route Test', timestamp, timestamp);
}
