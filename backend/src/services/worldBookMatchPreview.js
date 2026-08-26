import { getWorldBook } from '../modules/worldBooks.js';
import { compileSafeRegex, REGEX_TEXT_MAX_LENGTH } from './regexSafety.js';

const WORLD_BOOK_CONTEXT_EXPLANATION_LIMIT = 48;

export function buildWorldBookMatchPreview(book = {}, payload = {}) {
  const text = String(payload.text || payload.content || '').trim();
  const entries = Array.isArray(book.entries) ? book.entries : [];
  const explanations = [];
  const matchedCandidates = [];

  for (let index = 0; index < entries.length; index += 1) {
    const explanation = explainWorldBookEntry(entries[index], text, index);
    explanations.push(explanation);
    if (explanation.matched) {
      matchedCandidates.push(explanation);
    }
  }

  const groups = buildMatchedGroupPreview(matchedCandidates);
  const groupByName = indexGroupsByName(groups);
  const matches = matchedCandidates.map((match) => applyEffectiveGroupState(match, groupByName));
  const effectiveMatches = matches.filter((match) => match.effective);

  return {
    worldBookId: book.id,
    text,
    scannedTextLength: text.length,
    entryCount: entries.length,
    explanationCount: explanations.length,
    matches,
    matchCount: matches.length,
    effectiveMatches,
    effectiveMatchCount: effectiveMatches.length,
    groups,
    groupCount: groups.length,
    conflictCount: groups.filter((group) => group.conflict).length,
    explanations
  };
}

export function buildWorldBookContextDiagnostics(database, options = {}) {
  const userId = String(options.userId || '').trim();
  const characterId = String(options.characterId || '').trim();
  const conversationId = String(options.conversationId || '').trim();
  if (!userId || (!characterId && !conversationId)) {
    return emptyContextDiagnostics();
  }

  const bookIds = collectContextWorldBookIds(database, userId, characterId, conversationId);
  if (!bookIds.length) {
    return emptyContextDiagnostics();
  }

  const texts = normalizeDiagnosticTexts(options.texts);
  const matchedEntryIds = indexMatchedEntryIds(options.matchedEntries);
  const books = [];
  const groups = [];
  const explanations = [];
  const matchDetails = [];
  let scannedTextLength = 0;
  let matchCount = 0;
  let effectiveMatchCount = 0;
  let conflictCount = 0;

  for (const bookId of bookIds) {
    const book = getWorldBook(database, userId, bookId);
    if (!book) {
      continue;
    }
    const scanText = selectBookScanText(texts, book.scanDepth);
    scannedTextLength += scanText.length;
    const preview = buildWorldBookMatchPreview(book, { text: scanText });
    const bookSummary = {
      id: book.id,
      name: book.name || '未命名世界书',
      scanDepth: book.scanDepth,
      scannedTextLength: preview.scannedTextLength,
      entryCount: preview.entryCount,
      matchCount: preview.matchCount,
      effectiveMatchCount: preview.effectiveMatchCount,
      conflictCount: preview.conflictCount
    };
    books.push(bookSummary);
    matchCount += preview.matchCount;
    effectiveMatchCount += preview.effectiveMatchCount;
    conflictCount += preview.conflictCount;
    appendGroupDiagnostics(groups, book, preview.groups);
    appendExplanationDiagnostics(explanations, book, preview.explanations, matchedEntryIds);
    appendMatchDetails(matchDetails, book, preview.matches, matchedEntryIds);
  }

  return {
    bookCount: books.length,
    books,
    scannedTextCount: texts.length,
    scannedTextLength,
    matchCount,
    effectiveMatchCount,
    conflictCount,
    groups,
    explanations,
    matches: matchDetails
  };
}

export function findWorldBookExplanation(diagnostics = {}, entryId = '') {
  const id = String(entryId || '').trim();
  if (!id) {
    return null;
  }
  const source = Array.isArray(diagnostics?.matches) ? diagnostics.matches : [];
  for (const match of source) {
    if (String(match?.id || '').trim() === id) {
      return match;
    }
  }
  return null;
}

