import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { listConversationNpcs, listNpcBehaviors, listNpcMemories } = await import('../modules/npcs.js');
const { applyNpcOrganizerTool } = await import('../services/npcOrganizer.js');

function setupDatabase() {
  const database = createAppDatabase(':memory:');
  const userId = 'npc-organizer-user';
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    userId,
    'npc-organizer',
    'hash',
    new Date().toISOString()
  );
  const character = createCharacter(database, userId, { name: 'Hero', visibility: 'private' });
  const conversationId = 'npc-organizer-conversation';
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, character.id, 'NPC organizer test', timestamp, timestamp);
  return { database, userId, conversationId };
}

test('NPC organizer tools edit profiles, memories, and behaviors', () => {
  const { database, userId, conversationId } = setupDatabase();

  const profile = applyNpcOrganizerTool(database, userId, conversationId, 'upsert_npc_profile', {
    npcName: 'Mira',
    status: 'custom',
    customStatus: 'tracking a lead',
    aliases: ['Innkeeper Mira', 'Mira'],
    memorySealed: true,
    evidence: 'Mentioned in recent chat.',
    confidence: 88
  });
  assert.equal(profile.ok, true);
  assert.equal(profile.npc.name, 'Mira');
  assert.equal(profile.npc.status, 'custom');
  assert.deepEqual(profile.npc.aliases, ['Innkeeper Mira', 'Mira']);

  const addedMemory = applyNpcOrganizerTool(database, userId, conversationId, 'add_npc_memory', {
    npcName: 'Mira',
    memoryType: 'knowledge',
    content: 'Mira knows the cellar route.'
  });
  assert.equal(addedMemory.ok, true);

  const updatedMemory = applyNpcOrganizerTool(database, userId, conversationId, 'update_npc_memory', {
    npcName: 'Mira',
    memoryId: addedMemory.memory.id,
    memoryType: 'event',
    content: 'Mira showed the cellar route to the party.'
  });
  assert.equal(updatedMemory.ok, true);
  assert.equal(updatedMemory.memory.memoryType, 'event');

  const addedBehavior = applyNpcOrganizerTool(database, userId, conversationId, 'add_npc_behavior', {
    npcName: 'Mira',
    behaviorType: 'dialogue',
    triggerCondition: 'When the cellar is discussed',
    action: 'Warn the party about the second stair.',
    priority: 71,
    enabled: true
  });
  assert.equal(addedBehavior.ok, true);

  const updatedBehavior = applyNpcOrganizerTool(database, userId, conversationId, 'update_npc_behavior', {
    npcName: 'Mira',
    behaviorId: addedBehavior.behavior.id,
    priority: 82,
    enabled: false
  });
  assert.equal(updatedBehavior.ok, true);
  assert.equal(updatedBehavior.behavior.priority, 82);
  assert.equal(updatedBehavior.behavior.enabled, false);

  const memories = listNpcMemories(database, userId, conversationId, 'Mira');
  const behaviors = listNpcBehaviors(database, userId, conversationId, 'Mira');
  assert.equal(memories.length, 1);
  assert.equal(behaviors.length, 1);

  const deletedMemory = applyNpcOrganizerTool(database, userId, conversationId, 'delete_npc_memory', {
    npcName: 'Mira',
    memoryId: addedMemory.memory.id
  });
  assert.equal(deletedMemory.ok, true);

  const deletedBehavior = applyNpcOrganizerTool(database, userId, conversationId, 'delete_npc_behavior', {
    npcName: 'Mira',
    behaviorId: addedBehavior.behavior.id
  });
  assert.equal(deletedBehavior.ok, true);
  assert.equal(listNpcMemories(database, userId, conversationId, 'Mira').length, 0);
  assert.equal(listNpcBehaviors(database, userId, conversationId, 'Mira').length, 0);

  const hidden = applyNpcOrganizerTool(database, userId, conversationId, 'hide_npc_profile', {
    npcName: 'Mira'
  });
  assert.equal(hidden.ok, true);
  assert.equal(listConversationNpcs(database, userId, conversationId, 'Hero').length, 0);

  const restored = applyNpcOrganizerTool(database, userId, conversationId, 'upsert_npc_profile', {
    npcName: 'Mira',
    evidence: 'Still relevant after review.'
  });
  assert.equal(restored.ok, true);
  assert.equal(listConversationNpcs(database, userId, conversationId, 'Hero').length, 1);
});

test('NPC organizer tools reject empty required mutation fields', () => {
  const { database, userId, conversationId } = setupDatabase();

  const emptyMemory = applyNpcOrganizerTool(database, userId, conversationId, 'add_npc_memory', {
    npcName: 'Mira',
    content: '   '
  });
  assert.equal(emptyMemory.ok, false);

  const emptyBehavior = applyNpcOrganizerTool(database, userId, conversationId, 'add_npc_behavior', {
    npcName: 'Mira',
    action: ''
  });
  assert.equal(emptyBehavior.ok, false);
});
