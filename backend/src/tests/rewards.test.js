import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-rewards';

const { createAppDatabase } = await import('../db.js');
const { createQuest, updateQuestObjective } = await import('../modules/quests.js');
const { claimRewardGrant, getCharacterGrowth, proposeRewardGrant } = await import('../modules/rewards.js');
const { getConversationAccounts } = await import('../modules/economy.js');
const { listActorItems, upsertSceneItem, upsertSceneNode } = await import('../modules/scenes.js');
const { newId, nowIso } = await import('../security.js');

function setup() {
  const database = createAppDatabase(':memory:');
  const userId = 'reward-user';
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(conversationId, userId, characterId, '奖励测试', timestamp, timestamp);
  const node = upsertSceneNode(database, userId, conversationId, { nodeType: 'building', name: '酒馆' });
  const quest = createQuest(database, userId, conversationId, { title: '清理酒馆', objectives: [{ description: '完成委托' }] });
  updateQuestObjective(database, userId, conversationId, quest.id, quest.objectives[0].id, { currentValue: 1 });
  return { database, userId, characterId, conversationId, node, quest };
}

test('reward claims atomically settle currency, unique items, growth and stay idempotent', () => {
  const env = setup();
  const proposed = proposeRewardGrant(env.database, env.userId, env.conversationId, {
    sourceType: 'quest', sourceId: env.quest.id, title: '酒馆谢礼',
    rewards: { currency: [{ currencyType: 'gold', amount: 10 }], items: [{ itemCode: 'reward_token', name: '纪念徽章', quantity: 2, iconKey: 'item.key' }], growthPoints: 3 }
  });
  assert.equal(proposed.ok, true);
  const duplicateProposal = proposeRewardGrant(env.database, env.userId, env.conversationId, { sourceType: 'quest', sourceId: env.quest.id, rewards: { growthPoints: 999 } });
  assert.equal(duplicateProposal.duplicate, true);
  const claimed = claimRewardGrant(env.database, env.userId, env.conversationId, proposed.grant.id);
  assert.equal(claimed.ok, true);
  assert.equal(claimed.duplicate, false);
  assert.equal(getConversationAccounts(env.database, env.userId, env.conversationId).find(item => item.currencyType === 'gold').balance, 110);
  assert.equal(listActorItems(env.database, env.userId, env.conversationId, 'protagonist', '')[0].quantity, 2);
  assert.equal(getCharacterGrowth(env.database, env.userId, env.conversationId).growthPoints, 3);
  assert.equal(claimRewardGrant(env.database, env.userId, env.conversationId, proposed.grant.id).duplicate, true);
  assert.equal(getConversationAccounts(env.database, env.userId, env.conversationId).find(item => item.currencyType === 'gold').balance, 110);
  env.database.close();
});

test('reward proposals reject unfinished sources, negative values and conflicting ownership', () => {
  const env = setup();
  const active = createQuest(env.database, env.userId, env.conversationId, { title: '未完成任务', objectives: [{ description: '继续' }] });
  assert.match(proposeRewardGrant(env.database, env.userId, env.conversationId, { sourceType: 'quest', sourceId: active.id, rewards: { growthPoints: 1 } }).error, /必须已完成/);
  assert.match(proposeRewardGrant(env.database, env.userId, env.conversationId, { sourceType: 'quest', sourceId: env.quest.id, rewards: { currency: [{ amount: -20 }], items: [{ itemCode: 'bad', name: '坏奖励', quantity: -5 }], growthPoints: -1 } }).error, /奖励内容为空/);
  upsertSceneItem(env.database, env.userId, env.conversationId, { nodeId: env.node.id, itemCode: 'owned_relic', name: '世界遗物', ownerType: 'world', quantity: 1 });
  assert.match(proposeRewardGrant(env.database, env.userId, env.conversationId, { sourceType: 'quest', sourceId: env.quest.id, rewards: { items: [{ itemCode: 'owned_relic', name: '世界遗物', quantity: 1 }] } }).error, /其他所有者/);
  env.database.close();
});

test('reward settlement advances active quest objectives and enforces backpack capacity', () => {
  const env = setup();
  const target = createQuest(env.database, env.userId, env.conversationId, { title: '成长任务', objectives: [{ description: '积累成长', targetValue: 3 }] });
  const progressGrant = proposeRewardGrant(env.database, env.userId, env.conversationId, {
    sourceType: 'quest', sourceId: env.quest.id,
    rewards: { questProgress: [{ questId: target.id, objectiveId: target.objectives[0].id, delta: 2 }] }
  });
  assert.equal(claimRewardGrant(env.database, env.userId, env.conversationId, progressGrant.grant.id).results.questProgress[0].currentValue, 2);

  const capacitySource = createQuest(env.database, env.userId, env.conversationId, { title: '容量来源', objectives: [{ description: '完成' }] });
  updateQuestObjective(env.database, env.userId, env.conversationId, capacitySource.id, capacitySource.objectives[0].id, { currentValue: 1 });
  for (let index = 0; index < 60; index += 1) {
    upsertSceneItem(env.database, env.userId, env.conversationId, { itemCode: `capacity_${index}`, name: `容量物品 ${index}`, ownerType: 'protagonist', quantity: 1 });
  }
  const capacityGrant = proposeRewardGrant(env.database, env.userId, env.conversationId, {
    sourceType: 'quest', sourceId: capacitySource.id,
    rewards: { items: [{ itemCode: 'capacity_overflow', name: '放不下的宝物', quantity: 1 }] }
  });
  assert.match(claimRewardGrant(env.database, env.userId, env.conversationId, capacityGrant.grant.id).error, /背包种类上限/);
  env.database.close();
});