function explainWorldBookEntry(entry = {}, text = '', orderIndex = 0) {
  const normalized = normalizePreviewEntry(entry, orderIndex);
  const lowerText = text.toLowerCase();
  const primary = matchPrimaryKeys(normalized, text, lowerText);
  const selective = evaluateSelectiveKeys(normalized, lowerText);
  const statefulRules = collectStatefulRules(normalized);
  const decision = decidePreviewMatch(normalized, primary, selective);

  return {
    id: normalized.id,
    name: normalized.name,
    matched: decision.matched,
    effective: decision.matched,
    status: decision.status,
    reason: decision.status,
    statusDetail: decision.statusDetail,
    enabled: normalized.enabled,
    matchedKeys: primary.matchedKeys,
    primaryKeys: normalized.primaryKeys,
    secondaryKeys: normalized.secondaryKeys,
    matchedSecondaryKeys: selective.matchedKeys,
    keyDetails: primary.keyDetails,
    invalidRegexKeys: primary.invalidRegexKeys,
    regexMode: normalized.regexMode,
    usedRegex: primary.usedRegex,
    alwaysActive: normalized.alwaysActive,
    position: normalized.position,
    depth: normalized.depth,
    role: normalized.role,
    orderIndex: normalized.orderIndex,
    selective: normalized.selective,
    selectiveLogic: normalized.selectiveLogic,
    selectiveLogicLabel: selective.logicLabel,
    selectivePassed: selective.passed,
    selectiveStatus: selective.status,
    useProbability: normalized.useProbability,
    probability: normalized.probability,
    probabilityMode: normalized.useProbability ? 'runtime_random' : 'none',
    group: normalized.group,
    groupWeight: normalized.groupWeight,
    groupShare: null,
    groupPreviewWinner: false,
    sticky: normalized.sticky,
    cooldown: normalized.cooldown,
    delay: normalized.delay,
    statefulRules,
    statefulRuleCount: statefulRules.length
  };
}

function decidePreviewMatch(entry, primary, selective) {
  if (!entry.enabled) {
    return { matched: false, status: 'disabled', statusDetail: 'Entry is disabled.' };
  }

  if (entry.alwaysActive) {
    return { matched: true, status: 'always_active', statusDetail: 'Always-active entries bypass trigger keys.' };
  }

  if (!primary.hasKeys) {
    return { matched: false, status: 'no_primary_keys', statusDetail: 'No trigger keys are configured.' };
  }

  if (!primary.matchedKeys.length) {
    if (primary.invalidRegexKeys.length && primary.validKeyCount === 0) {
      return { matched: false, status: 'invalid_regex', statusDetail: 'Every regex trigger failed to compile.' };
    }
    return { matched: false, status: 'primary_miss', statusDetail: 'No primary trigger key matched the scanned text.' };
  }

  if (entry.selective && !selective.passed) {
    return { matched: false, status: 'selective_blocked', statusDetail: 'Primary keys matched, but secondary key logic blocked activation.' };
  }

  if (entry.useProbability && entry.probability <= 0) {
    return { matched: false, status: 'probability_blocked', statusDetail: 'Probability is 0%, so runtime activation cannot pass.' };
  }

  if (entry.useProbability && entry.probability < 100) {
    return { matched: true, status: 'probability_preview', statusDetail: 'Trigger logic passed; runtime still rolls probability.' };
  }

  if (entry.selective) {
    return { matched: true, status: 'selective_match', statusDetail: 'Primary and secondary key logic passed.' };
  }

  if (primary.usedRegex) {
    return { matched: true, status: 'regex_match', statusDetail: 'A regex trigger matched the scanned text.' };
  }

  return { matched: true, status: 'primary_match', statusDetail: 'A literal trigger matched the scanned text.' };
}

