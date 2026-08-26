import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createSearchRouter } from '../routes/search.js';
import { buildFtsQuery, searchUserContent } from '../services/fullTextSearch.js';
import { insertUser, withServer } from './routeTestUtils.js';

test('full-text retrieval ranks all supported sources and isolates users', () => {
  const database = createSearchDatabase();
  try {
    const result = searchUserContent(database, 'search-user', 'crystal dragon', { limit: 10 });
    assert.deepEqual(new Set(result.results.map((row) => row.type)), new Set([
      'message',
      'memory',
      'world-book'
    ]));
    assert.equal(result.results.some((row) => row.excerpt.includes('private rival note')), false);
    assert.equal(result.results.every((row) => Number.isFinite(row.score)), true);
    assert.equal(result.results.every((row) => row.evidence?.id), true);

    const scoped = searchUserContent(database, 'search-user', 'crystal dragon', {
      conversationId: 'search-conversation',
      types: ['message'],
      limit: 10
    });
    assert.deepEqual(scoped.results.map((row) => row.id), ['search-message']);
  } finally {
    database.close();
  }
});

test('full-text triggers synchronize updates and deletes', () => {
  const database = createSearchDatabase();
  try {
    database.prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run('A bronze phoenix rises.', 'search-message');
    assert.equal(searchUserContent(database, 'search-user', 'crystal dragon').results
      .some((row) => row.id === 'search-message'), false);
    assert.equal(searchUserContent(database, 'search-user', 'bronze phoenix').results
      .some((row) => row.id === 'search-message'), true);

    database.prepare('DELETE FROM world_book_entries WHERE id = ?').run('search-entry');
    assert.equal(searchUserContent(database, 'search-user', 'crystal dragon').results
      .some((row) => row.id === 'search-entry'), false);
  } finally {
    database.close();
  }
});

test('full-text query builder treats operator syntax as literal tokens', () => {
  assert.equal(buildFtsQuery('dragon OR * NEAR( secret )'), '"dragon" OR "or" OR "near" OR "secret"');
  const database = createSearchDatabase();
  try {
    assert.doesNotThrow(() => searchUserContent(database, 'search-user', '" ) OR * NOT (' ));
  } finally {
    database.close();
  }
});

test('search route validates inputs and returns authenticated user results', async () => {
  const database = createSearchDatabase();
  const app = express();
  app.use((request, _response, next) => {
    request.auth = { user: { id: 'search-user' } };
    next();
  });
  app.use('/api/search', createSearchRouter({
    db: database,
    requireAuth: (_request, _response, next) => next()
  }));
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.message });
  });
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/search?q=crystal%20dragon&types=message&limit=1`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.results.map((row) => row.id), ['search-message']);

      const invalid = await fetch(`${baseUrl}/api/search?q=&limit=1000`);
      assert.equal(invalid.status, 400);
    });
  } finally {
    database.close();
  }
});

function createSearchDatabase() {
  const database = createAppDatabase(':memory:');
  insertUser(database, 'search-user');
  insertUser(database, 'other-user');
  insertCharacterAndConversation(database, 'search-user', 'search-character', 'search-conversation');
  insertCharacterAndConversation(database, 'other-user', 'other-character', 'other-conversation');
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('search-message', 'search-user', 'search-conversation', 'user', 'The crystal dragon guards the bridge.', now);
  database.prepare(
    `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('other-message', 'other-user', 'other-conversation', 'user', 'A crystal dragon private rival note.', now);
  database.prepare(
    `INSERT INTO conversation_memories (
       id, user_id, conversation_id, memory_type, subject, content, importance, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'search-memory',
    'search-user',
    'search-conversation',
    'event',
    'Crystal pact',
    'The dragon accepted the crystal pact.',
    8,
    now,
    now
  );
  database.prepare(
    `INSERT INTO world_books (id, user_id, name, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('search-book', 'search-user', 'Bestiary', '', now, now);
  database.prepare(
    `INSERT INTO world_book_entries (
       id, world_book_id, name, trigger_keys, keys_secondary, content, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'search-entry',
    'search-book',
    'Crystal Dragon',
    'crystal dragon',
    'wyrm',
    'A crystal dragon sleeps below the northern bridge.',
    now
  );
  return database;
}

function insertCharacterAndConversation(database, userId, characterId, conversationId) {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(characterId, userId, `${userId} character`, now, now);
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, `${userId} conversation`, now, now);
}
