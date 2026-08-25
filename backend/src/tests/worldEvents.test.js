import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-world-events';

const { createAppDatabase } = await import('../db.js');
const { recordWorldEvent, listWorldEvents, deleteConversationWorldEvents } = await import('../modules/worldEvents.js');
const { createConversationTransaction } = await import('../modules/economy.js');
const { upsertSceneNode } = await import('../modules/scenes.js');
const { upsertStatusBar } = await import('../modules/statusBars.js');
const { newId, nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'world-event-user';
  const otherUserId = 'world-event-other';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'event-user', 'hash', timestamp);
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(otherUserId, 'event-other', 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(characterId, userId, '记录者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, characterId, '事件测试', timestamp, timestamp);
  return { database, userId, otherUserId, conversationId };
}

test('world events are isolated, normalized and support incremental cursors', () => {
  const { database, userId, otherUserId, conversationId } = setupTestEnv();
  const first = recordWorldEvent(database, userId, conversationId, {
    eventType: 'scene.entered',
    source: 'player',
    title: '进入旧酒馆',
    entityType: 'scene',
    entityId: 'scene-1',
    payload: { location: '旧酒馆' }
  });
  const second = recordWorldEvent(database, userId, conversationId, {
    eventType: 'cast.relationship.changed',
    source: 'agent',
    title: '莉娅更加信任你',
    severity: 'success'
  });

  assert.ok(first.cursor > 0);
  assert.ok(second.cursor > first.cursor);
  assert.equal(recordWorldEvent(database, otherUserId, conversationId, { title: '越权事件' }), null);
  assert.equal(listWorldEvents(database, otherUserId, conversationId), null);

  const newest = listWorldEvents(database, userId, conversationId, { limit: 1 });
  assert.equal(newest.events[0].id, second.id);
  assert.equal(newest.hasMore, true);
  assert.equal(newest.latestCursor, second.cursor);

  const incremental = listWorldEvents(database, userId, conversationId, { afterCursor: first.cursor });
  assert.deepEqual(incremental.events.map(event => event.id), [second.id]);
  assert.equal(incremental.nextCursor, second.cursor);

  assert.deepEqual(deleteConversationWorldEvents(database, userId, conversationId), { deleted: 2 });
  assert.deepEqual(listWorldEvents(database, userId, conversationId).events, []);
  database.close();
});

test('world event ledger receives key gameplay mutations', () => {
  const { database, userId, conversationId } = setupTestEnv();
  upsertSceneNode(database, userId, conversationId, { nodeType: 'room', name: '钟楼大厅', auditActor: 'agent' });
  upsertStatusBar(database, userId, conversationId, { name: '旅者状态', variables: [{ name: '时间', value: '午夜' }], auditActor: 'agent' });
  createConversationTransaction(database, userId, conversationId, { type: 'reward', amount: 5, description: '守钟人的报酬', auditActor: 'agent' });

  const page = listWorldEvents(database, userId, conversationId, { limit: 100 });
  const types = new Set(page.events.map(event => event.eventType));
  assert.ok(types.has('scene.location.discovered'));
  assert.ok(types.has('status.created'));
  assert.ok(types.has('economy.transaction.created'));
  database.close();
});