function matchPrimaryKeys(entry, rawText, lowerText) {
  const matchedKeys = [];
  const invalidRegexKeys = [];
  const keyDetails = [];
  let usedRegex = false;
  let validKeyCount = 0;

  for (const key of entry.primaryKeys) {
    const detail = {
      key,
      matched: false,
      mode: entry.regexMode ? 'regex' : 'literal',
      invalidRegex: false
    };

    if (entry.regexMode) {
      usedRegex = true;
      const regex = compileRegex(key, 'i');
      if (!regex) {
        detail.invalidRegex = true;
        invalidRegexKeys.push(key);
      } else {
        validKeyCount += 1;
        if (canTestRegexText(rawText) && regex.test(rawText)) {
          detail.matched = true;
          matchedKeys.push(key);
        }
      }
      keyDetails.push(detail);
      continue;
    }

    const regexKey = parseStringModeRegexKey(key);
    if (regexKey) {
      usedRegex = true;
      detail.mode = 'string_regex';
      const regex = compileRegex(regexKey.pattern, regexKey.flags);
      if (regex && canTestRegexText(rawText) && regex.test(rawText)) {
        detail.matched = true;
        matchedKeys.push(key);
        keyDetails.push(detail);
        continue;
      }
      if (!regex) {
        detail.invalidRegex = true;
        invalidRegexKeys.push(key);
      }
    }

    validKeyCount += 1;
    if (lowerText.includes(key.toLowerCase())) {
      detail.matched = true;
      matchedKeys.push(key);
    }
    keyDetails.push(detail);
  }

  return {
    hasKeys: entry.primaryKeys.length > 0,
    matchedKeys,
    invalidRegexKeys,
    keyDetails,
    usedRegex,
    validKeyCount
  };
}

function evaluateSelectiveKeys(entry, lowerText) {
  if (!entry.selective) {
    return {
      enabled: false,
      logicLabel: 'off',
      matchedKeys: [],
      passed: true,
      status: 'not_selective'
    };
  }

  const matchedKeys = [];
  for (const key of entry.secondaryKeys) {
    if (lowerText.includes(key.toLowerCase())) {
      matchedKeys.push(key);
    }
  }

  if (!entry.secondaryKeys.length) {
    return {
      enabled: true,
      logicLabel: selectiveLogicLabel(entry.selectiveLogic),
      matchedKeys,
      passed: true,
      status: 'no_secondary_keys'
    };
  }

  const anyHit = matchedKeys.length > 0;
  const allHit = matchedKeys.length === entry.secondaryKeys.length;
  let passed;
  if (entry.selectiveLogic === 2) {
    passed = !allHit;
  } else if (entry.selectiveLogic === 1) {
    passed = !anyHit;
  } else {
    passed = anyHit;
  }

  return {
    enabled: true,
    logicLabel: selectiveLogicLabel(entry.selectiveLogic),
    matchedKeys,
    passed,
    status: passed ? 'passed' : 'blocked'
  };
}

function buildMatchedGroupPreview(matches) {
  const grouped = new Map();
  for (const match of matches) {
    if (!match.group) {
      continue;
    }
    if (!grouped.has(match.group)) {
      grouped.set(match.group, []);
    }
    grouped.get(match.group).push(match);
  }

  const groups = [];
  for (const [name, entries] of grouped) {
    const weightedEntries = entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      weight: previewGroupWeight(entry.groupWeight),
      orderIndex: entry.orderIndex
    }));
    const totalWeight = weightedEntries.reduce((sum, entry) => sum + entry.weight, 0);
    const winner = selectPreviewGroupWinner(weightedEntries);
    const groupEntries = weightedEntries.map((entry) => ({
      ...entry,
      share: totalWeight > 0 ? entry.weight / totalWeight : 0,
      previewWinner: Boolean(winner && winner.id === entry.id)
    }));
    groups.push({
      name,
      entryCount: entries.length,
      conflict: entries.length > 1,
      totalWeight,
      previewWinnerId: winner?.id || null,
      previewWinnerName: winner?.name || '',
      entries: groupEntries
    });
  }

  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

