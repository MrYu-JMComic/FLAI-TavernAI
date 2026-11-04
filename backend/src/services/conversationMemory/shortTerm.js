import { normalizeMemoryPolicy } from '../../../../shared/memoryPolicy.js';
import { getMemoryState } from '../../repositories/conversationMemoryRepository.js';
import { readPendingMemoryRows } from '../../repositories/conversationMemoryShortTermRepository.js';

/** Read every uncovered message at the selected cutoff; raw evidence is allowed only for a cast view. */
export function readMemoryShortTerm(database, userId, conversationId, options = {}) {
  const policy = normalizeMemoryPolicy(options.policy);
  if (options.enabled === false || policy.syncMode !== 'background' || policy.isolation === 'actor') return { messages: [], turns: 0, enabled: false, overflow: false };
  const state = getMemoryState(database, userId, conversationId);
  const coreOrder = Number(options.coreOrder ?? state?.core_order ?? 0);
  const cutoff = Number.isFinite(options.asOfOrder) ? options.asOfOrder : Number.MAX_SAFE_INTEGER;
  // Already settled raw-mode history does not become a new backlog when structured memory is enabled later.
  const { rows, turns, overflow } = readPendingMemoryRows(database, userId, conversationId, { coreOrder, cutoff, turnLimit: policy.shortTermTurns });
  return {
    enabled: true, turns, coreOrder, cutoff, overflow,
    messages: rows.map(row => ({ id: row.id, role: row.role, content: row.content, revision: row.revision,
      narrativeOrder: row.narrative_order, createdAt: row.created_at, attachments: JSON.parse(row.attachments_json || '[]'), shortTermRequired: true }))
  };
}

/** Merge the uncovered suffix into caller history without duplicates and mark it as budget protected. */
export function mergeMemoryShortTerm(history = [], bridge = {}) {
  if (!bridge.enabled || !bridge.messages?.length) return history;
  const pending = new Set(bridge.messages.map(message => message.id));
  const existing = new Map(history.map(message => [message.id, message]));
  return [...history.filter(message => !pending.has(message.id)),
    ...bridge.messages.map(message => ({ ...message, ...existing.get(message.id), shortTermRequired: true }))];
}
