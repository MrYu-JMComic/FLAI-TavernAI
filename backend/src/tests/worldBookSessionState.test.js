import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { createCharacter } from '../modules/characters.js';
import { createEntry, createWorldBook } from '../services/worldBooks/worldBookService.js';
import { matchWorldBookEntries } from '../services/worldBooks/worldBookRuntime.js';
import { snapshotConversationWorldBookState } from '../services/worldBooks/worldBookStateService.js';
import { createSave, loadSave } from '../modules/saves.js';
import { insertUser } from './routeTestUtils.js';

function fixture(t, entryOptions = {}) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'world-session-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Session Character' });
  for (const id of ['session-a', 'session-b']) {
    database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, character.id, id, '2026-01-01', '2026-01-01');
  }
  const book = createWorldBook(database, userId, { name: 'Session book', characterId: character.id });
  const entry = createEntry(database, userId, book.id, { name: 'Lantern', triggerKeys: 'lantern', content: 'Lantern lore.', ...entryOptions });
  const match = (conversationId, text, options = {}) => matchWorldBookEntries(database, character.id, text, { conversationId, ...options });
  return { database, userId, character, entry, match };
}

test('sticky state and counters are isolated by conversation and previews stay read-only', (t) => {
  const { database, match } = fixture(t, { sticky: 3 });
  assert.equal(match('session-a', 'lantern').length, 1);
  const before = snapshotConversationWorldBookState(database, 'session-a');
  for (let index = 0; index < 6; index += 1) {
    assert.equal(match('session-b', 'unrelated').length, 0);
    assert.equal(match('session-a', 'unrelated', { persistState: false }).length, 1);
  }
  assert.deepEqual(snapshotConversationWorldBookState(database, 'session-a'), before);
  // session-b ran its own matches, so it has its own row — but the entry never
  // activated there, and the previews on session-a wrote nothing.
  assert.equal(
    database.prepare('SELECT was_active FROM conversation_world_book_state WHERE conversation_id = ?').get('session-b').was_active,
    0
  );
  assert.equal(match('session-a', 'unrelated').length, 1);
  assert.equal(snapshotConversationWorldBookState(database, 'session-a').messageCount, 2);
  assert.equal(match('session-a', 'unrelated').length, 1);
  assert.equal(match('session-a', 'unrelated').length, 0);
});

test('delay and cooldown consume only the owning conversation turns', (t) => {
  const { database, match } = fixture(t, { delay: 2, cooldown: 2 });
  assert.equal(match('session-a', 'lantern').length, 0);
  for (let index = 0; index < 5; index += 1) match('session-b', 'lantern');
  assert.equal(match('session-a', 'lantern').length, 0);
  assert.equal(match('session-a', 'lantern').length, 1);
  assert.equal(match('session-a', 'unrelated').length, 0);
  for (let index = 0; index < 5; index += 1) match('session-b', 'unrelated');
  assert.equal(match('session-a', 'lantern').length, 0);
  assert.equal(match('session-a', 'lantern').length, 1);
  const otherBefore = snapshotConversationWorldBookState(database, 'session-b');
  database.prepare('DELETE FROM conversations WHERE id = ?').run('session-a');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_world_book_state WHERE conversation_id = ?').get('session-a').count, 0);
  assert.deepEqual(snapshotConversationWorldBookState(database, 'session-b'), otherBefore);
});

test('saving and loading restores the lore clock and activation window atomically', (t) => {
  const { database, userId, match } = fixture(t, { sticky: 3 });
  match('session-a', 'lantern');
  const before = snapshotConversationWorldBookState(database, 'session-a');
  const saved = createSave(database, userId, 'session-a', { name: 'Lore checkpoint' });
  for (let index = 0; index < 4; index += 1) match('session-a', 'unrelated');
  loadSave(database, userId, saved.id);
  assert.deepEqual(snapshotConversationWorldBookState(database, 'session-a'), before);
  assert.equal(match('session-a', 'unrelated').length, 1);
  const legacy = createSave(database, userId, 'session-a', { name: 'Legacy checkpoint' });
  database.prepare('UPDATE saves SET snapshot = ? WHERE id = ?').run(JSON.stringify({ messages: [] }), legacy.id);
  loadSave(database, userId, legacy.id);
  assert.deepEqual(snapshotConversationWorldBookState(database, 'session-a'), { messageCount: 0, entries: [] });
});

test('trigger state is conversation-scoped with no global fallback', (t) => {
  const { database, character, match } = fixture(t, { sticky: 3 });
  const globalTableCount = () => database
    .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'world_book_entry_state'")
    .get().count;

  // A match with nowhere to record its activation window is a programming error,
  // not a supported mode: the process-global table it used to fall back to is gone.
  assert.throws(
    () => matchWorldBookEntries(database, character.id, 'lantern'),
    /requires options\.conversationId/
  );
  assert.throws(
    () => snapshotConversationWorldBookState(database, ''),
    /requires a conversationId/
  );
  assert.equal(globalTableCount(), 0);

  assert.equal(match('session-a', 'lantern').length, 1);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversation_world_book_state').get().count,
    1
  );

  // Re-running schema setup is idempotent and must not resurrect the global table.
  initializeDatabase(database);
  assert.equal(globalTableCount(), 0);
  assert.equal(match('session-a', 'unrelated').length, 1);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
