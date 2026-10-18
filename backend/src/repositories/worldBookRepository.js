// The only place world book SQL lives. No business rules, no validation, no
// calls into services: callers pass already-normalized values and get rows back.
//
// Tables owned here: world_books, world_book_entries, character_world_books.
// Conversation-scoped trigger state lives in worldBookStateService.js.
import { nowIso } from '../security.js';

// -- World book reads --

// `character_id` is no longer a column on world_books (migration 0019). It is
// derived as the book's primary junction link so the API contract is unchanged.
const PRIMARY_LINKED_CHARACTER_SUBQUERY = `(
       SELECT cwb.character_id
       FROM character_world_books cwb
       JOIN characters c ON c.id = cwb.character_id AND c.user_id = wb.user_id
       WHERE cwb.world_book_id = wb.id
       ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC
       LIMIT 1
     ) AS character_id`;

export function listOwnedWorldBookRows(database, userId) {
  return database.prepare(
    `SELECT wb.*,
       (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count,
       ${PRIMARY_LINKED_CHARACTER_SUBQUERY}
     FROM world_books wb
     WHERE wb.user_id = ?
     ORDER BY wb.updated_at DESC, wb.rowid DESC`
  ).all(userId);
}

export function readOwnedWorldBookWithCount(database, userId, bookId) {
  return database.prepare(
    `SELECT wb.*,
       (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count,
       ${PRIMARY_LINKED_CHARACTER_SUBQUERY}
     FROM world_books wb
     WHERE wb.id = ? AND wb.user_id = ?`
  ).get(bookId, userId) || null;
}

export function readOwnedWorldBookRow(database, userId, bookId) {
  return database.prepare('SELECT * FROM world_books WHERE id = ? AND user_id = ?')
    .get(bookId, userId) || null;
}

export function ownedWorldBookExists(database, userId, bookId) {
  return Boolean(database.prepare('SELECT id FROM world_books WHERE id = ? AND user_id = ?').get(bookId, userId));
}

export function readOwnedWorldBookByName(database, userId, name) {
  return database.prepare('SELECT id, name FROM world_books WHERE user_id = ? AND name = ? COLLATE NOCASE')
    .get(userId, name) || null;
}

/** Oldest-first listing used by deterministic dumps (project snapshot, export). */
export function listOwnedWorldBookRowsAscending(database, userId) {
  return database.prepare(
    `SELECT wb.*, ${PRIMARY_LINKED_CHARACTER_SUBQUERY}
     FROM world_books wb
     WHERE wb.user_id = ?
     ORDER BY wb.updated_at ASC, wb.rowid ASC`
  ).all(userId);
}

export function listOwnedWorldBookRowsByIds(database, userId, bookIds) {
  if (!bookIds.length) return [];
  const placeholders = bookIds.map(() => '?').join(', ');
  return database.prepare(
    `SELECT id, name, description, created_at, updated_at
     FROM world_books
     WHERE user_id = ? AND id IN (${placeholders})
     ORDER BY created_at ASC, rowid ASC`
  ).all(userId, ...bookIds);
}

/** Full link rows (character, order, timestamp) for one book. */
export function listWorldBookCharacterLinks(database, bookId) {
  return database.prepare(
    `SELECT character_id, order_index, created_at
     FROM character_world_books
     WHERE world_book_id = ?
     ORDER BY order_index ASC, created_at ASC`
  ).all(bookId);
}

/** Owner-scoped characters linked to a world book, with their link order. */
export function listOwnedWorldBookCharacterLinks(database, userId, bookId) {
  return database.prepare(
    `SELECT characters.id, characters.name, character_world_books.order_index,
            character_world_books.created_at
     FROM character_world_books
     JOIN characters ON characters.id = character_world_books.character_id
     WHERE character_world_books.world_book_id = ? AND characters.user_id = ?
     ORDER BY character_world_books.order_index ASC, character_world_books.created_at ASC, character_world_books.rowid ASC`
  ).all(bookId, userId);
}

