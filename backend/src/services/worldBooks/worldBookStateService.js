let legacyCounters = new WeakMap();

export function nextWorldBookMessageCount(database, conversationId = '') {
  if (conversationId) return peekWorldBookMessageCount(database, conversationId);
  const next = legacyMessageCount(database) + 1;
  legacyCounters.set(database, next);
  return next;
}

export function peekWorldBookMessageCount(database, conversationId = '') {
  if (conversationId) {
    const row = database.prepare('SELECT message_count FROM conversation_world_book_clock WHERE conversation_id = ?').get(conversationId);
    return normalizeMessageCount(row?.message_count, 0) + 1;
  }
  return legacyMessageCount(database) + 1;
}

export function loadWorldBookEntryStates(database, entryIds, conversationId = '') {
  const states = new Map();
  if (!entryIds.length) return states;
  const placeholders = entryIds.map(() => '?').join(',');
  const rows = conversationId
    ? database.prepare(`SELECT * FROM conversation_world_book_state WHERE conversation_id = ? AND entry_id IN (${placeholders})`).all(conversationId, ...entryIds)
    : database.prepare(`SELECT * FROM world_book_entry_state WHERE entry_id IN (${placeholders})`).all(...entryIds);
  for (const row of rows) {
    states.set(row.entry_id, {
      last_activated_message: normalizeMessageCount(row.last_activated_message, 0),
      last_deactivated_message: normalizeMessageCount(row.last_deactivated_message, 0),
      first_seen_message: normalizeMessageCount(row.first_seen_message, 0),
      sticky_remaining: normalizeMessageCount(row.sticky_remaining, 0),
      was_active: row.was_active ? 1 : 0
    });
  }
  return states;
}

export function persistWorldBookEntryStates(database, entries, matchedIds, entryStates, messageCount, conversationId = '') {
  const table = conversationId ? 'conversation_world_book_state' : 'world_book_entry_state';
  const insert = conversationId
    ? database.prepare('INSERT OR IGNORE INTO conversation_world_book_state (entry_id, conversation_id) VALUES (?, ?)')
    : database.prepare('INSERT OR IGNORE INTO world_book_entry_state (entry_id) VALUES (?)');
  const update = database.prepare(
    `UPDATE ${table}
     SET last_activated_message = ?, last_deactivated_message = ?, first_seen_message = ?,
         sticky_remaining = ?, was_active = ?
     WHERE entry_id = ?${conversationId ? ' AND conversation_id = ?' : ''}`
  );
  for (const entry of entries) {
    const state = entryStates.get(entry.id);
    if (!state) continue;
    const isNowActive = matchedIds.has(entry.id);
    const wasActive = Boolean(state.was_active);
    if (isNowActive) {
      if (!wasActive) {
        const sticky = normalizeOptionalNumber(entry.sticky);
        if (sticky != null && sticky > 0) state.sticky_remaining = sticky;
        state.last_activated_message = messageCount;
      }
      if (state.sticky_remaining > 0) state.sticky_remaining -= 1;
      state.was_active = 1;
    } else {
      if (wasActive) {
        state.last_deactivated_message = messageCount;
        state.sticky_remaining = 0;
      }
      state.was_active = 0;
    }
    insert.run(...(conversationId ? [entry.id, conversationId] : [entry.id]));
    update.run(
      state.last_activated_message,
      state.last_deactivated_message,
      state.first_seen_message,
      state.sticky_remaining,
      state.was_active ? 1 : 0,
      entry.id,
      ...(conversationId ? [conversationId] : [])
    );
  }
  if (conversationId) {
    database.prepare(`INSERT INTO conversation_world_book_clock (conversation_id, message_count) VALUES (?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET message_count = MAX(message_count, excluded.message_count)`)
      .run(conversationId, messageCount);
  }
}

export function resetWorldBookMessageCounter() {
  legacyCounters = new WeakMap();
}

export function snapshotConversationWorldBookState(database, conversationId) {
  return {
    messageCount: peekWorldBookMessageCount(database, conversationId) - 1,
    entries: database.prepare('SELECT * FROM conversation_world_book_state WHERE conversation_id = ? ORDER BY entry_id').all(conversationId)
  };
}

export function restoreConversationWorldBookState(database, conversationId, snapshot = {}) {
  database.prepare('DELETE FROM conversation_world_book_state WHERE conversation_id = ?').run(conversationId);
  database.prepare('DELETE FROM conversation_world_book_clock WHERE conversation_id = ?').run(conversationId);
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const insert = database.prepare(`INSERT OR IGNORE INTO conversation_world_book_state
    (conversation_id, entry_id, last_activated_message, last_deactivated_message, first_seen_message, sticky_remaining, was_active)
    SELECT ?, id, ?, ?, ?, ?, ? FROM world_book_entries WHERE id = ?`);
  for (const entry of entries) {
    insert.run(conversationId, normalizeMessageCount(entry.last_activated_message, 0),
      normalizeMessageCount(entry.last_deactivated_message, 0), normalizeMessageCount(entry.first_seen_message, 0),
      normalizeMessageCount(entry.sticky_remaining, 0), entry.was_active === 1 ? 1 : 0, String(entry.entry_id || ''));
  }
  database.prepare('INSERT INTO conversation_world_book_clock (conversation_id, message_count) VALUES (?, ?)')
    .run(conversationId, normalizeMessageCount(snapshot?.messageCount, 0));
}

function legacyMessageCount(database) {
  if (legacyCounters.has(database)) return legacyCounters.get(database);
  const row = database.prepare(
    `SELECT MAX(last_activated_message) AS a, MAX(last_deactivated_message) AS d,
            MAX(first_seen_message) AS f FROM world_book_entry_state`
  ).get();
  const count = Math.max(normalizeMessageCount(row?.a, 0), normalizeMessageCount(row?.d, 0), normalizeMessageCount(row?.f, 0));
  legacyCounters.set(database, count);
  return count;
}

function normalizeMessageCount(value, fallback = 0) {
  if (typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = Math.trunc(number);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeOptionalNumber(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(9999, number)) : null;
}
