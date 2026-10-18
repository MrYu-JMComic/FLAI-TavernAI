import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter } = await import('../modules/characters.js');
const {
  createEntry,
  createWorldBook,
  getWorldBook,
  linkCharacter,
  listCharacterWorldBooks,
  listWorldBooks
} = await import('../services/worldBooks/worldBookService.js');
const { matchWorldBookEntries } = await import('../services/worldBooks/worldBookRuntime.js');
const { createWorldBooksRouter } = await import('../routes/worldBooks.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('world book routes reject foreign character bindings', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'world-book-route-owner';
  const otherId = 'world-book-route-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const otherCharacter = createCharacter(database, otherId, {
    name: 'Other User Character'
  });
  const ownerBook = createWorldBook(database, ownerId, {
    name: 'Owner Book'
  });

  const app = createWorldBooksRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/world-books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Foreign Character Link',
        characterId: otherCharacter.id
      })
    });
    assert.equal(createResponse.status, 400);
    assert.equal(
      listWorldBooks(database, ownerId).some((book) => book.name === 'Foreign Character Link'),
      false
    );

    const updateResponse = await fetch(`${baseUrl}/api/world-books/${ownerBook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner Book',
        characterId: otherCharacter.id
      })
    });
    assert.equal(updateResponse.status, 400);
    assert.equal(getWorldBook(database, ownerId, ownerBook.id).characterId, null);
  });
});

test('world book character binding helpers reject foreign characters', () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'world-book-helper-owner';
  const otherId = 'world-book-helper-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const otherCharacter = createCharacter(database, otherId, {
    name: 'Other Helper Character'
  });
  const ownerBook = createWorldBook(database, ownerId, {
    name: 'Owner Helper Book'
  });

  assert.throws(
    () => createWorldBook(database, ownerId, {
      name: 'Invalid Direct Binding',
      characterId: otherCharacter.id
    }),
    /Character does not exist/
  );
  assert.equal(linkCharacter(database, ownerId, ownerBook.id, otherCharacter.id, 0), false);
});

test('world book matching ignores foreign junction links', () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'world-book-match-owner';
  const otherId = 'world-book-match-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const ownerCharacter = createCharacter(database, ownerId, {
    name: 'Owner Match Character'
  });
  const foreignBook = createWorldBook(database, otherId, {
    name: 'Foreign Book'
  });
  createEntry(database, otherId, foreignBook.id, {
    name: 'Foreign Entry',
    triggerKeys: 'foreign-trigger',
    content: 'foreign content'
  });
  // Attach another user's book to this character straight in the junction table,
  // bypassing the service's ownership check.
  database
    .prepare(
      `INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(ownerCharacter.id, foreignBook.id, 0, new Date().toISOString());
  const conversationId = 'world-book-match-conversation';
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(conversationId, ownerId, ownerCharacter.id, 'Match', timestamp, timestamp);

  assert.deepEqual(
    matchWorldBookEntries(database, ownerCharacter.id, ['foreign-trigger'], { conversationId }),
    []
  );
});

test('world book reads ignore foreign legacy junction links', () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'world-book-read-owner';
  const otherId = 'world-book-read-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const ownerCharacter = createCharacter(database, ownerId, {
    name: 'Owner Read Character'
  });
  const otherCharacter = createCharacter(database, otherId, {
    name: 'Other Read Character'
  });
  const ownerBook = createWorldBook(database, ownerId, {
    name: 'Owner Read Book'
  });
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(ownerCharacter.id, ownerBook.id, 0, timestamp);
  database
    .prepare(
      `INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(otherCharacter.id, ownerBook.id, 0, timestamp);

  assert.deepEqual(getWorldBook(database, ownerId, ownerBook.id).linkedCharacters, [ownerCharacter.id]);
  assert.deepEqual(listCharacterWorldBooks(database, otherCharacter.id), []);
});

function createWorldBooksRoutesApp(database, userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/world-books', createWorldBooksRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withListCache: (_request, response, data) => response.json(data),
    getChatProviderSettings: () => ({ ok: false, error: 'unused' })
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}