function indexGroupsByName(groups) {
  const index = new Map();
  for (const group of groups) {
    index.set(group.name, group);
  }
  return index;
}

function applyEffectiveGroupState(match, groupByName) {
  if (!match.group) {
    return { ...match, effective: true };
  }
  const group = groupByName.get(match.group);
  if (!group) {
    return { ...match, effective: true };
  }
  const entry = group.entries.find((item) => item.id === match.id);
  const groupShare = entry ? entry.share : null;
  const groupPreviewWinner = Boolean(entry?.previewWinner);
  return {
    ...match,
    effective: !group.conflict || groupPreviewWinner,
    groupShare,
    groupPreviewWinner
  };
}

function selectPreviewGroupWinner(entries) {
  let winner = null;
  for (const entry of entries) {
    if (!winner) {
      winner = entry;
      continue;
    }
    if (entry.weight > winner.weight) {
      winner = entry;
      continue;
    }
    if (entry.weight === winner.weight && entry.orderIndex < winner.orderIndex) {
      winner = entry;
    }
  }
  return winner;
}

function normalizePreviewEntry(entry, fallbackOrderIndex) {
  const primaryKeys = splitEntryKeys(readEntryValue(entry, 'triggerKeys', 'trigger_keys', ''));
  const secondaryKeys = splitEntryKeys(readEntryValue(entry, 'keysSecondary', 'keys_secondary', ''));
  return {
    id: String(entry?.id || ''),
    name: String(readEntryValue(entry, 'name', 'name', '') || 'Untitled entry'),
    enabled: readBoolean(readEntryValue(entry, 'enabled', 'enabled', true), true),
    primaryKeys,
    secondaryKeys,
    regexMode: readBoolean(readEntryValue(entry, 'regexMode', 'regex_mode', false)),
    alwaysActive: readBoolean(readEntryValue(entry, 'alwaysActive', 'always_active', false)),
    position: normalizePosition(readEntryValue(entry, 'position', 'position', 'before_char')),
    depth: clampNumber(readEntryValue(entry, 'depth', 'depth', 0), 0, 10, 0),
    role: clampNumber(readEntryValue(entry, 'role', 'role', 0), 0, 2, 0),
    orderIndex: clampNumber(readEntryValue(entry, 'orderIndex', 'order_index', fallbackOrderIndex), 0, Number.POSITIVE_INFINITY, fallbackOrderIndex),
    selective: readBoolean(readEntryValue(entry, 'selective', 'selective', false)),
    selectiveLogic: clampNumber(readEntryValue(entry, 'selectiveLogic', 'selective_logic', 0), 0, 2, 0),
    probability: clampNumber(readEntryValue(entry, 'probability', 'probability', 100), 0, 100, 100),
    useProbability: readBoolean(readEntryValue(entry, 'useProbability', 'use_probability', false)),
    group: String(readEntryValue(entry, 'group', 'inclusion_group', '') || '').trim(),
    groupWeight: clampNumber(readEntryValue(entry, 'groupWeight', 'group_weight', 0), 0, Number.POSITIVE_INFINITY, 0),
    sticky: optionalNumber(readEntryValue(entry, 'sticky', 'sticky', null)),
    cooldown: optionalNumber(readEntryValue(entry, 'cooldown', 'cooldown', null)),
    delay: optionalNumber(readEntryValue(entry, 'delay', 'delay', null))
  };
}

function collectStatefulRules(entry) {
  const rules = [];
  if (entry.sticky != null && entry.sticky > 0) {
    rules.push({ kind: 'sticky', value: entry.sticky });
  }
  if (entry.cooldown != null && entry.cooldown > 0) {
    rules.push({ kind: 'cooldown', value: entry.cooldown });
  }
  if (entry.delay != null && entry.delay > 0) {
    rules.push({ kind: 'delay', value: entry.delay });
  }
  return rules;
}

