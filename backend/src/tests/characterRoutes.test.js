import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';

const { createAppDatabase } = await import('../db.js');
const { createCharacter, getCharacter } = await import('../modules/characters.js');
const { createWorldBook, getCharacterWorldBookId, linkWorldBookToCharacter } = await import('../modules/worldBooks.js');
const { createCharactersRouter } = await import('../routes/characters.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

test('public character routes reject non-owner patch and delete', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-owner';
  const viewerId = 'character-route-viewer';
  insertUser(database, ownerId);
  insertUser(database, viewerId);
  const character = createCharacter(database, ownerId, {
    name: 'Shared Character',
    visibility: 'public'
  });

  const app = createCharacterRoutesApp(database, viewerId);

  await withServer(app, async (baseUrl) => {
    const readResponse = await fetch(`${baseUrl}/api/characters/${character.id}`);
    const readBody = await readResponse.json();
    assert.equal(readResponse.status, 200);
    assert.equal(readBody.id, character.id);
    assert.equal(readBody.canEdit, false);

    const patchResponse = await fetch(`${baseUrl}/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Viewer Edit Attempt' })
    });
    assert.equal(patchResponse.status, 403);

    const deleteResponse = await fetch(`${baseUrl}/api/characters/${character.id}`, {
      method: 'DELETE'
    });
    assert.equal(deleteResponse.status, 403);

    const ownerView = getCharacter(database, ownerId, character.id);
    assert.equal(ownerView.name, 'Shared Character');
    assert.equal(ownerView.visibility, 'public');
  });
});

test('owner character routes patch and delete owned character', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-owner-success';
  insertUser(database, ownerId);
  const character = createCharacter(database, ownerId, {
    name: 'Owned Character',
    visibility: 'private'
  });

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const patchResponse = await fetch(`${baseUrl}/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner Edited Character',
        visibility: 'public'
      })
    });
    const patchBody = await patchResponse.json();
    assert.equal(patchResponse.status, 200);
    assert.equal(patchBody.id, character.id);
    assert.equal(patchBody.name, 'Owner Edited Character');
    assert.equal(patchBody.visibility, 'public');
    assert.equal(patchBody.canEdit, true);

    const storedAfterPatch = getCharacter(database, ownerId, character.id);
    assert.equal(storedAfterPatch.name, 'Owner Edited Character');
    assert.equal(storedAfterPatch.visibility, 'public');

    const deleteResponse = await fetch(`${baseUrl}/api/characters/${character.id}`, {
      method: 'DELETE'
    });
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteBody.ok, true);
    assert.equal(getCharacter(database, ownerId, character.id), null);

    const readAfterDeleteResponse = await fetch(`${baseUrl}/api/characters/${character.id}`);
    assert.equal(readAfterDeleteResponse.status, 404);
  });
});

test('character create route reports linked worldBookId', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-worldbook-owner';
  insertUser(database, ownerId);
  const book = createWorldBook(database, ownerId, { name: 'Route World Book' });

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'World Book Character',
        worldBookId: book.id
      })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.worldBookId, book.id);
    assert.equal(getCharacterWorldBookId(database, body.id), book.id);
  });
});

test('character patch route reports linked worldBookId', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-worldbook-patch-owner';
  insertUser(database, ownerId);
  const character = createCharacter(database, ownerId, {
    name: 'Patch World Book Character'
  });
  const book = createWorldBook(database, ownerId, {
    name: 'Patch Route World Book'
  });

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldBookId: book.id })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.id, character.id);
    assert.equal(body.worldBookId, book.id);
    assert.equal(getCharacterWorldBookId(database, character.id), book.id);
  });
});

test('character world book unlink rejects foreign legacy junction rows', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-unlink-owner';
  const otherId = 'character-route-unlink-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const character = createCharacter(database, ownerId, {
    name: 'Unlink Owner Character'
  });
  const otherBook = createWorldBook(database, otherId, {
    name: 'Foreign Unlink Book'
  });
  database
    .prepare(
      `INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(character.id, otherBook.id, 0, new Date().toISOString());

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/world-books/${otherBook.id}`, {
      method: 'DELETE'
    });
    assert.equal(response.status, 404);
  });

  const row = database
    .prepare('SELECT COUNT(*) AS count FROM character_world_books WHERE character_id = ? AND world_book_id = ?')
    .get(character.id, otherBook.id);
  assert.equal(row.count, 1);
  assert.equal(getCharacterWorldBookId(database, character.id), null);
});

test('character export ignores foreign legacy direct world book rows', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-export-owner';
  const otherId = 'character-route-export-other';
  insertUser(database, ownerId);
  insertUser(database, otherId);
  const character = createCharacter(database, ownerId, {
    name: 'Export Owner Character'
  });
  const timestamp = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO world_books (id, user_id, name, description, character_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'foreign-export-world-book',
      otherId,
      'Foreign Export Book',
      'Should not be exported',
      character.id,
      timestamp,
      timestamp
    );

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/export`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.character.name, 'Export Owner Character');
    assert.equal(body.world_book, null);
  });
});

test('character export picks newest legacy direct world book deterministically', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-export-order-owner';
  insertUser(database, ownerId);
  const character = createCharacter(database, ownerId, {
    name: 'Export Ordered Character'
  });
  const insertBook = database.prepare(
    `INSERT INTO world_books (id, user_id, name, description, character_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertBook.run(
    'old-export-world-book',
    ownerId,
    'Old Export Book',
    '',
    character.id,
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  );
  insertBook.run(
    'new-export-world-book',
    ownerId,
    'New Export Book',
    '',
    character.id,
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z'
  );

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/export`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.world_book.name, 'New Export Book');
  });
});

test('character export prefers linked world book before legacy direct fallback', async () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-export-linked-owner';
  insertUser(database, ownerId);
  const character = createCharacter(database, ownerId, {
    name: 'Export Linked Character'
  });
  createWorldBook(database, ownerId, {
    name: 'Legacy Direct Export Book',
    characterId: character.id
  });
  const linkedBook = createWorldBook(database, ownerId, {
    name: 'Linked Export Book'
  });
  assert.equal(linkWorldBookToCharacter(database, linkedBook.id, character.id, 0, ownerId), true);

  const app = createCharacterRoutesApp(database, ownerId);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/characters/${character.id}/export`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.world_book.name, 'Linked Export Book');
  });
});

test('character worldBookId helper falls back to legacy direct binding', () => {
  const database = createAppDatabase(':memory:');
  const ownerId = 'character-route-legacy-worldbook-owner';
  insertUser(database, ownerId);
  const character = createCharacter(database, ownerId, {
    name: 'Legacy World Book Character'
  });
  const book = createWorldBook(database, ownerId, {
    name: 'Legacy Direct World Book',
    characterId: character.id
  });

  assert.equal(getCharacterWorldBookId(database, character.id), book.id);
});

function createCharacterRoutesApp(database, userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/characters', createCharactersRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: userId, username: userId } };
      next();
    },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withCharacterTags: (character) => character,
    withWorldBookId: (character) => (
      character ? { ...character, worldBookId: getCharacterWorldBookId(database, character.id) } : character
    ),
    hasUsableProvider: () => true,
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }),
    withEtag: (_request, response, data) => response.json(data),
    withListCache: (_request, response, data) => response.json(data),
    nowIso: () => new Date().toISOString()
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: error.message });
  });
  return app;
}
