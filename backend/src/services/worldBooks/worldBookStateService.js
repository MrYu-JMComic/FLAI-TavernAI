// Conversation-scoped world book trigger state: the sticky / cooldown / delay
// bookkeeping for one chat.
//
// Every entry point requires a conversationId. There is no process-global
// fallback any more: the old `world_book_entry_state` table plus its in-memory
// per-database counter leaked activation state between conversations, and both
// were removed in migration 0020. SQL lives in worldBookRepository.js; this file
// only holds the state-transition rules.
import {
  bumpConversationWorldBookClock,
  deleteConversationWorldBookClock,
  deleteConversationWorldBookState,
  insertConversationWorldBookClock,
  listConversationEntryStateRows,
  listConversationEntryStateSnapshot,
  readConversationWorldBookClock,
  restoreConversationEntryStateRows,
  writeConversationEntryStates
} from '../../repositories/worldBookRepository.js';
import {
  normalizeMessageCount,
  normalizeOptionalEntryNumber
} from '../../domain/worldBooks/normalization.js';

/** The count the next message in this conversation will carry. */
export function nextWorldBookMessageCount(database, conversationId) {
  const id = requireConversationId(conversationId, 'nextWorldBookMessageCount');
  return normalizeMessageCount(readConversationWorldBookClock(database, id), 0) + 1;
}

export function loadWorldBookEntryStates(database, entryIds, conversationId) {
  const id = requireConversationId(conversationId, 'loadWorldBookEntryStates');
  const states = new Map();
  for (const row of listConversationEntryStateRows(database, id, entryIds)) {
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

/**
 * Advance every entry's window for one message, then persist the batch and the
 * conversation clock. `entryStates` is updated in place.
 */
export function persistWorldBookEntryStates(database, entries, matchedIds, entryStates, messageCount, conversationId) {
  const id = requireConversationId(conversationId, 'persistWorldBookEntryStates');
  const rows = [];

  for (const entry of entries) {
    const state = entryStates.get(entry.id);
    if (!state) continue;

    const isNowActive = matchedIds.has(entry.id);
    const wasActive = Boolean(state.was_active);
    if (isNowActive) {
      if (!wasActive) {
        // Entering the window arms sticky and records the activation message.
        const sticky = normalizeOptionalEntryNumber(entry.sticky);
        if (sticky != null && sticky > 0) state.sticky_remaining = sticky;
        state.last_activated_message = messageCount;
      }
      if (state.sticky_remaining > 0) state.sticky_remaining -= 1;
      state.was_active = 1;
    } else {
      if (wasActive) {
        // Leaving the window starts the cooldown and cancels any sticky remainder.
        state.last_deactivated_message = messageCount;
        state.sticky_remaining = 0;
      }
      state.was_active = 0;
    }

    rows.push({
      entryId: entry.id,
      lastActivatedMessage: state.last_activated_message,
      lastDeactivatedMessage: state.last_deactivated_message,
      firstSeenMessage: state.first_seen_message,
      stickyRemaining: state.sticky_remaining,
      wasActive: state.was_active
    });
  }

  writeConversationEntryStates(database, id, rows);
  bumpConversationWorldBookClock(database, id, messageCount);
}

export function snapshotConversationWorldBookState(database, conversationId) {
  const id = requireConversationId(conversationId, 'snapshotConversationWorldBookState');
  return {
    messageCount: normalizeMessageCount(readConversationWorldBookClock(database, id), 0),
    entries: listConversationEntryStateSnapshot(database, id)
  };
}

export function restoreConversationWorldBookState(database, conversationId, snapshot = {}) {
  const id = requireConversationId(conversationId, 'restoreConversationWorldBookState');
  deleteConversationWorldBookState(database, id);
  deleteConversationWorldBookClock(database, id);

  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  restoreConversationEntryStateRows(database, id, entries.map((entry) => ({
    entryId: String(entry.entry_id || ''),
    lastActivatedMessage: normalizeMessageCount(entry.last_activated_message, 0),
    lastDeactivatedMessage: normalizeMessageCount(entry.last_deactivated_message, 0),
    firstSeenMessage: normalizeMessageCount(entry.first_seen_message, 0),
    stickyRemaining: normalizeMessageCount(entry.sticky_remaining, 0),
    wasActive: entry.was_active === 1 ? 1 : 0
  })));
  insertConversationWorldBookClock(database, id, normalizeMessageCount(snapshot?.messageCount, 0));
}

function requireConversationId(conversationId, caller) {
  const id = String(conversationId || '').trim();
  if (!id) {
    throw new Error(`${caller} requires a conversationId: world book trigger state is per conversation.`);
  }
  return id;
}