function readEntryValue(entry, camelKey, snakeKey, fallback) {
  if (entry && Object.hasOwn(entry, camelKey)) {
    return entry[camelKey];
  }
  if (entry && Object.hasOwn(entry, snakeKey)) {
    return entry[snakeKey];
  }
  return fallback;
}

function splitEntryKeys(value) {
  const keys = [];
  const text = String(value || '');
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== ',') {
      continue;
    }
    const key = text.slice(start, index).trim();
    if (key) {
      keys.push(key);
    }
    start = index + 1;
  }
  return keys;
}

function parseStringModeRegexKey(key) {
  if (!key || key[0] !== '/') {
    return null;
  }
  const finalSlash = key.lastIndexOf('/');
  if (finalSlash <= 1) {
    return null;
  }
  const flags = key.slice(finalSlash + 1);
  for (let index = 0; index < flags.length; index += 1) {
    if (!'gimsuy'.includes(flags[index])) {
      return null;
    }
  }
  const pattern = key.slice(1, finalSlash);
  if (containsRegexLineTerminator(pattern)) {
    return null;
  }
  return { pattern, flags };
}

function containsRegexLineTerminator(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

function compileRegex(pattern, flags) {
  return compileSafeRegex(pattern, flags);
}

function canTestRegexText(value) {
  return String(value || '').length <= REGEX_TEXT_MAX_LENGTH;
}

function selectiveLogicLabel(value) {
  if (value === 1) {
    return 'not_any';
  }
  if (value === 2) {
    return 'not_all';
  }
  return 'any';
}

function normalizePosition(value) {
  const normalized = String(value || '').trim();
  return ['before_char', 'after_char', 'at_start', 'at_depth'].includes(normalized)
    ? normalized
    : 'before_char';
}

function readBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function optionalNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(9999, Math.trunc(numeric))) : null;
}

function previewGroupWeight(value) {
  return Math.max(clampNumber(value, 0, Number.POSITIVE_INFINITY, 0), 1);
}

function emptyContextDiagnostics() {
  return {
    bookCount: 0,
    books: [],
    scannedTextCount: 0,
    scannedTextLength: 0,
    matchCount: 0,
    effectiveMatchCount: 0,
    conflictCount: 0,
    groups: [],
    explanations: [],
    matches: []
  };
}

