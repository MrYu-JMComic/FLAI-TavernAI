import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { createCharacter } from '../modules/characters.js';
import {
  applyWorldBookChanges, createEntry, createWorldBook, deleteWorldBook,
  getWorldBook, listWorldBooks, updateEntry, updateWorldBook
} from '../services/worldBooks/worldBookService.js';
import { worldBookRevision } from '../domain/worldBooks/revision.js';
import {
  buildWorldBookChanges, createWorldBookWorkspace, executeWorldBookWorkspaceTool, serializeWorldBookWorkspace
} from '../services/worldBooks/worldBookAssistantWorkspace.js';
import { rebaseWorldBookWorkspace, worldBookApplyRequest } from '../../../frontend/src/utils/worldBookWorkspace.js';
import { applyWorldBookChangesSchema } from '../validations/schemas.js';
import { createWorldBooksRouter } from '../routes/worldBooks.js';
import { insertUser, withServer } from './routeTestUtils.js';

function fixture(t) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'world-change-owner';
  insertUser(database, userId);
  const book = createWorldBook(database, userId, {
    name: 'Original book', description: 'Original description', scanDepth: 7, lorebookContextPercent: 41
  });
  return { database, userId, book };
}

function existingChange(database, userId, bookId, changes = {}) {
  return { ref: `existing:${bookId}`, bookId, baseRevision: getWorldBook(database, userId, bookId).revision, ...changes };
}

function newChange(name = 'New book') {
  return { ref: `new:${name}`, bookId: null, profile: { name } };
}

test('assistant patches preserve all other fields and all 80 stored entries', (t) => {
  const { database, userId, book } = fixture(t);
  const character = createCharacter(database, userId, { name: 'Bound character' });
  updateWorldBook(database, userId, book.id, { characterId: character.id });
  for (let index = 0; index < 80; index += 1) {
    createEntry(database, userId, book.id, {
      name: index === 5 ? '' : `Entry ${index + 1}`, triggerKeys: index === 5 ? '' : `key-${index}`,
      content: index === 5 ? '' : `Content ${index + 1}`, enabled: index % 3 !== 0,
      position: 'at_depth', depth: 6, role: 2, selective: true, selectiveLogic: 2,
      keysSecondary: 'secondary', regexMode: true, probability: 42, useProbability: true,
      group: 'group-a', groupWeight: 9, sticky: 4, cooldown: 3, delay: 2
    });
  }
  const before = getWorldBook(database, userId, book.id);
  const rowsBefore = database.prepare('SELECT * FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index').all(book.id);
  const target = before.entries[64];
  const parsed = applyWorldBookChangesSchema.parse({ requestId: 'large-book', changes: [
    existingChange(database, userId, book.id, {
      upserts: [{ entryId: target.id, patch: { content: 'Content was updated' } }]
    })
  ] });
  const result = applyWorldBookChanges(database, userId, parsed).books[0].book;
  assert.equal(result.entries.length, 80);
  assert.deepEqual(result.entries.filter((entry) => entry.id !== target.id), before.entries.filter((entry) => entry.id !== target.id));
  assert.deepEqual(result.entries[64], { ...target, content: 'Content was updated' });
  assert.equal(result.description, before.description);
  assert.equal(result.scanDepth, 7);
  assert.equal(result.lorebookContextPercent, 41);
  assert.deepEqual(result.linkedCharacters, [character.id]);
  assert.deepEqual(database.prepare('SELECT * FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index').all(book.id).map((row) => ({ ...row })),
    rowsBefore.map((row) => ({ ...row, ...(row.id === target.id ? { content: 'Content was updated' } : {}) })));
});

