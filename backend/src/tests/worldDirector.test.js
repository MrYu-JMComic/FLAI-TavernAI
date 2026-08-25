import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-world-director';

const { createAppDatabase } = await import('../db.js');
const { executeWorldDirectorProposal } = await import('../services/accessoryAgents.js');
const { getWorldClock } = await import('../modules/dynamicWorld.js');
const { listQuests } = await import('../modules/quests.js');
const { listSkillChecks } = await import('../modules/skillChecks.js');
const { upsertSceneNode, upsertSceneRoute } = await import('../modules/scenes.js');
const { getTravelMap } = await import('../modules/travel.js');
const { listWorldEvents } = await import('../modules/worldEvents.js');
const { newId, nowIso } = await import('../security.js');

function setupTestEnv() {
  const db = createAppDatabase(':memory:');
  const userId = 'director-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'director-user', 'hash', timestamp);
  db.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  db.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(conversationId, userId, characterId, '导演测试', timestamp, timestamp);
  return { db, userId, conversationId, character: { id: characterId, name: '旅者' } };
}

test('world director proposals only mutate through validated rule modules', async () => {
  const env = setupTestEnv();
  const executions = [];
  await executeWorldDirectorProposal({ ...env, toolName: 'create_quest', args: { title: '调查钟声', objectives: [{ description: '找到钟楼入口' }] }, executions });
  await executeWorldDirectorProposal({ ...env, toolName: 'advance_world_time', args: { minutes: 30 }, executions });
  await executeWorldDirectorProposal({ ...env, toolName: 'set_world_weather', args: { weather: '浓雾' }, executions });
  await executeWorldDirectorProposal({ ...env, toolName: 'request_skill_check', args: { skill: '观察', difficulty: 10, roll: 99, outcome: 'critical_success' }, executions });

  assert.equal(executions.every(item => item.ok), true);
  assert.equal(listQuests(env.db, env.userId, env.conversationId)[0].title, '调查钟声');
  assert.equal(getWorldClock(env.db, env.userId, env.conversationId).minuteOfDay, 510);
  assert.equal(getWorldClock(env.db, env.userId, env.conversationId).weather, '浓雾');
  const check = listSkillChecks(env.db, env.userId, env.conversationId)[0];
  assert.ok(check.roll >= 1 && check.roll <= 20);
  assert.notEqual(check.roll, 99);
  env.db.close();
});

test('world director travel proposals obey the HUD feature switch and direct routes', async () => {
  const env = setupTestEnv();
  const start = upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'building', name: '酒馆' });
  const middle = upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'area', name: '广场' });
  const current = upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'building', name: '钟楼' });
  upsertSceneRoute(env.db, env.userId, env.conversationId, { fromNodeId: current.id, toNodeId: middle.id, bidirectional: true });
  upsertSceneRoute(env.db, env.userId, env.conversationId, { fromNodeId: middle.id, toNodeId: start.id, bidirectional: true });
  assert.equal(getTravelMap(env.db, env.userId, env.conversationId).currentNode.id, current.id);
  const disabled = await executeWorldDirectorProposal({ ...env, toolName: 'travel_to_location', args: { destinationNodeId: middle.id } });
  assert.equal(disabled.ok, false);
  assert.match(disabled.error, /已关闭/);
  const teleport = await executeWorldDirectorProposal({ ...env, toolName: 'travel_to_location', args: { destinationNodeId: start.id }, travelEnabled: true });
  assert.equal(teleport.ok, false);
  assert.match(teleport.error, /不可从当前位置直接到达/);
  const traveled = await executeWorldDirectorProposal({ ...env, toolName: 'travel_to_location', args: { destinationNodeId: middle.id }, travelEnabled: true });
  assert.equal(traveled.ok, true);
  assert.equal(getTravelMap(env.db, env.userId, env.conversationId).currentNode.id, middle.id);
  env.db.close();
});

test('world director can only propose bounded rewards for confirmed completed sources', async () => {
  const env = setupTestEnv();
  const quest = listQuests(env.db, env.userId, env.conversationId);
  assert.deepEqual(quest, []);
  const createdQuest = await executeWorldDirectorProposal({ ...env, toolName: 'create_quest', args: { title: '完成委托', objectives: [{ description: '交付' }] } });
  const questId = createdQuest.result.id;
  const objectiveId = createdQuest.result.objectives[0].id;
  await executeWorldDirectorProposal({ ...env, toolName: 'advance_quest_objective', args: { questId, objectiveId, delta: 1 } });
  const disabled = await executeWorldDirectorProposal({ ...env, toolName: 'propose_reward', args: { sourceType: 'quest', sourceId: questId, rewards: { growthPoints: 5 } } });
  assert.equal(disabled.ok, false);
  assert.match(disabled.error, /已关闭/);
  const proposed = await executeWorldDirectorProposal({ ...env, toolName: 'propose_reward', args: { sourceType: 'quest', sourceId: questId, rewards: { currency: [{ currencyType: 'gold', amount: 8 }], growthPoints: 2 } }, rewardEnabled: true });
  assert.equal(proposed.ok, true);
  const duplicate = await executeWorldDirectorProposal({ ...env, toolName: 'propose_reward', args: { sourceType: 'quest', sourceId: questId, rewards: { currency: [{ currencyType: 'gold', amount: 999999 }] } }, rewardEnabled: true });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.result.id, proposed.result.id);
  env.db.close();
});