function collectContextWorldBookIds(database, userId, characterId, conversationId) {
  const ids = [];
  const seen = new Set();

  if (characterId) {
    const directRows = database
      .prepare(
        `SELECT wb.id
         FROM world_books wb
         JOIN characters c ON c.id = wb.character_id AND c.user_id = wb.user_id
         WHERE wb.character_id = ? AND wb.user_id = ?
         ORDER BY wb.updated_at DESC, wb.rowid DESC`
      )
      .all(characterId, userId);
    appendBookIds(ids, seen, directRows);

    const linkedRows = database
      .prepare(
        `SELECT wb.id
         FROM character_world_books cwb
         JOIN world_books wb ON wb.id = cwb.world_book_id
         JOIN characters c ON c.id = cwb.character_id AND c.user_id = wb.user_id
         WHERE cwb.character_id = ? AND wb.user_id = ?
         ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
      )
      .all(characterId, userId);
    appendBookIds(ids, seen, linkedRows);
  }

  if (conversationId) {
    const row = database
      .prepare(
        `SELECT wb.id
         FROM conversations c
         JOIN world_books wb ON wb.id = c.chat_lorebook_id AND wb.user_id = c.user_id
         WHERE c.id = ? AND c.user_id = ?`
      )
      .get(conversationId, userId);
    appendBookIds(ids, seen, row ? [row] : []);
  }

  return ids;
}

function appendBookIds(ids, seen, rows) {
  for (const row of rows) {
    const id = String(row?.id || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
}

function normalizeDiagnosticTexts(texts) {
  const source = Array.isArray(texts) ? texts : [];
  const normalized = [];
  for (const text of source) {
    const value = String(text || '').trim();
    if (value) {
      normalized.push(value);
    }
  }
  return normalized;
}

function selectBookScanText(texts, scanDepth) {
  const depth = Math.max(1, Math.trunc(Number(scanDepth) || 1));
  const start = Math.max(0, texts.length - depth);
  let text = '';
  for (let index = start; index < texts.length; index += 1) {
    text = text ? `${text}\n${texts[index]}` : texts[index];
  }
  return text;
}

function indexMatchedEntryIds(entries) {
  const ids = new Set();
  const source = Array.isArray(entries) ? entries : [];
  for (const entry of source) {
    const id = String(entry?.id || '').trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function appendGroupDiagnostics(target, book, groups) {
  const source = Array.isArray(groups) ? groups : [];
  for (const group of source) {
    target.push({
      worldBookId: book.id,
      worldBookName: book.name || '未命名世界书',
      name: group.name,
      entryCount: group.entryCount,
      conflict: group.conflict,
      totalWeight: group.totalWeight,
      previewWinnerId: group.previewWinnerId,
      previewWinnerName: group.previewWinnerName,
      entries: group.entries
    });
  }
}

function appendExplanationDiagnostics(target, book, explanations, matchedEntryIds) {
  const source = Array.isArray(explanations) ? explanations : [];
  for (const explanation of source) {
    if (target.length >= WORLD_BOOK_CONTEXT_EXPLANATION_LIMIT) {
      return;
    }
    target.push(buildContextExplanation(book, explanation, matchedEntryIds));
  }
}

function appendMatchDetails(target, book, matches, matchedEntryIds) {
  const source = Array.isArray(matches) ? matches : [];
  for (const match of source) {
    target.push(buildContextExplanation(book, match, matchedEntryIds));
  }
}

function buildContextExplanation(book, explanation, matchedEntryIds) {
  const entryId = String(explanation?.id || '').trim();
  return {
    id: entryId,
    name: explanation?.name || '未命名条目',
    worldBookId: book.id,
    worldBookName: book.name || '未命名世界书',
    matched: Boolean(explanation?.matched),
    effective: Boolean(explanation?.effective),
    inPrompt: matchedEntryIds.has(entryId),
    status: explanation?.status || 'primary_miss',
    statusDetail: explanation?.statusDetail || '',
    primaryKeys: Array.isArray(explanation?.primaryKeys) ? explanation.primaryKeys : [],
    secondaryKeys: Array.isArray(explanation?.secondaryKeys) ? explanation.secondaryKeys : [],
    matchedKeys: Array.isArray(explanation?.matchedKeys) ? explanation.matchedKeys : [],
    matchedSecondaryKeys: Array.isArray(explanation?.matchedSecondaryKeys) ? explanation.matchedSecondaryKeys : [],
    invalidRegexKeys: Array.isArray(explanation?.invalidRegexKeys) ? explanation.invalidRegexKeys : [],
    alwaysActive: Boolean(explanation?.alwaysActive),
    regexMode: Boolean(explanation?.regexMode),
    selective: Boolean(explanation?.selective),
    selectivePassed: explanation?.selectivePassed !== false,
    selectiveLogicLabel: explanation?.selectiveLogicLabel || '',
    useProbability: Boolean(explanation?.useProbability),
    probability: Number(explanation?.probability ?? 100),
    group: explanation?.group || '',
    groupWeight: Number(explanation?.groupWeight || 0),
    groupShare: explanation?.groupShare ?? null,
    groupPreviewWinner: Boolean(explanation?.groupPreviewWinner),
    statefulRules: Array.isArray(explanation?.statefulRules) ? explanation.statefulRules : []
  };
}