/** Owner-scoped world books linked to a character, with their link order. */
export function listOwnedCharacterWorldBookLinks(database, userId, characterId) {
  return database.prepare(
    `SELECT world_books.id, world_books.name, character_world_books.order_index,
            character_world_books.created_at
     FROM character_world_books
     JOIN world_books ON world_books.id = character_world_books.world_book_id
     WHERE character_world_books.character_id = ? AND world_books.user_id = ?
     ORDER BY character_world_books.order_index ASC, character_world_books.created_at ASC, character_world_books.rowid ASC`
  ).all(characterId, userId);
}

/** Total stored characters across a user's world books and their entries. */
export function sumWorldBookStorageBytes(database, userId) {
  const books = database.prepare(
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(name, '')) + LENGTH(COALESCE(description, ''))
     ), 0) AS bytes FROM world_books WHERE user_id = ?`
  ).get(userId).bytes;
  const entries = database.prepare(
    `SELECT COALESCE(SUM(
       LENGTH(COALESCE(entries.name, '')) + LENGTH(COALESCE(entries.trigger_keys, '')) +
       LENGTH(COALESCE(entries.keys_secondary, '')) + LENGTH(COALESCE(entries.content, ''))
     ), 0) AS bytes
     FROM world_book_entries AS entries
     JOIN world_books AS books ON books.id = entries.world_book_id
     WHERE books.user_id = ?`
  ).get(userId).bytes;
  return Number(books) + Number(entries);
}

/** Full-text ranked entry search, joined back to the entries for enabled state. */
export function searchWorldBookEntryRows(database, matchQuery, userId, limit) {
  return database.prepare(
    `SELECT source.entity_id, source.world_book_id, source.name, source.content,
            entries.created_at, bm25(fts_world_book_entries, 0, 0, 0, 2.0, 1.5, 1.0) AS text_rank
     FROM fts_world_book_entries source
     JOIN world_book_entries entries ON entries.id = source.entity_id
     WHERE fts_world_book_entries MATCH ? AND source.user_id = ? AND entries.enabled = 1
     ORDER BY text_rank ASC LIMIT ?`
  ).all(matchQuery, userId, limit);
}

export function readOwnedCharacterRow(database, userId, characterId) {
  const id = String(characterId || '').trim();
  return id
    ? database.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(id, userId) || null
    : null;
}

// -- World book writes --

export function insertWorldBookRecord(database, record) {
  database.prepare(
    `INSERT INTO world_books (id, user_id, name, description, scan_depth, lorebook_context_percent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.userId,
    record.name,
    record.description,
    record.scanDepth,
    record.lorebookContextPercent,
    record.createdAt,
    record.updatedAt
  );
}

