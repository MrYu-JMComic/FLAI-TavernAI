import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-gameplay-dashboard';

const { createAppDatabase } = await import('../db.js');
const { getGameplayDashboard } = await import('../modules/gameplayDashboard.js');
const { getConversationAccounts } = await import('../modules/economy.js');
const { updateConversationNpc } = await import('../modules/npcs.js');
const { upsertSceneItem, upsertSceneNode } = await import('../modules/scenes.js');
const { upsertStatusBar } = await import('../modules/statusBars.js');
const { newId, nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'gameplay-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'gameplay-tester', 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, characterId, '驾驶舱测试', timestamp, timestamp);
  return { database, userId, conversationId };
}

test('gameplay dashboard aggregates scene, status, NPC and actions without creating economy accounts', () => {
  const { database, userId, conversationId } = setupTestEnv();
  const location = upsertSceneNode(database, userId, conversationId, { nodeType: 'room', name: '旧酒馆', description: '炉火仍在燃烧。' });
  upsertSceneItem(database, userId, conversationId, { nodeId: location.id, itemCode: 'itm-key', name: '黄铜钥匙', ownerType: 'protagonist', quantity: 2 });
  updateConversationNpc(database, userId, conversationId, '莉娅', {
    status: 'active',
    currentLocation: '旧酒馆',
    relationship: '信任'
  });
  upsertStatusBar(database, userId, conversationId, {
    name: '旅者状态',
    variables: [
      { name: '时间', value: '夜晚' },
      { name: '天气', value: '小雨' },
      { name: '生命', value: 82, max: 100, color: '#b64d45' },
      { name: '精力', value: 61, max: 100, color: '#d39a3a' }
    ]
  });

  const dashboard = getGameplayDashboard(database, userId, conversationId, { mainCharacterName: '旅者' });

  assert.equal(dashboard.location.name, '旧酒馆');
  assert.equal(dashboard.time, '第 1 天 08:00');
  assert.equal(dashboard.weather, '晴朗');
  assert.equal(dashboard.worldClock.tick, 480);
  assert.equal(dashboard.presentNpcs[0].name, '莉娅');
  assert.equal(dashboard.counts.locations, 1);
  assert.equal(dashboard.counts.npcs, 1);
  assert.equal(dashboard.backpack.totalKinds, 1);
  assert.equal(dashboard.backpack.totalQuantity, 2);
  assert.equal(dashboard.checkActions[0].skill, '观察');
  assert.deepEqual(dashboard.coreStatus.map(item => item.name), ['生命', '精力']);
  assert.deepEqual(dashboard.quickActions.map(item => item.key), ['observe', 'talk', 'investigate', 'move']);
  assert.ok(dashboard.worldEvents.some(event => event.eventType === 'status.created'));
  assert.ok(dashboard.eventCursor > 0);
  assert.deepEqual(getConversationAccounts(database, userId, conversationId), []);
  database.close();
});
