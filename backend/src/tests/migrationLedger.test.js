import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { latestSchemaVersion, listAppliedMigrations } from '../db/migrations.js';
import { createCharacter } from '../modules/characters.js';
import { getWorldBook, resolveCharacterWorldBookId } from '../services/worldBooks/worldBookService.js';
import { insertUser } from './routeTestUtils.js';

test('migration ledger records deterministic checksums and replays idempotently', () => {
  const database = createAppDatabase(':memory:');
  try {
    const first = listAppliedMigrations(database);
    assert.equal(first.at(-1)?.version, latestSchemaVersion);
    assert.equal(first.length, 26);
    assert.deepEqual(first.slice(-12).map((row) => row.version), ['0019', '0020', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036']);
    for (const row of first) {
      assert.match(row.checksum, /^[a-f0-9]{64}$/);
    }
    initializeDatabase(database);
    assert.deepEqual(listAppliedMigrations(database), first);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});
test('existing schemas without a ledger are adopted on the next initialization', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.exec('DROP TABLE schema_migrations');
    initializeDatabase(database);
    assert.equal(listAppliedMigrations(database).length, 26);
  } finally {
    database.close();
  }
});

test('provider profile migration adopts legacy settings as the selected provider', () => {
  const database = createAppDatabase(':memory:');
  try {
    const userId = 'migration-provider-profile-user';
    insertUser(database, userId);
    database.prepare(
      `INSERT INTO provider_settings (
        user_id, provider_type, gateway_name, base_url, model, encrypted_api_key,
        api_key_hint, supports_reasoning, allow_private_network, extra_body, updated_at
      ) VALUES (?, 'openai', 'Legacy OpenAI', 'https://api.openai.com/v1', 'gpt-4.1-mini',
                NULL, NULL, 0, 0, '{}', '2026-08-25T00:00:00.000Z')`
    ).run(userId);
    database.prepare("DELETE FROM schema_migrations WHERE version = '0009'").run();

    initializeDatabase(database);

    const selected = database.prepare(
      `SELECT presets.*
       FROM provider_selections selection
       JOIN provider_presets presets ON presets.id = selection.provider_id
       WHERE selection.user_id = ?`
    ).get(userId);
    assert.equal(selected.gateway_name, 'Legacy OpenAI');
    assert.equal(selected.model, 'gpt-4.1-mini');
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS count FROM provider_presets WHERE user_id = ?'
    ).get(userId).count, 1);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('world book link consolidation backfills the junction and drops the direct column', () => {
  const database = createAppDatabase(':memory:');
  try {
    const userId = 'migration-world-book-link-user';
    const otherId = 'migration-world-book-link-other';
    insertUser(database, userId);
    insertUser(database, otherId);
    const ownCharacter = createCharacter(database, userId, { name: 'Legacy Character' });
    const foreignCharacter = createCharacter(database, otherId, { name: 'Foreign Character' });
    const timestamp = '2026-08-25T00:00:00.000Z';

    // Rebuild the pre-0019 shape, then replay the migration over it.
    database.exec(`
      ALTER TABLE world_books ADD COLUMN character_id TEXT;
      DELETE FROM schema_migrations WHERE version = '0019';
    `);
    const insertLegacyBook = database.prepare(
      `INSERT INTO world_books (id, user_id, name, description, character_id, scan_depth, lorebook_context_percent, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, 1, 25, ?, ?)`
    );
    insertLegacyBook.run('legacy-book', userId, 'Legacy Book', ownCharacter.id, timestamp, timestamp);
    // A cross-owner binding was never honoured at runtime and must not be carried over.
    insertLegacyBook.run('foreign-book', userId, 'Foreign Book', foreignCharacter.id, timestamp, timestamp);

    initializeDatabase(database);

    const columns = database.prepare('PRAGMA table_info(world_books)').all().map((column) => column.name);
    assert.equal(columns.includes('character_id'), false);
    assert.deepEqual(
      database.prepare('SELECT character_id, order_index FROM character_world_books WHERE world_book_id = ?')
        .all('legacy-book')
        .map((row) => ({ characterId: row.character_id, orderIndex: row.order_index })),
      [{ characterId: ownCharacter.id, orderIndex: 0 }]
    );
    assert.deepEqual(
      database.prepare('SELECT character_id FROM character_world_books WHERE world_book_id = ?')
        .all('foreign-book')
        .map((row) => row.character_id),
      []
    );
    // The rebuilt table keeps its rows, settings and foreign keys intact.
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM world_books').get().count, 2);
    assert.equal(
      database.prepare('SELECT lorebook_context_percent FROM world_books WHERE id = ?').get('legacy-book').lorebook_context_percent,
      25
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('world book link consolidation leaves an existing junction link as primary', () => {
  const database = createAppDatabase(':memory:');
  try {
    const userId = 'migration-world-book-primary-user';
    insertUser(database, userId);
    const editorCharacter = createCharacter(database, userId, { name: 'Linked In Editor' });
    const formCharacter = createCharacter(database, userId, { name: 'Set In Form' });
    const bookCreatedAt = '2026-06-06T00:00:00.000Z';
    const linkCreatedAt = '2026-06-20T00:00:00.000Z';

    database.exec(`
      ALTER TABLE world_books ADD COLUMN character_id TEXT;
      DELETE FROM schema_migrations WHERE version = '0019';
    `);
    database.prepare(
      `INSERT INTO world_books (id, user_id, name, description, character_id, scan_depth, lorebook_context_percent, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, 1, 25, ?, ?)`
    ).run('primary-book', userId, 'Primary Book', formCharacter.id, bookCreatedAt, bookCreatedAt);
    // A link the user made in the character editor, newer than the book itself.
    database.prepare(
      `INSERT INTO character_world_books (character_id, world_book_id, order_index, created_at)
       VALUES (?, ?, 0, ?)`
    ).run(editorCharacter.id, 'primary-book', linkCreatedAt);

    initializeDatabase(database);

    // Both links survive, but the pre-existing one keeps primary: the pre-0019
    // reader checked the junction first and used the direct column only as a
    // fallback, so the migration must not invert that.
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM character_world_books WHERE world_book_id = ?').get('primary-book').count,
      2
    );
    assert.equal(resolveCharacterWorldBookId(database, editorCharacter.id), 'primary-book');
    assert.equal(
      getWorldBook(database, userId, 'primary-book').characterId,
      editorCharacter.id
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('global world book state removal drops the table and leaves conversation state intact', () => {
  const database = createAppDatabase(':memory:');
  try {
    const userId = 'migration-world-book-state-user';
    insertUser(database, userId);
    const character = createCharacter(database, userId, { name: 'State Character' });
    const timestamp = '2026-08-25T00:00:00.000Z';
    database.prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('state-conversation', userId, character.id, 'State', timestamp, timestamp);
    database.prepare(
      `INSERT INTO world_books (id, user_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`
    ).run('state-book', userId, 'State Book', timestamp, timestamp);
    database.prepare(
      `INSERT INTO world_book_entries (id, world_book_id, name, trigger_keys, content, enabled, order_index, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?)`
    ).run('state-entry', 'state-book', 'Entry', 'lantern', 'lore', timestamp);
    database.prepare(
      `INSERT INTO conversation_world_book_state (conversation_id, entry_id, sticky_remaining, was_active)
       VALUES (?, ?, 2, 1)`
    ).run('state-conversation', 'state-entry');

    // Rebuild the pre-0020 shape, then replay the migration over it.
    database.exec(`
      CREATE TABLE world_book_entry_state (
        entry_id TEXT PRIMARY KEY,
        last_activated_message INTEGER DEFAULT 0,
        last_deactivated_message INTEGER DEFAULT 0,
        first_seen_message INTEGER DEFAULT 0,
        sticky_remaining INTEGER DEFAULT 0,
        was_active INTEGER DEFAULT 0,
        FOREIGN KEY (entry_id) REFERENCES world_book_entries(id) ON DELETE CASCADE
      );
      DELETE FROM schema_migrations WHERE version = '0020';
    `);
    database.prepare('INSERT INTO world_book_entry_state (entry_id, sticky_remaining) VALUES (?, 9)')
      .run('state-entry');

    initializeDatabase(database);

    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'world_book_entry_state'").get().count,
      0
    );
    // Conversation-scoped state is untouched; the global row is simply discarded.
    assert.deepEqual(
      database.prepare('SELECT sticky_remaining, was_active FROM conversation_world_book_state WHERE conversation_id = ?')
        .all('state-conversation')
        .map((row) => ({ stickyRemaining: row.sticky_remaining, wasActive: row.was_active })),
      [{ stickyRemaining: 2, wasActive: 1 }]
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});

test('migration checksum drift stops startup with the exact version', () => {
  const database = createAppDatabase(':memory:');
  try {
    database.prepare("UPDATE schema_migrations SET checksum = 'changed' WHERE version = '0002'").run();
    assert.throws(() => initializeDatabase(database), /Migration 0002 checksum mismatch/);
  } finally {
    database.close();
  }
});
