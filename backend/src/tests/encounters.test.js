import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-encounters';

const { createAppDatabase } = await import('../db.js');
const { createEncounter, endEncounter, getActiveEncounter, performEncounterAction } = await import('../modules/encounters.js');
const { updateConversationNpc } = await import('../modules/npcs.js');
const { upsertSceneNode } = await import('../modules/scenes.js');
const { listSkillChecks } = await import('../modules/skillChecks.js');
const { newId, nowIso } = await import('../security.js');

function setup() {
  const database = createAppDatabase(':memory:');
  const userId = 'encounter-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(conversationId, userId, characterId, '遭遇测试', timestamp, timestamp);
  upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '酒馆' });
  updateConversationNpc(database, userId, conversationId, '强盗', { currentLocation: '酒馆', status: 'active' });
  return { database, userId, conversationId };
}

test('encounter enforces initiative turns and server-side checks and damage', () => {
  const env = setup();
  const created = createEncounter(env.database, env.userId, env.conversationId, { playerName: '旅者', npcNames: ['强盗'] }, { initiativeRolls: [20, 10] });
  assert.equal(created.ok, true);
  const encounter = created.encounter;
  const player = encounter.participants.find(item => item.actorType === 'player');
  const npc = encounter.participants.find(item => item.actorType === 'npc');
  assert.equal(encounter.currentActor.id, player.id);
  assert.equal(performEncounterAction(env.database, env.userId, env.conversationId, encounter.id, { actorId: npc.id, targetId: player.id, actionType: 'attack' }).ok, false);
  const acted = performEncounterAction(env.database, env.userId, env.conversationId, encounter.id, { actorId: player.id, targetId: npc.id, actionType: 'attack', roll: 99, damage: 999 }, { roll: 20, damageRoll: 6, bonusDamageRoll: 6 });
  assert.equal(acted.ok, true);
  assert.equal(acted.action.damage, 12);
  assert.equal(acted.encounter.status, 'completed');
  assert.equal(acted.encounter.outcome, 'victory');
  const check = listSkillChecks(env.database, env.userId, env.conversationId)[0];
  assert.equal(check.roll, 20);
  assert.notEqual(check.roll, 99);
  env.database.close();
});

test('encounter rejects terminal NPCs, duplicate active encounters, and post-end actions', () => {
  const env = setup();
  updateConversationNpc(env.database, env.userId, env.conversationId, '幽灵', { currentLocation: '酒馆', status: 'dead' });
  assert.match(createEncounter(env.database, env.userId, env.conversationId, { playerName: '旅者', npcNames: ['幽灵'] }).error, /终止状态/);
  const created = createEncounter(env.database, env.userId, env.conversationId, { playerName: '旅者', npcNames: ['强盗'] }, { initiativeRolls: [20, 10] });
  assert.match(createEncounter(env.database, env.userId, env.conversationId, { playerName: '旅者', npcNames: ['强盗'] }).error, /已有进行中/);
  const ended = endEncounter(env.database, env.userId, env.conversationId, created.encounter.id);
  assert.equal(ended.status, 'completed');
  assert.equal(getActiveEncounter(env.database, env.userId, env.conversationId), null);
  const player = ended.participants.find(item => item.actorType === 'player');
  assert.match(performEncounterAction(env.database, env.userId, env.conversationId, ended.id, { actorId: player.id, actionType: 'defend' }).error, /已结束/);
  env.database.close();
});
