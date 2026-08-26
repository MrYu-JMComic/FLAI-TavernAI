let messageCounter = 0;
let counterInitialized = false;

export function nextWorldBookMessageCount(database) {
  ensureCounterInitialized(database);
  messageCounter = normalizeMessageCount(messageCounter, 0);
  return ++messageCounter;
}

export function peekWorldBookMessageCount(database) {
  ensureCounterInitialized(database);
  return normalizeMessageCount(messageCounter, 0) + 1;
}

export function loadWorldBookEntryStates(database, entryIds) {
  const states = new Map();
  if (!entryIds.length) return states;
  const placeholders = entryIds.map(() => '?').join(',');
  const rows = database.prepare(
    `SELECT * FROM world_book_entry_state WHERE entry_id IN (${placeholders})`
  ).all(...entryIds);
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

export function persistWorldBookEntryStates(database, entries, matchedIds, entryStates, messageCount) {
  const update = database.prepare(
    `UPDATE world_book_entry_state
     SET last_activated_message = ?, last_deactivated_message = ?, first_seen_message = ?,
         sticky_remaining = ?, was_active = ?
     WHERE entry_id = ?`
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
    update.run(
      state.last_activated_message,
      state.last_deactivated_message,
      state.first_seen_message,
      state.sticky_remaining,
      state.was_active ? 1 : 0,
      entry.id
    );
  }
}

export function resetWorldBookMessageCounter() {
  messageCounter = 0;
  counterInitialized = false;
}

function ensureCounterInitialized(database) {
  if (counterInitialized) return;
  counterInitialized = true;
  try {
    const row = database.prepare(
      `SELECT MAX(last_activated_message) AS a, MAX(last_deactivated_message) AS d,
              MAX(first_seen_message) AS f FROM world_book_entry_state`
    ).get();
    messageCounter = Math.max(
      messageCounter,
      normalizeMessageCount(row?.a, 0),
      normalizeMessageCount(row?.d, 0),
      normalizeMessageCount(row?.f, 0)
    );
  } catch {
    // The schema may not be initialized yet.
  }
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