test('one transaction updates an existing book and creates an independent book', (t) => {
  const { database, userId, book } = fixture(t);
  const result = applyWorldBookChanges(database, userId, {
    requestId: 'mixed-changes', changes: [
      existingChange(database, userId, book.id, { profile: { description: 'New description' } }),
      { ...newChange(), entries: [{ name: 'Harbor', triggerKeys: 'harbor', content: 'Harbor lore' }] }
    ]
  });
  assert.equal(result.books.length, 2);
  assert.equal(result.books[0].book.id, book.id);
  assert.equal(result.books[0].book.description, 'New description');
  assert.notEqual(result.books[1].book.id, book.id);
  assert.equal(result.books[1].book.entries[0].content, 'Harbor lore');
  assert.deepEqual(result.books[1].book.linkedCharacters, []);
});

test('SQL failure rolls back every book and the durable request receipt', (t) => {
  const { database, userId, book } = fixture(t);
  const before = getWorldBook(database, userId, book.id);
  database.exec(`CREATE TRIGGER fail_assistant_insert BEFORE INSERT ON world_book_entries
    WHEN NEW.content = 'fail-transaction' BEGIN SELECT RAISE(ABORT, 'intentional apply failure'); END`);
  assert.throws(() => applyWorldBookChanges(database, userId, {
    requestId: 'rollback', changes: [
      existingChange(database, userId, book.id, { profile: { name: 'Temporary title' } }),
      { ...newChange(), entries: [{ content: 'fail-transaction' }] }
    ]
  }), /intentional apply failure/);
  assert.deepEqual(getWorldBook(database, userId, book.id), before);
  assert.equal(listWorldBooks(database, userId).length, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM world_book_change_requests').get().count, 0);
});

test('content revisions detect intervening edits even with identical timestamps', (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, { content: 'Before' });
  const stale = existingChange(database, userId, book.id, { profile: { name: 'Stale title' } });
  const timestamp = getWorldBook(database, userId, book.id).updatedAt;
  updateEntry(database, userId, book.id, entry.id, { content: 'Concurrent edit' });
  database.prepare('UPDATE world_books SET updated_at = ? WHERE id = ?').run(timestamp, book.id);
  assert.throws(() => applyWorldBookChanges(database, userId, {
    requestId: 'conflict', changes: [newChange('Rolled back new book'), stale]
  }), (error) => error.status === 409 && error.code === 'WORLD_BOOK_REVISION_CONFLICT');
  assert.equal(getWorldBook(database, userId, book.id).entries[0].content, 'Concurrent edit');
  assert.equal(listWorldBooks(database, userId).length, 1);
});

test('foreign books and entries reject the entire change batch', (t) => {
  const { database, userId, book } = fixture(t);
  const otherUserId = 'world-change-other';
  insertUser(database, otherUserId);
  const foreignBook = createWorldBook(database, otherUserId, { name: 'Private other book' });
  const foreignEntry = createEntry(database, otherUserId, foreignBook.id, { content: 'Private content' });
  const original = getWorldBook(database, userId, book.id);
  assert.throws(() => applyWorldBookChanges(database, userId, {
    requestId: 'foreign-book', changes: [newChange('Should roll back'), {
      ref: 'foreign', bookId: foreignBook.id, baseRevision: foreignBook.revision, profile: { name: 'Not permitted' }
    }]
  }), (error) => error.status === 404);
  assert.throws(() => applyWorldBookChanges(database, userId, {
    requestId: 'foreign-entry', changes: [existingChange(database, userId, book.id, {
      profile: { name: 'Also rolls back' }, upserts: [{ entryId: foreignEntry.id, patch: { content: 'Not permitted' } }]
    })]
  }), (error) => error.status === 404);
  assert.deepEqual(getWorldBook(database, userId, book.id), original);
  assert.equal(getWorldBook(database, otherUserId, foreignBook.id).entries[0].content, 'Private content');
  assert.equal(listWorldBooks(database, userId).length, 1);
});

