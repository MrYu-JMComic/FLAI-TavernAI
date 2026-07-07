import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const {
  confirmConversationMemory,
  listConversationMemories,
  rollbackConversationMemory
} = await import('../modules/conversationMemories.js');
const {
  extractConversationMemoryCandidates,
  recordAutomaticConversationMemories
} = await import('../services/conversationMemoryExtraction.js');
const { insertUser } = await import('./routeTestUtils.js');

test('conversation memory extraction proposes typed disabled candidates with source audit data', () => {
  const candidates = extractConversationMemoryCandidates({
    userText: 'I prefer moon tea. We arrived at Silver Harbor.',
    assistantText: 'Mira trusts the player. The player found a silver key under the old bridge.'
  });

  assert.equal(candidates.some((candidate) => candidate.memoryType === 'preference'), true);
  assert.equal(candidates.some((candidate) => candidate.memoryType === 'relationship'), true);
  assert.equal(candidates.some((candidate) => candidate.memoryType === 'event'), true);
  assert.equal(candidates.find((candidate) => candidate.memoryType === 'preference')?.sourceRole, 'user');
  assert.equal(candidates.find((candidate) => candidate.memoryType === 'relationship')?.sourceRole, 'assistant');
});

test('automatic conversation memories are pending until confirmed and can be rolled back', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'auto-memory-user';
  const conversationId = 'auto-memory-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Auto Memory', visibility: 'private' });
  insertConversation(database, { userId, conversationId, characterId: character.id });

  const created = recordAutomaticConversationMemories(database, userId, conversationId, {
    userMessage: {
      id: 'auto-memory-user-message',
      content: 'I prefer moon tea.'
    },
    assistantMessage: {
      id: 'auto-memory-assistant-message',
      content: 'Mira trusts the player. The player found a silver key under the old bridge.'
    }
  });

  assert.ok(created.length >= 2);
  for (const memory of created) {
    assert.equal(memory.sourceKind, 'auto');
    assert.equal(memory.enabled, false);
    assert.equal(memory.archived, false);
    assert.equal(memory.pending, true);
    assert.ok(memory.sourceExcerpt.length > 0);
  }
  assert.equal(
    created.some((memory) => memory.memoryType === 'preference' && memory.sourceMessageId === 'auto-memory-user-message'),
    true
  );
  assert.equal(
    created.some((memory) => memory.memoryType === 'relationship' && memory.sourceMessageId === 'auto-memory-assistant-message'),
    true
  );

  const duplicate = recordAutomaticConversationMemories(database, userId, conversationId, {
    userMessage: { id: 'auto-memory-user-message-2', content: 'I prefer moon tea.' },
    assistantMessage: {
      id: 'auto-memory-assistant-message-2',
      content: 'Mira trusts the player. The player found a silver key under the old bridge.'
    }
  });
  assert.equal(duplicate.length, 0);

  const confirmed = confirmConversationMemory(database, userId, conversationId, created[0].id);
  assert.equal(confirmed.enabled, true);
  assert.equal(confirmed.pending, false);

  const rolledBack = rollbackConversationMemory(database, userId, conversationId, created[1].id);
  assert.equal(rolledBack.enabled, false);
  assert.equal(rolledBack.archived, true);
  assert.equal(rolledBack.pending, false);

  const visible = listConversationMemories(database, userId, conversationId);
  assert.equal(visible.some((memory) => memory.id === rolledBack.id), false);
});

function insertConversation(database, { userId, conversationId, characterId }) {
  const timestamp = new Date().toISOString();
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, 'Auto Memory Test', timestamp, timestamp);
}
