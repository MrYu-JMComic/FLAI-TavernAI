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

test('memory extraction accepts narrated facts from either participant but not hypothetical outcomes', () => {
  const candidates = extractConversationMemoryCandidates({
    userText: 'I prefer brief replies. The player found a gold crown.',
    assistantText: 'I prefer coffee. Mira found a silver key. If Mira entered Silver Harbor, she might find a crown.'
  });
  assert.equal(candidates.filter((candidate) => candidate.memoryType === 'preference').length, 1);
  assert.equal(candidates.find((candidate) => candidate.memoryType === 'preference').sourceRole, 'user');
  assert.ok(candidates.some((candidate) => candidate.content.includes('silver key')));
  assert.ok(candidates.some((candidate) => candidate.content.includes('gold crown') && candidate.sourceRole === 'user'));
  assert.ok(candidates.every((candidate) => !/coffee|Silver Harbor/.test(candidate.content)));
  assert.deepEqual(extractConversationMemoryCandidates({ messages: [{ role: 'system', content: 'Mira found a key.' }] }), []);
});

test('user-authored completed actions remain eligible for pending memory', () => {
  const completed = extractConversationMemoryCandidates({ userText: '\u6211\u628a\u94a5\u5319\u4ea4\u7ed9\u4e86\u5979\u3002' });
  assert.ok(completed.some((candidate) => candidate.memoryType === 'event' && candidate.sourceRole === 'user'));
  const planned = extractConversationMemoryCandidates({ userText: '\u6211\u60f3\u628a\u94a5\u5319\u4ea4\u7ed9\u5979\u3002' });
  assert.equal(planned.length, 0);
});

test('quoted preferences and temporary requests do not become user preferences', () => {
  const candidates = extractConversationMemoryCandidates({
    userText: 'Mira said "I prefer coffee." I want to enter the palace. I dislike cold tea.'
  });
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].content, /I dislike cold tea/);
});

test('a missing source message ID never borrows evidence from the other speaker', (t) => {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'missing-memory-source';
  const conversationId = 'missing-memory-source-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Memory source' });
  insertConversation(database, { userId, conversationId, characterId: character.id });
  const memories = recordAutomaticConversationMemories(database, userId, conversationId, {
    userMessage: { content: 'I prefer moon tea.' },
    assistantMessage: { id: 'unrelated-assistant', content: 'Understood.' }
  });
  assert.equal(memories.length, 1);
  assert.equal(memories[0].sourceMessageId, '');
  assert.equal(memories[0].enabled, false);
});
