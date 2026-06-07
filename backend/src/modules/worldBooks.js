import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeFiniteNumber } from '../utils/number.js';

// ── World Book CRUD ──

export function listWorldBooks(database, userId) {
  return database
    .prepare(
      `SELECT wb.*,
        (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
       FROM world_books wb
       WHERE wb.user_id = ?
       ORDER BY wb.updated_at DESC, wb.rowid DESC`
    )
    .all(userId)
    .map(toWorldBook);
}

export function getWorldBook(database, userId, bookId) {
  const row = database
    .prepare(
      `SELECT wb.*,
        (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count
       FROM world_books wb
       WHERE wb.id = ? AND wb.user_id = ?`
    )
    .get(bookId, userId);
  if (!row) {
    return null;
  }

  // Collect linked character IDs from junction table
  const linkedCharacters = database
    .prepare(
      `SELECT cwb.character_id
       FROM character_world_books cwb
       JOIN characters c ON c.id = cwb.character_id
       WHERE cwb.world_book_id = ? AND c.user_id = ?
       ORDER BY cwb.created_at ASC, cwb.rowid ASC`
    )
    .all(bookId, row.user_id)
    .map((r) => r.character_id);

  return {
    ...toWorldBook(row),
    linkedCharacters,
    entries: listEntries(database, bookId)
  };
}

