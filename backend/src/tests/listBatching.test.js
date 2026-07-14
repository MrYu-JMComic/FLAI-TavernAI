import assert from 'node:assert/strict';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const { createWorldBook, getCharacterWorldBookId, getCharacterWorldBookIds, linkWorldBookToCharacter } = await import('../modules/worldBooks.js');
const { getCharacterTagsMap, setCharacterTags } = await import('../modules/tags.js');
const { emptyUsageSummary, getConversationUsageSummaries } = await import('../routes/helpers.js');
const { insertUser } = await import('./routeTestUtils.js');

function insertConversation(database, userId, characterId, conversationId) {
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, 'test', timestamp, timestamp);
}

function insertMessage(database, userId, conversationId, messageId, usage) {
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, usage_json, created_at)
     VALUES (?, ?, ?, 'assistant', 'hi', ?, ?)`
  ).run(messageId, userId, conversationId, usage ? JSON.stringify(usage) : null, new Date().toISOString());
}

test('getCharacterWorldBookIds matches per-character lookups in one batch', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'batch-worldbook-user';
  insertUser(database, userId);

  const linkedCharacter = createCharacter(database, userId, { name: 'Linked' });
  const directCharacter = createCharacter(database, userId, { name: 'Direct' });
  const bareCharacter = createCharacter(database, userId, { name: 'Bare' });

  const linkedBook = createWorldBook(database, userId, { name: 'Linked Book' });
  linkWorldBookToCharacter(database, linkedBook.id, linkedCharacter.id, 0, userId);
  const directBook = createWorldBook(database, userId, { name: 'Direct Book', characterId: directCharacter.id });

  const ids = [linkedCharacter.id, directCharacter.id, bareCharacter.id];
  const batch = getCharacterWorldBookIds(database, ids);

  for (const id of ids) {
    assert.equal(batch.get(id) || null, getCharacterWorldBookId(database, id));
  }
  assert.equal(batch.get(linkedCharacter.id), linkedBook.id);
  assert.equal(batch.get(directCharacter.id), directBook.id);
  assert.equal(batch.has(bareCharacter.id), false);
  assert.equal(getCharacterWorldBookIds(database, []).size, 0);
});

test('getCharacterTagsMap groups tags by character in tag-name order', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'batch-tags-user';
  insertUser(database, userId);

  const first = createCharacter(database, userId, { name: 'First' });
  const second = createCharacter(database, userId, { name: 'Second' });
  setCharacterTags(database, userId, first.id, ['zeta', 'alpha']);
  setCharacterTags(database, userId, second.id, ['beta']);

  const map = getCharacterTagsMap(database, [first.id, second.id]);
  assert.deepEqual(map.get(first.id).map((tag) => tag.name), ['alpha', 'zeta']);
  assert.deepEqual(map.get(second.id).map((tag) => tag.name), ['beta']);
  assert.equal(map.get(first.id)[0].user_id, userId);
  assert.equal(getCharacterTagsMap(database, []).size, 0);
});

test('getConversationUsageSummaries aggregates usage per conversation in one pass', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'batch-usage-user';
  const otherUserId = 'batch-usage-other';
  insertUser(database, userId);
  insertUser(database, otherUserId);

  const character = createCharacter(database, userId, { name: 'Usage Character' });
  const otherCharacter = createCharacter(database, otherUserId, { name: 'Other Character' });
  insertConversation(database, userId, character.id, 'conv-a');
  insertConversation(database, userId, character.id, 'conv-b');
  insertConversation(database, otherUserId, otherCharacter.id, 'conv-other');

  const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
  insertMessage(database, userId, 'conv-a', 'msg-1', usage);
  insertMessage(database, userId, 'conv-a', 'msg-2', usage);
  insertMessage(database, userId, 'conv-b', 'msg-3', null);
  insertMessage(database, otherUserId, 'conv-other', 'msg-4', usage);

  const summaries = getConversationUsageSummaries(database, userId);
  assert.equal(summaries.has('conv-other'), false);
  assert.equal(summaries.has('conv-b'), false);

  const summaryA = summaries.get('conv-a');
  assert.ok(summaryA);
  assert.equal(summaryA.totalTokens, 30);

  const empty = emptyUsageSummary();
  assert.equal(empty.totalTokens, 0);
});
