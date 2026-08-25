import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-travel';

const { createAppDatabase } = await import('../db.js');
const { upsertSceneNode, upsertSceneRoute } = await import('../modules/scenes.js');
const { getTravelMap, travelToNode } = await import('../modules/travel.js');
const { getWorldClock } = await import('../modules/dynamicWorld.js');
const { listWorldEvents } = await import('../modules/worldEvents.js');
const { newId, nowIso } = await import('../security.js');

function setup() {
  const database = createAppDatabase(':memory:');
  const userId = 'travel-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(conversationId, userId, characterId, '旅行测试', timestamp, timestamp);
  const tavern = upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '酒馆' });
  const square = upsertSceneNode(database, userId, conversationId, { nodeType: 'area', name: '广场' });
  const tower = upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '钟楼' });
  return { database, userId, conversationId, tavern, square, tower };
}

test('player travel only follows direct routes and advances trusted world time', () => {
  const env = setup();
  upsertSceneRoute(env.database, env.userId, env.conversationId, { fromNodeId: env.tavern.id, toNodeId: env.square.id, bidirectional: true });
  upsertSceneRoute(env.database, env.userId, env.conversationId, { fromNodeId: env.square.id, toNodeId: env.tower.id, bidirectional: true });
  const before = getWorldClock(env.database, env.userId, env.conversationId);
  const map = getTravelMap(env.database, env.userId, env.conversationId);
  assert.equal(map.currentNode.id, env.tower.id);
  assert.deepEqual(map.availableRoutes.map(route => route.destination.name), ['广场']);
  assert.equal(travelToNode(env.database, env.userId, env.conversationId, { destinationNodeId: env.tavern.id }).ok, false);
  const result = travelToNode(env.database, env.userId, env.conversationId, { destinationNodeId: env.square.id });
  assert.equal(result.ok, true);
  assert.equal(result.map.currentNode.id, env.square.id);
  assert.equal(result.advance.clock.tick, before.tick + result.route.minutes);
  const eventTypes = new Set(listWorldEvents(env.database, env.userId, env.conversationId, { limit: 30 }).events.map(event => event.eventType));
  assert.ok(eventTypes.has('travel.completed'));
  assert.ok(eventTypes.has('world.time.advanced'));
  env.database.close();
});

test('travel state and discoveries are conversation-owned', () => {
  const env = setup();
  assert.equal(getTravelMap(env.database, 'other-user', env.conversationId), null);
  assert.equal(travelToNode(env.database, 'other-user', env.conversationId, { destinationNodeId: env.square.id }).error, '对话不存在');
  env.database.close();
});
