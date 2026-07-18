import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-dynamic-world';

const { createAppDatabase } = await import('../db.js');
const { advanceWorldTime, getWorldClock, listNpcActivities, scheduleNpcActivity, setWorldWeather } = await import('../modules/dynamicWorld.js');
const { listConversationNpcs, updateConversationNpc } = await import('../modules/npcs.js');
const { upsertSceneNode, upsertSceneRoute } = await import('../modules/scenes.js');
const { listWorldEvents } = await import('../modules/worldEvents.js');
const { newId, nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'dynamic-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'dynamic-user', 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(conversationId, userId, characterId, '动态世界', timestamp, timestamp);
  const tavern = upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '酒馆' });
  const square = upsertSceneNode(database, userId, conversationId, { nodeType: 'area', name: '广场' });
  const tower = upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '钟楼' });
  updateConversationNpc(database, userId, conversationId, '莉娅', { currentLocation: '酒馆', status: 'active' });
  return { database, userId, conversationId, tavern, square, tower };
}

test('dynamic world rejects teleport and conflicts, then moves NPC through a valid route', () => {
  const { database, userId, conversationId, tavern, square, tower } = setupTestEnv();
  assert.equal(scheduleNpcActivity(database, userId, conversationId, { npcName: '莉娅', title: '敲钟', locationNodeId: tower.id }).ok, false);
  upsertSceneRoute(database, userId, conversationId, { fromNodeId: tavern.id, toNodeId: square.id, bidirectional: true });
  upsertSceneRoute(database, userId, conversationId, { fromNodeId: square.id, toNodeId: tower.id, bidirectional: true });
  const scheduled = scheduleNpcActivity(database, userId, conversationId, { npcName: '莉娅', title: '敲钟', locationNodeId: tower.id, durationMinutes: 30 });
  assert.equal(scheduled.ok, true);
  assert.equal(scheduleNpcActivity(database, userId, conversationId, { npcName: '莉娅', title: '巡逻', locationNodeId: square.id, durationMinutes: 20 }).ok, false);
  const advanced = advanceWorldTime(database, userId, conversationId, { minutes: 60 });
  assert.deepEqual(advanced.summary.started, [scheduled.activity.id]);
  assert.deepEqual(advanced.summary.completed, [scheduled.activity.id]);
  assert.equal(listConversationNpcs(database, userId, conversationId, '旅者')[0].currentLocation, '钟楼');
  assert.equal(listNpcActivities(database, userId, conversationId)[0].status, 'completed');
  database.close();
});

test('dynamic world advances across days, updates weather, and blocks terminal NPC activity', () => {
  const { database, userId, conversationId, tavern } = setupTestEnv();
  const clock = getWorldClock(database, userId, conversationId);
  assert.equal(clock.timeLabel, '08:00');
  assert.equal(setWorldWeather(database, userId, conversationId, '小雨').weather, '小雨');
  const result = advanceWorldTime(database, userId, conversationId, { minutes: 1440 });
  assert.equal(result.clock.currentDay, 2);
  assert.equal(result.clock.timeLabel, '08:00');
  updateConversationNpc(database, userId, conversationId, '莉娅', { status: 'dead', currentLocation: '酒馆' });
  assert.equal(scheduleNpcActivity(database, userId, conversationId, { npcName: '莉娅', title: '幽灵巡逻', locationNodeId: tavern.id }).ok, false);
  const eventTypes = new Set(listWorldEvents(database, userId, conversationId, { limit: 30 }).events.map(event => event.eventType));
  assert.ok(eventTypes.has('world.weather.changed'));
  assert.ok(eventTypes.has('world.time.advanced'));
  database.close();
});