test('empty books, profile-only edits, new upserts and removing the last entry work', (t) => {
  const { database, userId, book } = fixture(t);
  const empty = applyWorldBookChanges(database, userId, {
    requestId: 'empty-new', changes: [newChange('Empty book')]
  }).books[0].book;
  assert.deepEqual(empty.entries, []);
  const renamed = applyWorldBookChanges(database, userId, {
    requestId: 'profile-only', changes: [existingChange(database, userId, book.id, { profile: { name: 'New title' } })]
  }).books[0].book;
  assert.equal(renamed.name, 'New title');
  assert.equal(renamed.description, book.description);
  assert.equal(renamed.scanDepth, 7);
  const added = applyWorldBookChanges(database, userId, {
    requestId: 'new-upsert', changes: [existingChange(database, userId, empty.id, {
      upserts: [{ localId: 'new-entry', patch: { content: 'First content', enabled: false, alwaysActive: true } }]
    })]
  }).books[0].book;
  assert.equal(added.entries.length, 1);
  assert.equal(added.entries[0].enabled, false);
  const removed = applyWorldBookChanges(database, userId, {
    requestId: 'remove-last', changes: [existingChange(database, userId, empty.id, { removals: [added.entries[0].id] })]
  }).books[0].book;
  assert.deepEqual(removed.entries, []);
});

test('durable retries survive connection restart, return the latest book and do not recreate deleted books', (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flai-world-change-test-'));
  const filename = path.join(directory, 'retry.sqlite');
  let database = createAppDatabase(filename);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const userId = 'durable-world-owner';
  insertUser(database, userId);
  const payload = { requestId: 'persistent-request', changes: [newChange()] };
  const first = applyWorldBookChanges(database, userId, payload);
  const bookId = first.books[0].book.id;
  database.close();
  database = createAppDatabase(filename);
  updateWorldBook(database, userId, bookId, { description: 'Later edit' });
  const retried = applyWorldBookChanges(database, userId, payload);
  assert.equal(retried.books[0].book.id, bookId);
  assert.equal(retried.books[0].book.description, 'Later edit');
  assert.equal(listWorldBooks(database, userId).length, 1);
  assert.deepEqual(JSON.parse(database.prepare('SELECT result_json FROM world_book_change_requests').get().result_json), [
    { ref: 'new:New book', bookId }
  ]);
  assert.throws(() => applyWorldBookChanges(database, userId, {
    ...payload, changes: [newChange('Changed request')]
  }), (error) => error.status === 409 && error.code === 'WORLD_BOOK_REQUEST_REUSED');
  deleteWorldBook(database, userId, bookId);
  assert.throws(() => applyWorldBookChanges(database, userId, payload), (error) => error.status === 409);
  assert.equal(listWorldBooks(database, userId).length, 0);
});

test('request ids are scoped to the current user', (t) => {
  const { database, userId } = fixture(t);
  const otherUserId = 'request-other-owner';
  insertUser(database, otherUserId);
  const payload = { requestId: 'shared-request-name', changes: [newChange()] };
  const first = applyWorldBookChanges(database, userId, payload).books[0].book;
  const second = applyWorldBookChanges(database, otherUserId, payload).books[0].book;
  assert.notEqual(first.id, second.id);
  assert.equal(getWorldBook(database, userId, second.id), null);
});

test('startup creates the receipt table for existing databases without losing content', (t) => {
  const { database, userId, book } = fixture(t);
  database.exec('DROP TABLE world_book_change_requests');
  initializeDatabase(database);
  const updated = applyWorldBookChanges(database, userId, {
    requestId: 'startup-upgrade', changes: [existingChange(database, userId, book.id, { profile: { name: 'Upgrade works' } })]
  });
  assert.equal(updated.books[0].book.name, 'Upgrade works');
  assert.equal(updated.books[0].book.description, 'Original description');
});

test('revision includes trigger settings but ignores association and timestamp metadata', (t) => {
  const { database, userId, book } = fixture(t);
  createEntry(database, userId, book.id, { content: 'Entry', enabled: false, probability: 42 });
  const current = getWorldBook(database, userId, book.id);
  assert.equal(worldBookRevision({ ...current, updatedAt: 'different', linkedCharacters: ['different'] }), current.revision);
  assert.notEqual(worldBookRevision({ ...current, entries: current.entries.map((entry) => ({ ...entry, enabled: true })) }), current.revision);
});

