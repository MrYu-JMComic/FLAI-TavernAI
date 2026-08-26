import { nowIso } from '../security.js';

export function listOwnedWorldBookRows(database, userId) {
  return database.prepare(
    `SELECT wb.*,
       (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
     FROM world_books wb
     WHERE wb.user_id = ?
     ORDER BY wb.updated_at DESC, wb.rowid DESC`
  ).all(userId);
}

export function readOwnedWorldBookWithCount(database, userId, bookId) {
  return database.prepare(
    `SELECT wb.*,
       (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
     FROM world_books wb
     WHERE wb.id = ? AND wb.user_id = ?`
  ).get(bookId, userId) || null;
}

export function readOwnedWorldBookRow(database, userId, bookId) {
  return database.prepare('SELECT * FROM world_books WHERE id = ? AND user_id = ?')
    .get(bookId, userId) || null;
}

export function readOwnedCharacterRow(database, userId, characterId) {
  const id = String(characterId || '').trim();
  return id
    ? database.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(id, userId) || null
    : null;
}

export function listWorldBookEntryRows(database, bookId) {
  return database.prepare(
    `SELECT * FROM world_book_entries
     WHERE world_book_id = ?
     ORDER BY order_index ASC, rowid ASC`
  ).all(bookId);
}

export function readWorldBookEntryRow(database, entryId) {
  return database.prepare('SELECT * FROM world_book_entries WHERE id = ?').get(entryId) || null;
}

export function listLinkedCharacterIds(database, userId, bookId) {
  return database.prepare(
    `SELECT cwb.character_id
     FROM character_world_books cwb
     JOIN characters c ON c.id = cwb.character_id
     WHERE cwb.world_book_id = ? AND c.user_id = ?
     ORDER BY cwb.created_at ASC, cwb.rowid ASC`
  ).all(bookId, userId).map((row) => row.character_id);
}

export function touchWorldBookRecord(database, bookId) {
  database.prepare('UPDATE world_books SET updated_at = ? WHERE id = ?').run(nowIso(), bookId);
}
