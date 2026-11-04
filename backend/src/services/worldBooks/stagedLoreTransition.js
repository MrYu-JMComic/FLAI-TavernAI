import { restoreConversationWorldBookState } from './worldBookStateService.js';
import { worldBookEntryExists } from '../../repositories/worldBookRepository.js';

/** Validate the internal generation receipt before any accepted-history state is restored. */
export function validateStagedLoreTransition(database, userId, conversationId, checkpoint, value) {
  if (value === undefined || value === null) return null;
  if (value.version !== 1 || value.userId !== userId || value.conversationId !== conversationId
    || !checkpoint || value.checkpointId !== checkpoint.id || !value.state
    || !Number.isSafeInteger(value.state.messageCount) || value.state.messageCount < 0
    || !Array.isArray(value.state.entries) || value.state.entries.length > 10000) throw staleTransition();
  const ids = new Set();
  for (const entry of value.state.entries) {
    const id = entry.entry_id;
    if (typeof id !== 'string' || !id || ids.has(id)
      || !worldBookEntryExists(database, id)
      || !['last_activated_message', 'last_deactivated_message', 'first_seen_message', 'sticky_remaining']
        .every((key) => Number.isSafeInteger(entry[key]) && entry[key] >= 0)
      || ![0, 1].includes(entry.was_active)) throw staleTransition();
    ids.add(id);
  }
  return structuredClone(value.state);
}

/** Apply only the already validated transition inside the caller's accepted-result savepoint. */
export function applyStagedLoreTransition(database, conversationId, state) {
  if (!state) return false;
  restoreConversationWorldBookState(database, conversationId, state);
  return true;
}

function staleTransition() {
  return Object.assign(new Error('世界书来源或历史检查点已改变，请重试重新生成。'), {
    code: 'LORE_TRANSITION_STALE', status: 409, accepted: false
  });
}