test('workspace preview, selective transaction apply and rebase support a further edit of the created book', (t) => {
  const { database, userId, book } = fixture(t);
  const original = createEntry(database, userId, book.id, { name: 'Port', triggerKeys: 'port', content: 'Original port' });
  const workspace = createWorldBookWorkspace({ database, userId, selectedBookIds: [book.id] });
  assert.equal(executeWorldBookWorkspaceTool(workspace, 'upsert_world_book_entry', {
    entryId: original.id, changes: { content: 'Pending original edit' }
  }).ok, true);
  assert.equal(executeWorldBookWorkspaceTool(workspace, 'create_world_book', {
    localId: 'guide', name: 'Guide', entries: [{ name: 'Tide', triggerKeys: 'tide', content: 'Tide lore' }]
  }).ok, true);
  const changes = buildWorldBookChanges(workspace);
  const newBookChange = changes.find((change) => !change.bookId);
  const result = applyWorldBookChanges(database, userId, applyWorldBookChangesSchema.parse({
    requestId: 'selected-guide', changes: worldBookApplyRequest([newBookChange])
  }));
  const rebased = rebaseWorldBookWorkspace(serializeWorldBookWorkspace(workspace), result.books);
  const pending = rebased.targets.find((target) => target.bookId === book.id);
  assert.equal(pending.upserts[0].patch.content, 'Pending original edit');
  assert.equal(getWorldBook(database, userId, book.id).entries[0].content, 'Original port');
  const created = result.books[0].book;
  assert.equal(rebased.activeRef, `existing:${created.id}`);
  const continuation = createWorldBookWorkspace({ database, userId, workspace: rebased });
  assert.equal(executeWorldBookWorkspaceTool(continuation, 'upsert_world_book_entry', {
    entryId: created.entries[0].id, changes: { content: 'Revised tide lore' }
  }).ok, true);
  const final = applyWorldBookChanges(database, userId, applyWorldBookChangesSchema.parse({
    requestId: 'continued-guide', changes: worldBookApplyRequest(buildWorldBookChanges(continuation))
  }));
  assert.equal(final.books.length, 2);
  assert.equal(getWorldBook(database, userId, book.id).entries[0].content, 'Pending original edit');
  assert.equal(getWorldBook(database, userId, created.id).entries[0].content, 'Revised tide lore');
  assert.equal(listWorldBooks(database, userId).length, 2);
});

test('apply route uses sparse validation and returns actionable conflict errors', async (t) => {
  const { database, userId, book } = fixture(t);
  const entry = createEntry(database, userId, book.id, { name: 'Retained', content: 'Before', enabled: false, depth: 7 });
  const app = express();
  app.use(express.json());
  app.use('/api/world-books', createWorldBooksRouter({
    db: database,
    requireAuth: (request, _response, next) => { request.auth = { user: { id: userId } }; next(); },
    asyncRoute: (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    withListCache: (_request, response, data) => response.json(data),
    getChatProviderSettings: () => ({ ok: false, error: 'unused' }), config: { isProduction: true }
  }));
  await withServer(app, async (baseUrl) => {
    const change = existingChange(database, userId, book.id, { upserts: [{ entryId: entry.id, patch: { content: 'After' } }] });
    const post = (payload) => fetch(`${baseUrl}/api/world-books/apply-changes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const response = await post({ requestId: 'route-request', changes: [change] });
    assert.equal(response.status, 200);
    const saved = (await response.json()).books[0].book;
    assert.equal(saved.entries[0].name, 'Retained');
    assert.equal(saved.entries[0].enabled, false);
    assert.equal(saved.entries[0].depth, 7);
    assert.equal(saved.scanDepth, 7);
    assert.equal(saved.entries[0].content, 'After');
    const conflict = await post({ requestId: 'route-stale', changes: [change] });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'WORLD_BOOK_REVISION_CONFLICT');
    const invalid = await post({ requestId: 'route-invalid', changes: [{ ...change, baseRevision: undefined }] });
    assert.equal(invalid.status, 400);
    assert.equal((await post({ requestId: 'route-request', changes: [change] })).status, 200);
  });
});
