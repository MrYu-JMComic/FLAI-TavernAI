// Chat-runtime world book activation: resolve which books feed a conversation,
// match their entries against recent text, and advance the per-conversation
// sticky / cooldown / delay state.
//
// This is the only entry point for runtime activation. Authoring writes go
// through worldBookService.js; trigger rules live in domain/worldBooks/.
import { withSavepoint } from '../../modules/savepoint.js';
import { isLoreVisibleToScope } from '../../../../shared/loreKnowledge.js';
import {
  conversationExists,
  listEnabledEntryRowsForBooks,
  listLinkedBookIdRowsForCharacters,
  listOwnedLinkedBookIdsForCharacter,
  readConversationChatLorebookId,
  readMaxLorebookContextPercent,
  readOwnedConversationLorebookId
} from '../../repositories/worldBookRepository.js';
import {
  matchesWorldBookEntry,
  normalizeWorldBookScanTexts,
  pruneWorldBookInclusionGroups
} from './worldBookMatcher.js';
import {
  loadWorldBookEntryStates,
  nextWorldBookMessageCount,
  persistWorldBookEntryStates
} from './worldBookStateService.js';
import {
  normalizeContextSize,
  normalizeEntryDepth,
  normalizeLorebookContextPercent,
  normalizeMessageCount,
  normalizeOptionalEntryNumber,
  normalizeScanDepth,
  toMatchedWorldBookEntry
} from '../../domain/worldBooks/normalization.js';

const RECURSIVE_MAX_DEPTH = 5;
const DEFAULT_LOREBOOK_CONTEXT_PERCENT = 25;
const TOKENS_PER_CHARACTER = 4;

/**
 * Every world book that feeds a chat: the character's linked books plus the
 * conversation's own chat lorebook.
 *
 * Pass `userId` to additionally pin every book to that owner; the read-only
 * context diagnostics do, the chat runtime relies on the ownership joins.
 */