export function updateWorldBookRecord(database, userId, bookId, record) {
  return database.prepare(
    `UPDATE world_books
     SET name = ?, description = ?, scan_depth = ?, lorebook_context_percent = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    record.name,
    record.description,
    record.scanDepth,
    record.lorebookContextPercent,
    record.updatedAt,
    bookId,
    userId
  ).changes;
}

export function deleteWorldBookRecord(database, userId, bookId) {
  return database.prepare('DELETE FROM world_books WHERE id = ? AND user_id = ?')
    .run(bookId, userId).changes;
}

export function touchWorldBookRecord(database, bookId) {
  database.prepare('UPDATE world_books SET updated_at = ? WHERE id = ?').run(nowIso(), bookId);
}

// Durable receipts contain only ref -> book id mappings, never book contents.
export function readWorldBookChangeRequest(database, userId, requestId) {
  return database.prepare(
    'SELECT payload_hash, result_json FROM world_book_change_requests WHERE user_id = ? AND request_id = ?'
  ).get(userId, requestId) || null;
}

export function insertWorldBookChangeRequest(database, userId, requestId, payloadHash, books) {
  database.prepare(
    `INSERT INTO world_book_change_requests (user_id, request_id, payload_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, requestId, payloadHash, JSON.stringify(books), nowIso());
}

export function updateWorldBookProfilePatchRecord(database, userId, bookId, patch) {
  const columns = {
    name: 'name', description: 'description', scanDepth: 'scan_depth',
    lorebookContextPercent: 'lorebook_context_percent'
  };
  const keys = Object.keys(patch).filter((key) => Object.hasOwn(columns, key));
  if (!keys.length) return 0;
  return database.prepare(
    `UPDATE world_books SET ${keys.map((key) => `${columns[key]} = ?`).join(', ')}, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(...keys.map((key) => patch[key]), nowIso(), bookId, userId).changes;
}

// -- Entry reads --

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

export function readMaxEntryOrderIndex(database, bookId) {
  const row = database
    .prepare('SELECT MAX(order_index) AS max_order FROM world_book_entries WHERE world_book_id = ?')
    .get(bookId);
  return Number(row?.max_order ?? -1);
}

/** Enabled entries across several books, joined with the fields matching needs. */
export function listEnabledEntryRowsForBooks(database, bookIds) {
  if (!bookIds.length) return [];
  const placeholders = bookIds.map(() => '?').join(',');
  return database.prepare(
    `SELECT wbe.*, wb.name AS world_book_name, wb.scan_depth AS book_scan_depth
     FROM world_book_entries wbe
     JOIN world_books wb ON wb.id = wbe.world_book_id
     WHERE wbe.world_book_id IN (${placeholders}) AND wbe.enabled = 1
     ORDER BY wbe.order_index ASC, wbe.rowid ASC`
  ).all(...bookIds);
}

export function readMaxLorebookContextPercent(database, bookIds) {
  if (!bookIds.length) return null;
  const placeholders = bookIds.map(() => '?').join(',');
  const row = database
    .prepare(`SELECT MAX(lorebook_context_percent) AS max_pct FROM world_books WHERE id IN (${placeholders})`)
    .get(...bookIds);
  return row?.max_pct ?? null;
}

// -- Entry writes --

export function insertWorldBookEntryRecord(database, record) {
  const data = record.data;
  database.prepare(
    `INSERT INTO world_book_entries (
      id, world_book_id, name, trigger_keys, content, position, enabled, order_index, regex_mode, always_active, depth, selective, selective_logic, keys_secondary, probability, use_probability, inclusion_group, group_weight, role, sticky, cooldown, delay, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.bookId,
    data.name,
    data.triggerKeys,
    data.content,
    data.position,
    data.enabled ? 1 : 0,
    record.orderIndex,
    data.regexMode,
    data.alwaysActive,
    data.depth,
    data.selective,
    data.selectiveLogic,
    data.keysSecondary,
    data.probability,
    data.useProbability,
    data.group,
    data.groupWeight,
    data.role,
    data.sticky,
    data.cooldown,
    data.delay,
    record.createdAt
  );
}

export function updateWorldBookEntryRecord(database, bookId, entryId, data) {
  return database.prepare(
    `UPDATE world_book_entries
     SET name = ?, trigger_keys = ?, content = ?, position = ?, enabled = ?, order_index = ?, regex_mode = ?, always_active = ?, depth = ?, selective = ?, selective_logic = ?, keys_secondary = ?, probability = ?, use_probability = ?, inclusion_group = ?, group_weight = ?, role = ?, sticky = ?, cooldown = ?, delay = ?
     WHERE id = ? AND world_book_id = ?`
  ).run(
    data.name,
    data.triggerKeys,
    data.content,
    data.position,
    data.enabled ? 1 : 0,
    data.orderIndex,
    data.regexMode,
    data.alwaysActive,
    data.depth,
    data.selective,
    data.selectiveLogic,
    data.keysSecondary,
    data.probability,
    data.useProbability,
    data.group,
    data.groupWeight,
    data.role,
    data.sticky,
    data.cooldown,
    data.delay,
    entryId,
    bookId
  ).changes;
}

export function deleteWorldBookEntryRecord(database, bookId, entryId) {
  return database.prepare('DELETE FROM world_book_entries WHERE id = ? AND world_book_id = ?')
    .run(entryId, bookId).changes;
}

export function updateWorldBookEntryPatchRecord(database, bookId, entryId, patch) {
  const columns = {
    name: 'name', triggerKeys: 'trigger_keys', content: 'content', position: 'position',
    enabled: 'enabled', orderIndex: 'order_index', regexMode: 'regex_mode',
    alwaysActive: 'always_active', depth: 'depth', selective: 'selective',
    selectiveLogic: 'selective_logic', keysSecondary: 'keys_secondary',
    probability: 'probability', useProbability: 'use_probability', group: 'inclusion_group',
    groupWeight: 'group_weight', role: 'role', sticky: 'sticky', cooldown: 'cooldown', delay: 'delay'
  };
  const keys = Object.keys(patch).filter((key) => Object.hasOwn(columns, key));
  if (!keys.length) return 0;
  return database.prepare(
    `UPDATE world_book_entries SET ${keys.map((key) => `${columns[key]} = ?`).join(', ')}
     WHERE id = ? AND world_book_id = ?`
  ).run(...keys.map((key) => typeof patch[key] === 'boolean' ? Number(patch[key]) : patch[key]), entryId, bookId).changes;
}

// -- Character link reads --

export function listLinkedCharacterIds(database, userId, bookId) {
  return database.prepare(
    `SELECT cwb.character_id
     FROM character_world_books cwb
     JOIN characters c ON c.id = cwb.character_id
     WHERE cwb.world_book_id = ? AND c.user_id = ?
     ORDER BY cwb.created_at ASC, cwb.rowid ASC`
  ).all(bookId, userId).map((row) => row.character_id);
}

export function listCharacterWorldBookRows(database, characterId) {
  return database.prepare(
    `SELECT wb.*,
      (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count,
      ${PRIMARY_LINKED_CHARACTER_SUBQUERY},
      link.order_index AS link_order
     FROM character_world_books link
     JOIN world_books wb ON wb.id = link.world_book_id
     JOIN characters c ON c.id = link.character_id AND c.user_id = wb.user_id
     WHERE link.character_id = ?
     ORDER BY link.order_index ASC, link.created_at ASC, link.rowid ASC`
  ).all(characterId);
}

/** Book ids linked to a character through the junction table, in link order. */
export function listLinkedBookIdRowsForCharacters(database, characterIds) {
  if (!characterIds.length) return [];
  const placeholders = characterIds.map(() => '?').join(', ');
  return database.prepare(
    `SELECT cwb.character_id, cwb.world_book_id AS id
     FROM character_world_books cwb
     JOIN world_books wb ON wb.id = cwb.world_book_id
     JOIN characters c ON c.id = cwb.character_id
       AND c.user_id = wb.user_id
     WHERE cwb.character_id IN (${placeholders})
     ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
  ).all(...characterIds);
}

// -- Character link writes --

export function upsertCharacterWorldBookLink(database, bookId, characterId, orderIndex) {
  database.prepare(
    `INSERT OR REPLACE INTO character_world_books (character_id, world_book_id, order_index, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(characterId, bookId, orderIndex, nowIso());
}

export function deleteCharacterWorldBookLink(database, bookId, characterId) {
  return database.prepare('DELETE FROM character_world_books WHERE world_book_id = ? AND character_id = ?')
    .run(bookId, characterId).changes;
}

// -- Conversation lookups used by the chat runtime --

export function conversationExists(database, conversationId) {
  return Boolean(database.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId));
}

export function readConversationChatLorebookId(database, conversationId) {
  const row = database
    .prepare('SELECT chat_lorebook_id FROM conversations WHERE id = ?')
    .get(conversationId);
  return row?.chat_lorebook_id || null;
}

export function listOwnedLinkedBookIdsForCharacter(database, userId, characterId) {
  return database.prepare(
    `SELECT wb.id
     FROM character_world_books cwb
     JOIN world_books wb ON wb.id = cwb.world_book_id
     JOIN characters c ON c.id = cwb.character_id AND c.user_id = wb.user_id
     WHERE cwb.character_id = ? AND wb.user_id = ?
     ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
  ).all(characterId, userId);
}

export function readOwnedConversationLorebookId(database, userId, conversationId) {
  const row = database.prepare(
    `SELECT wb.id
     FROM conversations c
     JOIN world_books wb ON wb.id = c.chat_lorebook_id AND wb.user_id = c.user_id
     WHERE c.id = ? AND c.user_id = ?`
  ).get(conversationId, userId);
  return row?.id || null;
}

// -- Conversation-scoped trigger state --
//
// `conversation_world_book_clock` holds one message counter per conversation and
// `conversation_world_book_state` the per-entry sticky / cooldown / delay window.
// Both are always keyed by conversation: the process-global predecessors were
// dropped in migration 0020.

export function readConversationWorldBookClock(database, conversationId) {
  const row = database
    .prepare('SELECT message_count FROM conversation_world_book_clock WHERE conversation_id = ?')
    .get(conversationId);
  return row?.message_count ?? null;
}

export function bumpConversationWorldBookClock(database, conversationId, messageCount) {
  database.prepare(
    `INSERT INTO conversation_world_book_clock (conversation_id, message_count) VALUES (?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET message_count = MAX(message_count, excluded.message_count)`
  ).run(conversationId, messageCount);
}

export function insertConversationWorldBookClock(database, conversationId, messageCount) {
  database.prepare('INSERT INTO conversation_world_book_clock (conversation_id, message_count) VALUES (?, ?)')
    .run(conversationId, messageCount);
}

export function deleteConversationWorldBookClock(database, conversationId) {
  database.prepare('DELETE FROM conversation_world_book_clock WHERE conversation_id = ?').run(conversationId);
}

export function listConversationEntryStateRows(database, conversationId, entryIds) {
  if (!entryIds.length) return [];
  const placeholders = entryIds.map(() => '?').join(',');
  return database.prepare(
    `SELECT * FROM conversation_world_book_state
     WHERE conversation_id = ? AND entry_id IN (${placeholders})`
  ).all(conversationId, ...entryIds);
}

export function listConversationEntryStateSnapshot(database, conversationId) {
  return database
    .prepare('SELECT * FROM conversation_world_book_state WHERE conversation_id = ? ORDER BY entry_id')
    .all(conversationId);
}

/** Write the whole batch on prepared statements so a long chat stays one pass. */
export function writeConversationEntryStates(database, conversationId, rows) {
  if (!rows.length) return;
  const insert = database.prepare(
    'INSERT OR IGNORE INTO conversation_world_book_state (entry_id, conversation_id) VALUES (?, ?)'
  );
  const update = database.prepare(
    `UPDATE conversation_world_book_state
     SET last_activated_message = ?, last_deactivated_message = ?, first_seen_message = ?,
         sticky_remaining = ?, was_active = ?
     WHERE entry_id = ? AND conversation_id = ?`
  );
  for (const row of rows) {
    insert.run(row.entryId, conversationId);
    update.run(
      row.lastActivatedMessage,
      row.lastDeactivatedMessage,
      row.firstSeenMessage,
      row.stickyRemaining,
      row.wasActive ? 1 : 0,
      row.entryId,
      conversationId
    );
  }
}
export function deleteConversationWorldBookState(database, conversationId) {
  database.prepare('DELETE FROM conversation_world_book_state WHERE conversation_id = ?').run(conversationId);
}

/** Restore only rows whose entry still exists, so a stale save cannot resurrect one. */
export function restoreConversationEntryStateRows(database, conversationId, rows) {
  if (!rows.length) return;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO conversation_world_book_state
       (conversation_id, entry_id, last_activated_message, last_deactivated_message, first_seen_message, sticky_remaining, was_active)
     SELECT ?, id, ?, ?, ?, ?, ? FROM world_book_entries WHERE id = ?`
  );
  for (const row of rows) {
    insert.run(
      conversationId,
      row.lastActivatedMessage,
      row.lastDeactivatedMessage,
      row.firstSeenMessage,
      row.stickyRemaining,
      row.wasActive ? 1 : 0,
      row.entryId
    );
  }
}
