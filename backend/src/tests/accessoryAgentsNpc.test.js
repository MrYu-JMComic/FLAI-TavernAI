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

test('NPC accessory agent prompt describes status aliases and memory sealing', () => {
  assert.match(accessoryAgentsSource, /Update status when the reply clearly says an NPC left/);
  assert.match(accessoryAgentsSource, /Aliases are exact alternate ways this same individual is called/);
  assert.match(accessoryAgentsSource, /generic (?:section titles|roles)/i);
  assert.match(accessoryAgentsSource, /memorySealed/);
});