export function collectChatWorldBookIds(database, { characterId = '', conversationId = '', userId = '' } = {}) {
  const ids = [];
  const seen = new Set();
  const append = (rows) => {
    for (const row of rows) {
      const id = String(row?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };

  if (characterId) {
    append(userId
      ? listOwnedLinkedBookIdsForCharacter(database, userId, characterId)
      : listLinkedBookIdRowsForCharacters(database, [characterId]));
  }

  if (conversationId) {
    const lorebookId = userId
      ? readOwnedConversationLorebookId(database, userId, conversationId)
      : readConversationChatLorebookId(database, conversationId);
    if (lorebookId) append([{ id: lorebookId }]);
  }

  return ids;
}

/**
 * Match a conversation's world book entries against recent text.
 *
 * `options.conversationId` is required: trigger state is per conversation, so a
 * match with nowhere to record sticky / cooldown / delay is a programming error
 * rather than a supported mode. `characterId` may be empty for a conversation
 * that only has a chat lorebook.
 */
export function matchWorldBookEntries(database, characterId, texts, options = {}) {
  options = options ?? {};
  const conversationId = String(options.conversationId || '').trim();
  if (!conversationId) {
    throw new Error('matchWorldBookEntries requires options.conversationId.');
  }
  if (!conversationExists(database, conversationId)) {
    return [];
  }

  // persistState=false runs a dry match (e.g. context preview): the clock is read
  // but not advanced and no state is written, so sticky/cooldown/delay stay untouched.
  const persistState = options.persistState !== false;
  const filteredTexts = normalizeWorldBookScanTexts(texts);
  const messageCount = resolveMessageCount(database, options.messageCount, conversationId);

  const allBookIds = collectChatWorldBookIds(database, { characterId, conversationId });
  if (!allBookIds.length) {
    return [];
  }

  const entries = listEnabledEntryRowsForBooks(database, allBookIds).filter((entry) => isLoreVisibleToScope(entry, options.knowledgeScope));
  const { entryIds, entryById } = indexWorldBookEntries(entries);
  const entryStates = loadWorldBookEntryStates(database, entryIds, conversationId);

  // Ensure in-memory state for all entries; missing rows are created at persist time.
  for (const entry of entries) {
    if (!entryStates.has(entry.id)) {
      entryStates.set(entry.id, {
        last_activated_message: 0,
        last_deactivated_message: 0,
        first_seen_message: 0,
        sticky_remaining: 0,
        was_active: 0
      });
    }
  }

  const matched = [];
  const matchedIds = new Set();

  // Phase 0: entries still inside their sticky window stay active.
  for (const entry of entries) {
    if (entryStates.get(entry.id).sticky_remaining > 0) {
      matched.push(toMatchedWorldBookEntry(entry));
      matchedIds.add(entry.id);
    }
  }

  // Phase 1: always-active entries, once any delay has elapsed. These need no
  // scan text, so an empty scan can still produce matches.
  for (const entry of entries) {
    if (matchedIds.has(entry.id) || !entry.always_active) continue;
    if (isDelayed(entry, entryStates.get(entry.id), messageCount)) continue;
    matched.push(toMatchedWorldBookEntry(entry));
    matchedIds.add(entry.id);
  }

  // Phase 2: trigger keys, scanned per entry at that entry's book scan depth.
  const scans = new Map();
  for (const entry of entries) {
    const scanDepth = normalizeScanDepth(options.scanDepth, normalizeScanDepth(entry.book_scan_depth));
    if (!scans.has(scanDepth)) {
      const rawText = filteredTexts.slice(-scanDepth).join('\n');
      scans.set(scanDepth, { rawText, lowerText: rawText.toLowerCase() });
    }
    entry._scanText = scans.get(scanDepth);
  }
  matchPassWithState(entries, '', '', matchedIds, matched, entryStates, messageCount, true);

  // Phase 2.5: keep one winner per inclusion group.
  pruneWorldBookInclusionGroups(entryById, matched, matchedIds);

  // Phase 3: recursive activation - matched content can trigger further entries.
  let depth = 0;
  while (depth < RECURSIVE_MAX_DEPTH) {
    const newContent = collectUnscannedRecursiveContent(matched);
    for (const item of matched) item._recursiveScanned = true;
    if (!newContent.trim()) break;

    matchPassWithState(entries, newContent.toLowerCase(), newContent, matchedIds, matched, entryStates, messageCount);
    pruneWorldBookInclusionGroups(entryById, matched, matchedIds);
    if (matched.every((item) => item._recursiveScanned)) break;
    depth += 1;
  }
  for (const item of matched) delete item._recursiveScanned;

  // Phase 4: token budget truncation.
  applyContextBudget(database, matched, allBookIds, options);

  // Phase 5: persist state for the entries that survived pruning, batched in one
  // savepoint so per-entry writes commit atomically.
  if (persistState) {
    const commitState = (includedEntryIds = toMatchedIdSet(matched)) => {
      const activeIds = new Set();
      for (const entry of matched) {
        if (includedEntryIds.has(entry.id)) activeIds.add(entry.id);
      }
      withSavepoint(database, 'sp_world_book_entry_state', () => {
        persistWorldBookEntryStates(database, entries, activeIds, entryStates, messageCount, conversationId);
      });
    };
    if (typeof options.deferStateCommit === 'function') options.deferStateCommit(commitState);
    else commitState();
  }

  return matched;
}

/** Concatenate matched entries that belong in the system prompt, in position order. */
export function buildWorldBookContext(entries = []) {
  entries = Array.isArray(entries) ? entries : [];
  if (!entries.length) {
    return '';
  }

  // at_depth entries are injected as separate messages, not in the system prompt.
  const positions = ['at_start', 'before_char', 'after_char'];
  const byPosition = new Map(positions.map((position) => [position, []]));
  for (const entry of entries) {
    const group = byPosition.get(entry.position);
    if (group) group.push(entry);
  }

  const byDepth = (a, b) => (a.depth || 0) - (b.depth || 0);
  let context = '';
  let included = 0;
  for (const position of positions) {
    const group = byPosition.get(position);
    if (group.length > 1) group.sort(byDepth);
    for (const entry of group) {
      if (included > 0) context += '\n\n';
      if (entry.content != null) context += String(entry.content);
      included += 1;
    }
  }
  return context;
}

const ROLE_MAP = { 0: 'system', 1: 'user', 2: 'assistant' };

/**
 * Inject `at_depth` world book entries into a messages array (mutated in place).
 * depth=0 appends after the final message, depth=1 inserts before it, and so on.
 * All positions resolve against the original tail, so inserted entries consume
 * no depth of their own.
 */
export function injectAtDepthEntries(messages, entries, options = {}) {
  const atDepthEntries = collectAtDepthEntries(entries);
  if (!atDepthEntries.length) {
    return messages;
  }

  const originalLength = messages.length;
  const insertions = new Map();
  for (const entry of atDepthEntries) {
    const depth = Math.min(normalizeEntryDepth(entry.depth), originalLength);
    const insertIndex = originalLength - depth;
    const role = ROLE_MAP[entry.role] || 'system';
    const message = options.createMessage
      ? options.createMessage(entry, role)
      : { role, content: entry.content };
    if (!insertions.has(insertIndex)) insertions.set(insertIndex, []);
    insertions.get(insertIndex).push(message);
  }
  for (const index of [...insertions.keys()].sort((a, b) => b - a)) {
    messages.splice(index, 0, ...insertions.get(index));
  }

  return messages;
}

function applyContextBudget(database, matched, allBookIds, options) {
  const contextSize = normalizeContextSize(options.contextSize);
  if (contextSize == null || !matched.length) {
    return;
  }

  const percent = options.lorebookContextPercent != null
    ? normalizeLorebookContextPercent(options.lorebookContextPercent)
    : resolveBookContextPercent(database, allBookIds);
  const budget = Math.floor(contextSize * percent / 100);

  matched.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  let accumulated = 0;
  let kept = 0;
  for (const entry of matched) {
    const cost = Math.ceil((entry.content || '').length / TOKENS_PER_CHARACTER);
    if (accumulated + cost > budget) continue;
    accumulated += cost;
    matched[kept++] = entry;
  }
  matched.length = kept;
}

function resolveBookContextPercent(database, allBookIds) {
  if (!allBookIds.length) {
    return DEFAULT_LOREBOOK_CONTEXT_PERCENT;
  }
  return normalizeLorebookContextPercent(readMaxLorebookContextPercent(database, allBookIds));
}

function isDelayed(entry, state, messageCount) {
  const delay = normalizeOptionalEntryNumber(entry.delay);
  if (delay == null || delay <= 0) {
    return false;
  }
  if (state.first_seen_message === 0) {
    // First sighting; persisted by persistWorldBookEntryStates.
    state.first_seen_message = messageCount;
  }
  return messageCount - state.first_seen_message < delay;
}

function isCoolingDown(entry, state, messageCount) {
  const cooldown = normalizeOptionalEntryNumber(entry.cooldown);
  if (cooldown == null || cooldown <= 0 || state.last_deactivated_message <= 0) {
    return false;
  }
  return messageCount - state.last_deactivated_message < cooldown;
}

function matchPassWithState(entries, lowerText, rawText, matchedIds, matched, entryStates, messageCount, useEntryScan = false) {
  for (const entry of entries) {
    if (matchedIds.has(entry.id)) continue;

    const state = entryStates.get(entry.id);
    if (isDelayed(entry, state, messageCount)) continue;
    if (isCoolingDown(entry, state, messageCount)) continue;

    const scan = useEntryScan ? entry._scanText : null;
    if (matchesWorldBookEntry(entry, scan?.lowerText ?? lowerText, scan?.rawText ?? rawText)) {
      matched.push(toMatchedWorldBookEntry(entry));
      matchedIds.add(entry.id);
    }
  }
}

function collectUnscannedRecursiveContent(matched) {
  let content = '';
  let included = 0;
  for (const item of matched) {
    if (item._recursiveScanned) continue;
    if (included > 0) content += '\n';
    if (item.content != null) content += item.content;
    included += 1;
  }
  return content;
}

function collectAtDepthEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const atDepthEntries = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (!(index in entries)) continue;
    if (entries[index]?.position === 'at_depth') atDepthEntries.push(entries[index]);
  }
  return atDepthEntries;
}

function indexWorldBookEntries(entries) {
  const entryIds = [];
  const entryById = new Map();
  for (const entry of entries) {
    entryIds.push(entry.id);
    entryById.set(entry.id, entry);
  }
  return { entryIds, entryById };
}

function toMatchedIdSet(matched) {
  const ids = new Set();
  for (const entry of matched) ids.add(entry.id);
  return ids;
}

function resolveMessageCount(database, value, conversationId) {
  const supplied = value == null ? null : normalizeMessageCount(value, null);
  return supplied ?? nextWorldBookMessageCount(database, conversationId);
}
