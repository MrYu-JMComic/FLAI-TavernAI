import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-world-director';

const { createAppDatabase } = await import('../db.js');
const { executeWorldDirectorProposal } = await import('../services/accessoryAgents.js');
const { getWorldClock } = await import('../modules/dynamicWorld.js');
const { listQuests } = await import('../modules/quests.js');
const { listSkillChecks } = await import('../modules/skillChecks.js');
const { updateConversationNpc } = await import('../modules/npcs.js');
const { upsertSceneNode, upsertSceneRoute } = await import('../modules/scenes.js');
const { getTravelMap } = await import('../modules/travel.js');
const { getActiveEncounter } = await import('../modules/encounters.js');
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

test('world director cannot bypass routes or terminal NPC rules and records rejection diagnostics', async () => {
  const env = setupTestEnv();
  const start = upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'building', name: '酒馆' });
  const target = upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'building', name: '钟楼' });
  updateConversationNpc(env.db, env.userId, env.conversationId, '莉娅', { currentLocation: start.name, status: 'active' });
  const executions = [];
  const rejected = await executeWorldDirectorProposal({ ...env, toolName: 'schedule_npc_activity', args: { npcName: '莉娅', title: '敲钟', locationNodeId: target.id, durationMinutes: 60 }, executions });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /没有可用路线/);
  updateConversationNpc(env.db, env.userId, env.conversationId, '莉娅', { currentLocation: start.name, status: 'dead' });
  const terminal = await executeWorldDirectorProposal({ ...env, toolName: 'schedule_npc_activity', args: { npcName: '莉娅', title: '巡逻', locationNodeId: start.id }, executions });
  assert.equal(terminal.ok, false);
  assert.match(terminal.error, /终止状态/);
  const rejectedEvents = listWorldEvents(env.db, env.userId, env.conversationId, { eventType: 'director.action.rejected' });
  assert.equal(rejectedEvents.events.length, 2);
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

test('world director encounter tools are gated and cannot forge rolls or skip turns', async () => {
  const env = setupTestEnv();
  upsertSceneNode(env.db, env.userId, env.conversationId, { nodeType: 'building', name: '酒馆' });
  updateConversationNpc(env.db, env.userId, env.conversationId, '强盗', { currentLocation: '酒馆', status: 'active' });
  const disabled = await executeWorldDirectorProposal({ ...env, toolName: 'create_encounter', args: { npcNames: ['强盗'] } });
  assert.equal(disabled.ok, false);
  assert.match(disabled.error, /已关闭/);
  const created = await executeWorldDirectorProposal({ ...env, toolName: 'create_encounter', args: { title: '伏击', npcNames: ['强盗'] }, encounterEnabled: true });
  assert.equal(created.ok, true);
  const encounter = getActiveEncounter(env.db, env.userId, env.conversationId);
  const wrongActor = encounter.participants.find(item => item.id !== encounter.currentActor.id);
  const skipped = await executeWorldDirectorProposal({ ...env, toolName: 'perform_encounter_action', args: { encounterId: encounter.id, actorId: wrongActor.id, actionType: 'defend' }, encounterEnabled: true });
  assert.equal(skipped.ok, false);
  assert.match(skipped.error, /尚未轮到/);
  const target = encounter.participants.find(item => item.actorType !== encounter.currentActor.actorType);
  const acted = await executeWorldDirectorProposal({ ...env, toolName: 'perform_encounter_action', args: { encounterId: encounter.id, actorId: encounter.currentActor.id, targetId: target.id, actionType: 'attack', roll: 99, damage: 999 }, encounterEnabled: true });
  assert.equal(acted.ok, true);
  assert.ok(acted.result.action.check.roll >= 1 && acted.result.action.check.roll <= 20);
  assert.notEqual(acted.result.action.check.roll, 99);
  assert.ok(acted.result.action.damage >= 0 && acted.result.action.damage <= 12);
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
