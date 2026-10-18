// Read-only world book match explanation. Powers the match lab, the chat
// context diagnostics and the AI `preview_world_book_entries` tool.
//
// Trigger rules come from domain/worldBooks/entryRules.js, the same module the
// chat runtime uses, so a preview can never claim an entry triggers when the
// runtime would disagree. Two things are deliberately different here:
//   - probability is reported, never rolled;
//   - the inclusion-group winner is the highest weight (ties broken by the
//     lower orderIndex) instead of a weighted random pick, so a preview is
//     reproducible.
import { getWorldBook } from './worldBookService.js';
import { collectChatWorldBookIds } from './worldBookRuntime.js';
import {
  entryGroupWeight,
  evaluatePrimaryKeys,
  evaluateSecondaryKeys,
  passesSelectiveLogic,
  selectiveLogicLabel,
  splitEntryKeys,
  readEntryField
} from '../../domain/worldBooks/entryRules.js';
import { normalizeExplainableEntry } from '../../domain/worldBooks/normalization.js';

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

  const bookIds = collectChatWorldBookIds(database, { characterId, conversationId, userId });
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
    books.push({
      id: book.id,
      name: book.name || '未命名世界书',
      scanDepth: book.scanDepth,
      scannedTextLength: preview.scannedTextLength,
      entryCount: preview.entryCount,
      matchCount: preview.matchCount,
      effectiveMatchCount: preview.effectiveMatchCount,
      conflictCount: preview.conflictCount
    });
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
  const normalized = normalizeExplainableEntry(entry, orderIndex);
  const lowerText = text.toLowerCase();
  const primaryKeys = splitEntryKeys(readEntryField(entry, 'triggerKeys', 'trigger_keys', ''));
  const secondaryKeys = splitEntryKeys(readEntryField(entry, 'keysSecondary', 'keys_secondary', ''));
  const primary = evaluatePrimaryKeys(entry, text, lowerText, { collectDetails: true });
  const selective = explainSelectiveKeys(normalized, entry, lowerText);
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
    primaryKeys,
    secondaryKeys,
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

function explainSelectiveKeys(normalized, entry, lowerText) {
  if (!normalized.selective) {
    return {
      enabled: false,
      logicLabel: 'off',
      matchedKeys: [],
      passed: true,
      status: 'not_selective'
    };
  }

  const secondary = evaluateSecondaryKeys(entry, lowerText);
  const logicLabel = selectiveLogicLabel(normalized.selectiveLogic);
  if (!secondary.hasKeys) {
    return {
      enabled: true,
      logicLabel,
      matchedKeys: secondary.matchedKeys,
      passed: true,
      status: 'no_secondary_keys'
    };
  }

  const passed = passesSelectiveLogic(normalized.selectiveLogic, secondary);
  return {
    enabled: true,
    logicLabel,
    matchedKeys: secondary.matchedKeys,
    passed,
    status: passed ? 'passed' : 'blocked'
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
      weight: entryGroupWeight(entry),
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
