import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-gameplay-progression';

const { createAppDatabase } = await import('../db.js');
const { createQuest, listQuests, updateQuestObjective } = await import('../modules/quests.js');
const { listSkillChecks, performSkillCheck } = await import('../modules/skillChecks.js');
const { listWorldEvents } = await import('../modules/worldEvents.js');
const { newId, nowIso } = await import('../security.js');

function setupTestEnv() {
  const database = createAppDatabase(':memory:');
  const userId = 'progress-user';
  const otherUserId = 'progress-other';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, 'progress-user', 'hash', timestamp);
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(otherUserId, 'progress-other', 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(characterId, userId, '冒险者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, characterId, '任务测试', timestamp, timestamp);
  return { database, userId, otherUserId, conversationId };
}

test('quest objectives advance and automatically complete their quest', () => {
  const { database, userId, otherUserId, conversationId } = setupTestEnv();
  const quest = createQuest(database, userId, conversationId, {
    title: '修复钟楼', description: '找回缺失的齿轮。', source: 'agent',
    objectives: [{ description: '收集齿轮', targetValue: 2 }]
  });
  assert.equal(quest.status, 'active');
  assert.equal(listQuests(database, otherUserId, conversationId), null);

  const objective = updateQuestObjective(database, userId, conversationId, quest.id, quest.objectives[0].id, { currentValue: 2, source: 'player' });
  assert.equal(objective.status, 'completed');
  const completed = listQuests(database, userId, conversationId)[0];
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);

  const eventTypes = new Set(listWorldEvents(database, userId, conversationId, { limit: 20 }).events.map(event => event.eventType));
  assert.ok(eventTypes.has('quest.created'));
  assert.ok(eventTypes.has('quest.objective.completed'));
  assert.ok(eventTypes.has('quest.completed'));
  database.close();
});

test('skill checks use server roll input only and persist critical outcomes', () => {
  const { database, userId, otherUserId, conversationId } = setupTestEnv();
  const success = performSkillCheck(database, userId, conversationId, { skill: '观察', difficulty: 30, modifier: -5, roll: 1, context: '检查钟楼' }, { roll: 20 });
  assert.equal(success.roll, 20);
  assert.equal(success.outcome, 'critical_success');
  const failure = performSkillCheck(database, userId, conversationId, { skill: '潜行', difficulty: 2, modifier: 20, roll: 20 }, { roll: 1 });
  assert.equal(failure.roll, 1);
  assert.equal(failure.outcome, 'critical_failure');
  assert.equal(performSkillCheck(database, otherUserId, conversationId, { skill: '越权' }), null);
  assert.deepEqual(listSkillChecks(database, userId, conversationId).map(check => check.id), [failure.id, success.id]);
  database.close();
});