export function createWorldBook(database, userId, payload) {
  const id = newId();
  const timestamp = nowIso();
  const name = normalizeName(payload.name);
  const description = String(payload.description || '').trim().slice(0, 2000);
  const characterId = normalizeOwnedCharacterId(database, userId, payload.characterId);
  const scanDepth = normalizeScanDepth(payload.scanDepth);
  const lorebookContextPercent = normalizeLorebookContextPercent(payload.lorebookContextPercent);

  database
    .prepare(
      `INSERT INTO world_books (id, user_id, name, description, character_id, scan_depth, lorebook_context_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, name, description, characterId, scanDepth, lorebookContextPercent, timestamp, timestamp);

  return getWorldBook(database, userId, id);
}

export function updateWorldBook(database, userId, bookId, payload) {
  const existing = getOwnedWorldBook(database, userId, bookId);
  if (!existing) {
    return null;
  }

  const name = normalizeName(payload.name ?? existing.name);
  const description = String(payload.description ?? existing.description).trim().slice(0, 2000);
  const characterId = payload.characterId !== undefined
    ? normalizeOwnedCharacterId(database, userId, payload.characterId)
    : (existing.character_id ?? null);
  const scanDepth = payload.scanDepth !== undefined
    ? normalizeScanDepth(payload.scanDepth)
    : normalizeScanDepth(existing.scan_depth);
  const lorebookContextPercent = payload.lorebookContextPercent !== undefined
    ? normalizeLorebookContextPercent(payload.lorebookContextPercent)
    : normalizeLorebookContextPercent(existing.lorebook_context_percent);

  database
    .prepare(
      `UPDATE world_books
       SET name = ?, description = ?, character_id = ?, scan_depth = ?, lorebook_context_percent = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
    .run(name, description, characterId, scanDepth, lorebookContextPercent, nowIso(), bookId, userId);

  return getWorldBook(database, userId, bookId);
}

export function deleteWorldBook(database, userId, bookId) {
  const result = database
    .prepare('DELETE FROM world_books WHERE id = ? AND user_id = ?')
    .run(bookId, userId);
  return result.changes > 0;
}

// ── Character ↔ World Book Linking ──

export function linkWorldBookToCharacter(database, bookId, characterId, orderIndex = 0, userId = null) {
  if (userId) {
    if (!getOwnedWorldBook(database, userId, bookId)) {
      return false;
    }
    if (!getOwnedCharacter(database, userId, characterId)) {
      return false;
    }
  }

  const timestamp = nowIso();
  try {
    database
      .prepare(
        `INSERT OR REPLACE INTO character_world_books (character_id, world_book_id, order_index, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(characterId, bookId, orderIndex, timestamp);
    return true;
  } catch {
    return false;
  }
}

export function unlinkWorldBookFromCharacter(database, bookId, characterId, userId = null) {
  if (userId) {
    if (!getOwnedWorldBook(database, userId, bookId)) {
      return false;
    }
    if (!getOwnedCharacter(database, userId, characterId)) {
      return false;
    }
  }

  const result = database
    .prepare('DELETE FROM character_world_books WHERE world_book_id = ? AND character_id = ?')
    .run(bookId, characterId);
  return result.changes > 0;
}

export function getCharacterWorldBookId(database, characterId) {
  const linked = database
    .prepare(
      `SELECT cwb.world_book_id AS id
       FROM character_world_books cwb
       JOIN world_books wb ON wb.id = cwb.world_book_id
       JOIN characters c ON c.id = cwb.character_id
         AND c.user_id = wb.user_id
       WHERE cwb.character_id = ?
       ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
    )
    .get(characterId);
  if (linked?.id) {
    return linked.id;
  }

  const direct = database
    .prepare(
      `SELECT world_books.id
       FROM world_books
       JOIN characters ON characters.id = world_books.character_id
         AND characters.user_id = world_books.user_id
       WHERE world_books.character_id = ?
       ORDER BY world_books.updated_at DESC, world_books.rowid DESC`
    )
    .get(characterId);
  return direct?.id || null;
}

export function listCharacterWorldBooks(database, characterId) {
  return database
    .prepare(
      `SELECT wb.*,
        (SELECT COUNT(*) FROM world_book_entries WHERE world_book_id = wb.id) AS entry_count,
        cwb.order_index AS link_order
       FROM character_world_books cwb
       JOIN world_books wb ON wb.id = cwb.world_book_id
       JOIN characters c ON c.id = cwb.character_id AND c.user_id = wb.user_id
       WHERE cwb.character_id = ?
       ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
    )
    .all(characterId)
    .map(toWorldBook);
}

// ── Entry CRUD ──

export function createEntry(database, userId, bookId, payload) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return null;
  }

  const id = newId();
  const timestamp = nowIso();
  const data = normalizeEntryPayload(payload);
  const maxOrder = database
    .prepare('SELECT MAX(order_index) AS max_order FROM world_book_entries WHERE world_book_id = ?')
    .get(bookId);
  const orderIndex = Number(maxOrder?.max_order ?? -1) + 1;

  database
    .prepare(
      `INSERT INTO world_book_entries (
        id, world_book_id, name, trigger_keys, content, position, enabled, order_index, regex_mode, always_active, depth, selective, selective_logic, keys_secondary, probability, use_probability, inclusion_group, group_weight, role, sticky, cooldown, delay, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, bookId, data.name, data.triggerKeys, data.content, data.position, data.enabled ? 1 : 0, orderIndex, data.regexMode, data.alwaysActive, data.depth, data.selective, data.selectiveLogic, data.keysSecondary, data.probability, data.useProbability, data.group, data.groupWeight, data.role, data.sticky, data.cooldown, data.delay, timestamp);

  touchWorldBook(database, bookId);
  return getEntry(database, id);
}

export function updateEntry(database, userId, bookId, entryId, payload) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return null;
  }

  const existing = getEntry(database, entryId);
  if (!existing || existing.worldBookId !== bookId) {
    return null;
  }

  const data = normalizeEntryPayload({ ...existing, ...payload }, existing);

  database
    .prepare(
      `UPDATE world_book_entries
       SET name = ?, trigger_keys = ?, content = ?, position = ?, enabled = ?, order_index = ?, regex_mode = ?, always_active = ?, depth = ?, selective = ?, selective_logic = ?, keys_secondary = ?, probability = ?, use_probability = ?, inclusion_group = ?, group_weight = ?, role = ?, sticky = ?, cooldown = ?, delay = ?
       WHERE id = ? AND world_book_id = ?`
    )
    .run(data.name, data.triggerKeys, data.content, data.position, data.enabled ? 1 : 0, data.orderIndex, data.regexMode, data.alwaysActive, data.depth, data.selective, data.selectiveLogic, data.keysSecondary, data.probability, data.useProbability, data.group, data.groupWeight, data.role, data.sticky, data.cooldown, data.delay, entryId, bookId);

  touchWorldBook(database, bookId);
  return getEntry(database, entryId);
}

export function deleteEntry(database, userId, bookId, entryId) {
  if (!getOwnedWorldBook(database, userId, bookId)) {
    return false;
  }

  const result = database
    .prepare('DELETE FROM world_book_entries WHERE id = ? AND world_book_id = ?')
    .run(entryId, bookId);
  if (result.changes > 0) {
    touchWorldBook(database, bookId);
  }
  return result.changes > 0;
}

// ── Trigger Injection Logic ──

const RECURSIVE_MAX_DEPTH = 5;

export function matchWorldBookEntries(database, characterId, texts, options = {}) {
  options = options ?? {};
  if (!characterId && !options.conversationId) {
    return [];
  }

  const filteredTexts = normalizeScanTexts(texts);
  if (!filteredTexts.length) {
    // Still collect always_active entries
  }

  // Message count for sticky/cooldown/delay tracking
  const messageCount = resolveMessageCount(database, options.messageCount);

  // Collect book IDs from both character_id column and character_world_books junction table
  const bookIdSet = new Set();

  if (characterId) {
    const directBooks = database
      .prepare(
        `SELECT wb.id
         FROM world_books wb
         JOIN characters c ON c.id = wb.character_id AND c.user_id = wb.user_id
         WHERE wb.character_id = ?`
      )
      .all(characterId);
    for (const b of directBooks) bookIdSet.add(b.id);

    const linkedBooks = database
      .prepare(
        `SELECT wb.id
         FROM character_world_books cwb
         JOIN world_books wb ON wb.id = cwb.world_book_id
         JOIN characters c ON c.id = cwb.character_id AND c.user_id = wb.user_id
         WHERE cwb.character_id = ?`
      )
      .all(characterId);
    for (const b of linkedBooks) bookIdSet.add(b.id);
  }

  // Include chat lorebook if conversationId is provided
  if (options.conversationId) {
    const conv = database
      .prepare('SELECT chat_lorebook_id FROM conversations WHERE id = ?')
      .get(options.conversationId);
    if (conv?.chat_lorebook_id) {
      bookIdSet.add(conv.chat_lorebook_id);
    }
  }

  const allBookIds = [...bookIdSet];
  if (!allBookIds.length) {
    return [];
  }

  // Resolve scan_depth: use the maximum scan_depth across all bound books, or options override
  const scanDepthRow = database
    .prepare(`SELECT MAX(scan_depth) AS max_depth FROM world_books WHERE id IN (${allBookIds.map(() => '?').join(',')})`)
    .get(...allBookIds);
  const defaultScanDepth = normalizeScanDepth(scanDepthRow?.max_depth);
  const scanDepth = options.scanDepth != null
    ? normalizeScanDepth(options.scanDepth, defaultScanDepth)
    : defaultScanDepth;

  // Build scan text from recent N messages
  const scanTexts = filteredTexts.slice(-scanDepth);
  const combinedScanText = scanTexts.join('\n');
  const lowerCombined = combinedScanText.toLowerCase();

  const placeholders = allBookIds.map(() => '?').join(',');
  const entries = database
    .prepare(
      `SELECT * FROM world_book_entries
       WHERE world_book_id IN (${placeholders}) AND enabled = 1
       ORDER BY order_index ASC, rowid ASC`
    )
    .all(...allBookIds);

  // Load or create state for all entries
  const entryStates = getEntryStates(database, entries.map((e) => e.id));

  // Ensure state rows exist for all entries
  for (const entry of entries) {
    if (!entryStates.has(entry.id)) {
      database
        .prepare('INSERT OR IGNORE INTO world_book_entry_state (entry_id) VALUES (?)')
        .run(entry.id);
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

  // Phase 0: Sticky entries — include entries that are still in their sticky window
  for (const entry of entries) {
    const state = entryStates.get(entry.id);
    if (state.sticky_remaining > 0) {
      matched.push(toMatchedEntry(entry));
      matchedIds.add(entry.id);
    }
  }

  // Phase 1: Collect always_active entries (skip those already added via sticky)
  for (const entry of entries) {
    if (matchedIds.has(entry.id)) continue;
    if (entry.always_active) {
      // Check delay
      const state = entryStates.get(entry.id);
      const delay = normalizeOptionalEntryNumber(entry.delay);
      if (delay != null && delay > 0) {
        if (state.first_seen_message === 0) {
          database.prepare('UPDATE world_book_entry_state SET first_seen_message = ? WHERE entry_id = ?').run(messageCount, entry.id);
          state.first_seen_message = messageCount;
        }
        if (messageCount - state.first_seen_message < delay) {
          continue;
        }
      }
      matched.push(toMatchedEntry(entry));
      matchedIds.add(entry.id);
    }
  }

  // Phase 2: Match by trigger keys (string or regex), with cooldown/delay filtering
  matchPassWithState(entries, lowerCombined, combinedScanText, matchedIds, matched, entryStates, messageCount);

  const entryById = new Map(entries.map((e) => [e.id, e]));
  // Phase 2.5: Group inclusion - keep only one entry per group via weighted random
  applyGroupInclusion(entryById, matched, matchedIds);

  // Phase 3: Recursive activation
  let depth = 0;
  while (depth < RECURSIVE_MAX_DEPTH) {
    const newContent = matched
      .filter((m) => !m._recursiveScanned)
      .map((m) => m.content)
      .join('\n');

    for (const m of matched) {
      m._recursiveScanned = true;
    }

    if (!newContent.trim()) {
      break;
    }

    const newLower = newContent.toLowerCase();
    matchPassWithState(entries, newLower, newContent, matchedIds, matched, entryStates, messageCount);
    applyGroupInclusion(entryById, matched, matchedIds);

    if (matched.every((m) => m._recursiveScanned)) {
      break;
    }

    depth++;
  }

  // Clean up internal flags
  for (const m of matched) {
    delete m._recursiveScanned;
  }

  // Phase 4: Token budget truncation
  const contextSize = normalizeContextSize(options.contextSize);
  if (contextSize != null && matched.length > 0) {
    // Determine percent: use options override, else max across bound books
    let percent = 25;
    if (options.lorebookContextPercent != null) {
      percent = normalizeLorebookContextPercent(options.lorebookContextPercent);
    } else if (allBookIds.length > 0) {
      const placeholders2 = allBookIds.map(() => '?').join(',');
      const row = database
        .prepare(`SELECT MAX(lorebook_context_percent) AS max_pct FROM world_books WHERE id IN (${placeholders2})`)
        .get(...allBookIds);
      percent = normalizeLorebookContextPercent(row?.max_pct);
    }
    const budget = Math.floor(contextSize * percent / 100);

    // Sort matched entries by order_index ASC (stable)
    matched.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    let accumulated = 0;
    for (let i = 0; i < matched.length; i++) {
      accumulated += Math.ceil((matched[i].content || '').length / 4);
      if (accumulated > budget) {
        matched.splice(i);
        break;
      }
    }
  }

  // Phase 5: Update entry states based on entries that survived final pruning
  updateEntryStates(database, entries, toMatchedIdSet(matched), entryStates, messageCount);

  return matched;
}

function matchPassWithState(entries, lowerText, rawText, matchedIds, matched, entryStates, messageCount) {
  for (const entry of entries) {
    if (matchedIds.has(entry.id)) {
      continue;
    }

    const state = entryStates.get(entry.id);

    // Check delay: entry must wait N messages after first seen before it can activate
    const delay = normalizeOptionalEntryNumber(entry.delay);
    if (delay != null && delay > 0) {
      if (state.first_seen_message === 0) {
        // First time seeing this entry — record the message count
        // (handled inline, but we need a DB write)
        state.first_seen_message = messageCount;
        // Note: the DB update happens in updateEntryStates
      }
      if (messageCount - state.first_seen_message < delay) {
        continue;
      }
    }

    // Check cooldown: entry cannot re-activate until cooldown period passes
    const cooldown = normalizeOptionalEntryNumber(entry.cooldown);
    if (cooldown != null && cooldown > 0 && state.last_deactivated_message > 0) {
      if (messageCount - state.last_deactivated_message < cooldown) {
        continue;
      }
    }

    const keys = String(entry.trigger_keys || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    if (keys.length === 0) {
      continue;
    }

    let hit = false;

    if (entry.regex_mode) {
      for (const key of keys) {
        try {
          const regex = new RegExp(key, 'i');
          if (regex.test(rawText)) {
            hit = true;
            break;
          }
        } catch {
          // Invalid regex, skip this key
        }
      }
    } else {
      hit = keys.some((key) => {
        const regexMatch = key.match(/^\/(.+)\/([gimsuy]*)$/);
        if (regexMatch) {
          try {
            const regex = new RegExp(regexMatch[1], regexMatch[2]);
            return regex.test(rawText);
          } catch {
            // Invalid regex, fall back to literal match
          }
        }
        return lowerText.includes(key.toLowerCase());
      });
    }

    // Selective filter: when primary keys hit, apply secondary key logic
    if (hit && entry.selective) {
      const secondaryKeys = String(entry.keys_secondary || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      if (secondaryKeys.length > 0) {
        const secondaryHit = secondaryKeys.some((key) => lowerText.includes(key.toLowerCase()));
        const allSecondaryHit = secondaryKeys.every((key) => lowerText.includes(key.toLowerCase()));
        const logic = normalizeEntryEnumNumber(entry.selective_logic);

        if (logic === 0) {
          hit = secondaryHit;
        } else if (logic === 1) {
          hit = !secondaryHit;
        } else if (logic === 2) {
          hit = !allSecondaryHit;
        }
      }
    }

    // Probability-based activation
    if (hit && entry.use_probability) {
      const prob = normalizeEntryProbability(entry.probability);
      hit = Math.random() * 100 < prob;
    }

    if (hit) {
      matched.push(toMatchedEntry(entry));
      matchedIds.add(entry.id);
    }
  }
}

function normalizeScanTexts(texts) {
  const textArray = Array.isArray(texts) ? texts : [texts];
  return textArray.filter((text) => typeof text === 'string' && text.length > 0);
}

function applyGroupInclusion(entryById, matched, matchedIds) {
  const groups = new Map();
  for (const m of matched) {
    const src = entryById.get(m.id);
    if (src && src.inclusion_group) {
      if (!groups.has(src.inclusion_group)) {
        groups.set(src.inclusion_group, []);
      }
      groups.get(src.inclusion_group).push(m);
    }
  }

  for (const groupMatches of groups.values()) {
    if (groupMatches.length <= 1) {
      continue;
    }

    const weights = groupMatches.map((m) => {
      const src = entryById.get(m.id);
      return Math.max(normalizeEntryGroupWeight(src?.group_weight), 1);
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let winnerIdx = 0;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        winnerIdx = i;
        break;
      }
    }

    for (let i = 0; i < groupMatches.length; i++) {
      if (i !== winnerIdx) {
        const loser = groupMatches[i];
        const loserIdx = matched.indexOf(loser);
        if (loserIdx !== -1) {
          matched.splice(loserIdx, 1);
        }
        matchedIds.delete(loser.id);
      }
    }
  }
}

function toMatchedIdSet(matched) {
  return new Set(matched.map((entry) => entry.id));
}

function toMatchedEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    content: entry.content,
    position: entry.position,
    depth: normalizeEntryDepth(entry.depth),
    role: normalizeEntryEnumNumber(entry.role),
    orderIndex: normalizeEntryOrderIndex(entry.order_index)
  };
}


// ── Sticky / Cooldown / Delay State Helpers ──

let _messageCounter = 0;
let _counterInitialized = false;

function getNextMessageCount(database) {
  // Lazy-init: recover counter from persisted state so sticky/cooldown survive restarts
  if (!_counterInitialized) {
    _counterInitialized = true;
    try {
      const row = database
        .prepare(
          `SELECT MAX(last_activated_message) AS a, MAX(last_deactivated_message) AS d,
                  MAX(first_seen_message) AS f FROM world_book_entry_state`
        )
        .get();
      const maxSeen = Math.max(
        normalizeMessageCount(row?.a, 0),
        normalizeMessageCount(row?.d, 0),
        normalizeMessageCount(row?.f, 0)
      );
      if (maxSeen > _messageCounter) {
        _messageCounter = maxSeen;
      }
    } catch {
      // Table may not exist yet; ignore
    }
  }
  _messageCounter = normalizeMessageCount(_messageCounter, 0);
  return ++_messageCounter;
}

function getEntryStates(database, entryIds) {
  const states = new Map();
  if (!entryIds.length) return states;

  const placeholders = entryIds.map(() => '?').join(',');
  const rows = database
    .prepare(`SELECT * FROM world_book_entry_state WHERE entry_id IN (${placeholders})`)
    .all(...entryIds);

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

function updateEntryStates(database, entries, matchedIds, entryStates, messageCount) {
  for (const entry of entries) {
    const state = entryStates.get(entry.id);
    if (!state) continue;

    const isNowActive = matchedIds.has(entry.id);
    const wasActive = state.was_active ? true : false;

    if (isNowActive) {
      // Entry is active in this round
      if (!wasActive) {
        // Newly activated - set sticky counter
        const sticky = normalizeOptionalEntryNumber(entry.sticky);
        if (sticky != null && sticky > 0) {
          state.sticky_remaining = sticky;
        }
        state.last_activated_message = messageCount;
      }
      // Decrement sticky counter (for entries activated in a prior round still in sticky window)
      if (state.sticky_remaining > 0) {
        state.sticky_remaining--;
      }
      state.was_active = 1;
    } else {
      // Entry is NOT active in this round
      if (wasActive) {
        // Just deactivated — start cooldown
        state.last_deactivated_message = messageCount;
        state.sticky_remaining = 0;
      }
      state.was_active = 0;
    }

    // Persist state
    database
      .prepare(
        `UPDATE world_book_entry_state
         SET last_activated_message = ?, last_deactivated_message = ?, first_seen_message = ?,
             sticky_remaining = ?, was_active = ?
         WHERE entry_id = ?`
      )
      .run(
        state.last_activated_message,
        state.last_deactivated_message,
        state.first_seen_message,
        state.sticky_remaining,
        state.was_active ? 1 : 0,
        entry.id
      );
  }
}

// Reset message counter (for testing)
export function resetMessageCounter() {
  _messageCounter = 0;
}

export function buildWorldBookContext(entries = []) {
  entries = Array.isArray(entries) ? entries : [];
  if (!entries.length) {
    return '';
  }

  // at_depth entries are injected as separate messages, not in the system prompt
  const atStart = [];
  const beforeChar = [];
  const afterChar = [];
  for (const entry of entries) {
    if (entry.position === 'at_start') {
      atStart.push(entry);
    } else if (entry.position === 'before_char') {
      beforeChar.push(entry);
    } else if (entry.position === 'after_char') {
      afterChar.push(entry);
    }
  }

  const byDepth = (a, b) => (a.depth || 0) - (b.depth || 0);
  if (atStart.length > 1) atStart.sort(byDepth);
  if (beforeChar.length > 1) beforeChar.sort(byDepth);
  if (afterChar.length > 1) afterChar.sort(byDepth);

  return [...atStart, ...beforeChar, ...afterChar].map((e) => e.content).join('\n\n');
}

const ROLE_MAP = { 0: 'system', 1: 'user', 2: 'assistant' };

/**
 * Inject at_depth world book entries into a messages array.
 * Each entry is inserted as a message at the specified depth from the end.
 * depth=0 means right before the last message, depth=1 means before the second-to-last, etc.
 * @param {Array} messages - The messages array to inject into (will be mutated)
 * @param {Array} entries - Matched world book entries with position='at_depth'
 * @returns {Array} - The modified messages array
 */
export function injectAtDepthEntries(messages, entries) {
  entries = Array.isArray(entries) ? entries : [];
  const atDepthEntries = entries.filter((e) => e.position === 'at_depth');
  if (!atDepthEntries.length) {
    return messages;
  }

  // Sort by depth descending so deeper entries are inserted first (preserving relative positions)
  const sorted = [...atDepthEntries].sort((a, b) => (b.depth || 0) - (a.depth || 0));

  for (const entry of sorted) {
    const depth = Math.max(0, Math.min(entry.depth || 0, messages.length));
    const insertIndex = messages.length - depth;
    const role = ROLE_MAP[entry.role] || 'system';
    messages.splice(insertIndex, 0, { role, content: entry.content });
  }

  return messages;
}

// ── Internal Helpers ──

function listEntries(database, bookId) {
  return database
    .prepare(
      `SELECT * FROM world_book_entries
       WHERE world_book_id = ?
       ORDER BY order_index ASC, rowid ASC`
    )
    .all(bookId)
    .map(toEntry);
}

function getEntry(database, entryId) {
  const row = database
    .prepare('SELECT * FROM world_book_entries WHERE id = ?')
    .get(entryId);
  return row ? toEntry(row) : null;
}

function getOwnedWorldBook(database, userId, bookId) {
  const row = database
    .prepare('SELECT * FROM world_books WHERE id = ? AND user_id = ?')
    .get(bookId, userId);
  return row || null;
}

function getOwnedCharacter(database, userId, characterId) {
  const id = String(characterId || '').trim();
  if (!id) {
    return null;
  }
  const row = database
    .prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?')
    .get(id, userId);
  return row || null;
}

function normalizeOwnedCharacterId(database, userId, value) {
  const characterId = String(value || '').trim();
  if (!characterId) {
    return null;
  }
  if (!getOwnedCharacter(database, userId, characterId)) {
    throw new Error('Character does not exist');
  }
  return characterId;
}

function touchWorldBook(database, bookId) {
  database
    .prepare('UPDATE world_books SET updated_at = ? WHERE id = ?')
    .run(nowIso(), bookId);
}

function normalizeName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 80) {
    throw new Error('世界书名称长度需为 1-80 个字符');
  }
  return value;
}

function normalizeLorebookContextPercent(value) {
  const normalized = normalizeFiniteNumber(value, 25);
  return Math.max(1, Math.min(100, normalized));
}

function normalizeScanDepth(value, fallback = 1) {
  const normalized = Math.trunc(normalizeFiniteNumber(value, fallback));
  return Math.max(1, Math.min(50, normalized));
}

function normalizeContextSize(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const normalized = Math.trunc(normalizeFiniteNumber(value, 0));
  return normalized > 0 ? normalized : null;
}

function resolveMessageCount(database, value) {
  if (value == null) {
    return getNextMessageCount(database);
  }
  return normalizeMessageCount(value, null) ?? getNextMessageCount(database);
}

function normalizeMessageCount(value, fallback = 0) {
  if (typeof value === 'boolean') {
    return fallback;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const normalized = Math.trunc(numeric);
  if (!Number.isSafeInteger(normalized)) {
    return fallback;
  }
  return normalized > 0 ? normalized : fallback;
}

function normalizeEntryPayload(payload = {}, fallback = {}) {
  payload = payload ?? {};
  fallback = fallback ?? {};
  const name = String(payload.name || '').trim().slice(0, 120);
  const triggerKeys = String(payload.triggerKeys || '').trim().slice(0, 2000);
  const content = String(payload.content || '').slice(0, 10000);
  const position = ['before_char', 'after_char', 'at_start', 'at_depth'].includes(payload.position)
    ? payload.position
    : 'before_char';
  const enabled = normalizeBoolean(payload.enabled, true);
  const orderIndex = normalizeEntryOrderIndex(payload.orderIndex, fallback.orderIndex);
  const regexMode = normalizeBoolean(payload.regexMode) ? 1 : 0;
  const alwaysActive = normalizeBoolean(payload.alwaysActive) ? 1 : 0;
  const depth = normalizeEntryDepth(payload.depth);
  const selective = normalizeBoolean(payload.selective) ? 1 : 0;
  const selectiveLogic = normalizeEntryEnumNumber(payload.selectiveLogic, fallback.selectiveLogic);
  const keysSecondary = String(payload.keysSecondary || '').trim().slice(0, 2000);

  const probability = normalizeEntryProbability(payload.probability);
  const useProbability = normalizeBoolean(payload.useProbability) ? 1 : 0;
  const group = String(payload.group || '').trim().slice(0, 100);
  const groupWeight = normalizeEntryGroupWeight(payload.groupWeight);
  const role = normalizeEntryEnumNumber(payload.role, fallback.role);

  const sticky = normalizeOptionalEntryNumber(payload.sticky);
  const cooldown = normalizeOptionalEntryNumber(payload.cooldown);
  const delay = normalizeOptionalEntryNumber(payload.delay);

  return { name, triggerKeys, content, position, enabled, orderIndex, regexMode, alwaysActive, depth, selective, selectiveLogic, keysSecondary, probability, useProbability, group, groupWeight, role, sticky, cooldown, delay };
}

function normalizeClampedEntryNumber(value, fallback, min, max) {
  const normalized = normalizeFiniteNumber(value, fallback);
  return Math.max(min, Math.min(max, normalized));
}

function normalizeEntryDepth(value) {
  return normalizeClampedEntryNumber(value, 0, 0, 10);
}

function normalizeEntryProbability(value) {
  return normalizeClampedEntryNumber(value, 100, 0, 100);
}

function normalizeEntryGroupWeight(value) {
  return normalizeClampedEntryNumber(value, 0, 0, Number.POSITIVE_INFINITY);
}

function normalizeEntryOrderIndex(value, fallback = 0) {
  const normalized = Math.trunc(normalizeFiniteNumber(value, fallback));
  return Math.max(0, normalized);
}

function normalizeEntryEnumNumber(value, fallback = 0, allowed = [0, 1, 2]) {
  const fallbackNumber = typeof fallback === 'boolean' ? 0 : normalizeFiniteNumber(fallback, 0);
  const normalizedFallback = Number.isInteger(fallbackNumber) && allowed.includes(fallbackNumber) ? fallbackNumber : 0;
  if (typeof value === 'boolean') {
    return normalizedFallback;
  }
  const normalized = normalizeFiniteNumber(value, normalizedFallback);
  return Number.isInteger(normalized) && allowed.includes(normalized) ? normalized : normalizedFallback;
}

function normalizeOptionalEntryNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(9999, numeric)) : null;
}

function toWorldBook(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    characterId: row.character_id || null,
    scanDepth: normalizeScanDepth(row.scan_depth),
    lorebookContextPercent: normalizeLorebookContextPercent(row.lorebook_context_percent),
    entryCount: Number(row.entry_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toEntry(row) {
  return {
    id: row.id,
    worldBookId: row.world_book_id,
    name: row.name || '',
    triggerKeys: row.trigger_keys || '',
    content: row.content || '',
    position: row.position || 'before_char',
    enabled: Boolean(row.enabled),
    orderIndex: normalizeEntryOrderIndex(row.order_index),
    regexMode: Boolean(row.regex_mode),
    alwaysActive: Boolean(row.always_active),
    depth: normalizeEntryDepth(row.depth),
    selective: Boolean(row.selective),
    selectiveLogic: normalizeEntryEnumNumber(row.selective_logic),
    keysSecondary: row.keys_secondary || '',
    probability: normalizeEntryProbability(row.probability),
    useProbability: Boolean(row.use_probability),
    group: row.inclusion_group || '',
    groupWeight: normalizeEntryGroupWeight(row.group_weight),
    role: normalizeEntryEnumNumber(row.role),
    sticky: normalizeOptionalEntryNumber(row.sticky),
    cooldown: normalizeOptionalEntryNumber(row.cooldown),
    delay: normalizeOptionalEntryNumber(row.delay),
    createdAt: row.created_at
  };
}
