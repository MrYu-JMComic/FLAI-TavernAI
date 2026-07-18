import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const accessoryAgentsSource = readRepoText('backend/src/services/accessoryAgents.js');

test('NPC accessory agent can record reusable behavior rules', () => {
  assert.match(accessoryAgentsSource, /\[npcUpsertTool\(\), npcMemoryTool\(\), npcBehaviorTool\(\), actorItemTool\(\), actorItemDeleteTool\(\)\]/);
  assert.match(accessoryAgentsSource, /toolName === 'record_npc_behavior'/);
  assert.match(accessoryAgentsSource, /function npcBehaviorTool\(\)/);
  assert.match(accessoryAgentsSource, /function addNpcBehaviorIfNew/);
  assert.match(accessoryAgentsSource, /addNpcBehavior\(db, userId, conversationId, name/);
});

test('NPC accessory agent tracks unique protagonist and NPC items', () => {
  assert.match(accessoryAgentsSource, /toolName === 'upsert_actor_item'/);
  assert.match(accessoryAgentsSource, /一个物品不能同时属于多个所有者/);
  assert.match(accessoryAgentsSource, /function actorItemTool\(\)/);
  assert.match(accessoryAgentsSource, /function actorItemDeleteTool\(\)/);
  assert.match(accessoryAgentsSource, /clothingSlot/);
  assert.match(accessoryAgentsSource, /coverage/);
  assert.match(accessoryAgentsSource, /ownerType: \{ type: 'string', enum: \['world', 'protagonist', 'npc'\] \}/);
});

test('scene and NPC state agents run in deterministic sequence', () => {
  assert.match(accessoryAgentsSource, /stateAgentFactories\.push\(sceneAgentFactory\)/);
  assert.match(accessoryAgentsSource, /stateAgentFactories\.push\(npcAgentFactory\)/);
  assert.match(accessoryAgentsSource, /stateAgentFactories\.push\(worldDirectorFactory\)/);
  assert.match(accessoryAgentsSource, /runAgentSequence\(stateAgentFactories\)/);
  assert.ok(
    accessoryAgentsSource.indexOf('stateAgentFactories.push(sceneAgentFactory)')
      < accessoryAgentsSource.indexOf('stateAgentFactories.push(npcAgentFactory)'),
  );
  assert.ok(
    accessoryAgentsSource.indexOf('stateAgentFactories.push(npcAgentFactory)')
      < accessoryAgentsSource.indexOf('stateAgentFactories.push(worldDirectorFactory)'),
  );
  assert.match(accessoryAgentsSource, /async function runAgentSequence/);
  assert.doesNotMatch(accessoryAgentsSource, /jobs\.push\(runAgentJob\('npcAgent'/);
  assert.doesNotMatch(accessoryAgentsSource, /jobs\.push\(runAgentJob\('sceneAgent'/);
});

test('NPC accessory agent keeps automatic behavior rules conservative', () => {
  assert.match(accessoryAgentsSource, /const AUTO_NPC_BEHAVIOR_LIMIT = 8;/);
  assert.match(accessoryAgentsSource, /record_npc_memory 用于本轮产生的可长期复用事实/);
  assert.match(accessoryAgentsSource, /明确 triggerCondition/);
  assert.match(accessoryAgentsSource, /无法确定时不要创建行为/);
  assert.match(accessoryAgentsSource, /description: 'Record one rare stable future behavior rule/);
  assert.match(accessoryAgentsSource, /required: \['npcName', 'triggerCondition', 'action'\]/);
  assert.match(
    accessoryAgentsSource,
    /if \(!name \|\| !action \|\| !triggerCondition\) \{\s*return null;\s*}/
  );
  assert.match(
    accessoryAgentsSource,
    /if \(countNpcBehaviors\(db, conversationId, name\) >= AUTO_NPC_BEHAVIOR_LIMIT\) \{\s*return null;\s*}/
  );
  assert.match(accessoryAgentsSource, /function countNpcBehaviors\(db, conversationId, npcName\)/);
});

test('NPC accessory agent prompt describes status aliases and memory sealing', () => {
  assert.match(accessoryAgentsSource, /status 是持续状态/);
  assert.match(accessoryAgentsSource, /稳定昵称或唯一称号写入 aliases/);
  assert.match(accessoryAgentsSource, /泛称职业、群体名称、代词/);
  assert.match(accessoryAgentsSource, /memorySealed/);
  assert.match(accessoryAgentsSource, /observationWindow/);
  assert.match(accessoryAgentsSource, /不得把世界设定、旧历史、计划、示例、假设或未变化状态重复写成记忆/);
  assert.match(accessoryAgentsSource, /relationship: args\.relationship/);
});
