import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const accessoryAgentsSource = readRepoText('backend/src/services/accessoryAgents.js');

test('NPC accessory agent can record reusable behavior rules', () => {
  assert.match(accessoryAgentsSource, /\[npcUpsertTool\(\), npcMemoryTool\(\), npcBehaviorTool\(\)\]/);
  assert.match(accessoryAgentsSource, /toolName === 'record_npc_behavior'/);
  assert.match(accessoryAgentsSource, /function npcBehaviorTool\(\)/);
  assert.match(accessoryAgentsSource, /function addNpcBehaviorIfNew/);
  assert.match(accessoryAgentsSource, /addNpcBehavior\(db, userId, conversationId, name/);
});

test('NPC accessory agent keeps automatic behavior rules conservative', () => {
  assert.match(accessoryAgentsSource, /const AUTO_NPC_BEHAVIOR_LIMIT = 8;/);
  assert.match(accessoryAgentsSource, /Prefer record_npc_memory for observations, facts, relationship changes/);
  assert.match(accessoryAgentsSource, /clear trigger condition/);
  assert.match(accessoryAgentsSource, /too many behavior rules can over-constrain the character/);
  assert.match(accessoryAgentsSource, /description: 'Record a rare explicit, stable reusable future behavior rule/);
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
  assert.match(accessoryAgentsSource, /Update status when the reply clearly says an NPC left/);
  assert.match(accessoryAgentsSource, /Aliases are exact alternate ways this same individual is called/);
  assert.match(accessoryAgentsSource, /generic (?:section titles|roles)/i);
  assert.match(accessoryAgentsSource, /memorySealed/);
});
