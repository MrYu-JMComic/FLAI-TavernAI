// Consolidate character <-> world book links onto `character_world_books`.
//
// `world_books.character_id` was a second, independent way to attach a book to a
// character: the world book form wrote the column, the character editor wrote the
// junction table, and the chat runtime read both. That made "which character owns
// this book" answerable two different ways.
//
// This migration backfills every direct column value into the junction table and
// then drops the column, so the junction is the only source of truth.
import { createWorldBookFtsTriggers, dropWorldBookFtsTriggers } from './0007FullTextSearch.js';

export function migrateWorldBookLinkConsolidation(database) {
  const columns = database.prepare('PRAGMA table_info(world_books)').all();
  if (!columns.some((column) => column.name === 'character_id')) {
    return;
  }

  // Only links whose character and book share an owner were ever honoured at
  // runtime, so only those are carried over.
  //
  // The backfilled row is stamped with the migration time, not the book's
  // created_at. Primary is derived as ORDER BY order_index, created_at, rowid, and
  // the pre-0019 reader checked the junction table FIRST and used the direct
  // column only as a fallback. Stamping the book's (older) created_at would sort
  // the backfilled row ahead of a link the user made in the character editor and
  // silently hand it primary, inverting the old precedence.
  database.prepare(
    `INSERT OR IGNORE INTO character_world_books (character_id, world_book_id, order_index, created_at)
     SELECT wb.character_id, wb.id, 0, ?
     FROM world_books wb
     JOIN characters c ON c.id = wb.character_id AND c.user_id = wb.user_id
     WHERE wb.character_id IS NOT NULL AND wb.character_id <> ''`
  ).run(new Date().toISOString());

  dropWorldBooksCharacterColumn(database);
}

/**
 * `character_id` carries both an index and a foreign key, so SQLite refuses
 * `ALTER TABLE ... DROP COLUMN`. Rebuild the table instead, matching the column
 * order a fresh database gets from schema.js plus its two ensureColumn additions.
 *
 * The world book FTS triggers are dropped around the rebuild: SQLite reparses
 * every trigger during `ALTER TABLE ... RENAME`, and those triggers name
 * `world_books`, which does not exist between the DROP and the RENAME. Leaving
 * them in place aborts the rename with "no such table: main.world_books".
 */
function dropWorldBooksCharacterColumn(database) {
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN');
  try {
    dropWorldBookFtsTriggers(database);
    database.exec(`
      DROP INDEX IF EXISTS idx_world_books_character;

      CREATE TABLE world_books_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        scan_depth INTEGER NOT NULL DEFAULT 1,
        lorebook_context_percent INTEGER NOT NULL DEFAULT 25,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO world_books_new (id, user_id, name, description, created_at, updated_at, scan_depth, lorebook_context_percent)
        SELECT id, user_id, name, COALESCE(description, ''), created_at, updated_at,
               COALESCE(scan_depth, 1), COALESCE(lorebook_context_percent, 25)
        FROM world_books;

      DROP TABLE world_books;
      ALTER TABLE world_books_new RENAME TO world_books;
    `);
    createWorldBookFtsTriggers(database);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}
