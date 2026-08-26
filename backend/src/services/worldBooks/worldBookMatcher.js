import { testSafeRegex } from '../regexSafety.js';

export function normalizeWorldBookScanTexts(texts) {
  if (!Array.isArray(texts)) {
    return typeof texts === 'string' && texts.length > 0 ? [texts] : [];
  }
  const normalized = [];
  for (const text of texts) {
    if (typeof text === 'string' && text.length > 0) normalized.push(text);
  }
  return normalized;
}

export function matchesWorldBookEntry(entry, lowerText, rawText) {
  let hit = false;
  const hasKeys = forEachEntryKey(entry.trigger_keys, (key) => {
    if (entry.regex_mode) {
      if (testSafeRegex(key, 'i', rawText)) {
        hit = true;
        return false;
      }
      return true;
    }
    if (matchesStringModeEntryKey(key, lowerText, rawText)) {
      hit = true;
      return false;
    }
    return true;
  });
  if (!hasKeys) return false;

  if (hit && entry.selective) {
    const logic = normalizeEnum(entry.selective_logic);
    if (logic === 2) {
      const secondary = matchAllLiteralEntryKeys(entry.keys_secondary, lowerText);
      if (secondary.hasKeys) hit = !secondary.hit;
    } else {
      const secondary = matchAnyLiteralEntryKey(entry.keys_secondary, lowerText);
      if (secondary.hasKeys) hit = logic === 0 ? secondary.hit : !secondary.hit;
    }
  }
  if (hit && entry.use_probability) {
    hit = Math.random() * 100 < clampNumber(entry.probability, 0, 100, 100);
  }
  return hit;
}

export function pruneWorldBookInclusionGroups(entryById, matched, matchedIds) {
  const groups = new Map();
  for (const match of matched) {
    const source = entryById.get(match.id);
    if (!source?.inclusion_group) continue;
    if (!groups.has(source.inclusion_group)) groups.set(source.inclusion_group, []);
    groups.get(source.inclusion_group).push(match);
  }
  for (const groupMatches of groups.values()) {
    if (groupMatches.length <= 1) continue;
    let totalWeight = 0;
    for (const match of groupMatches) totalWeight += groupWeight(entryById, match);
    let roll = Math.random() * totalWeight;
    let winnerIndex = 0;
    for (let index = 0; index < groupMatches.length; index += 1) {
      roll -= groupWeight(entryById, groupMatches[index]);
      if (roll <= 0) {
        winnerIndex = index;
        break;
      }
    }
    for (let index = 0; index < groupMatches.length; index += 1) {
      if (index === winnerIndex) continue;
      const loser = groupMatches[index];
      const matchIndex = matched.indexOf(loser);
      if (matchIndex !== -1) matched.splice(matchIndex, 1);
      matchedIds.delete(loser.id);
    }
  }
}

function forEachEntryKey(value, onKey) {
  const text = String(value || '');
  let hasKey = false;
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== ',') continue;
    const key = text.slice(start, index).trim();
    if (key) {
      hasKey = true;
      if (onKey(key) === false) break;
    }
    start = index + 1;
  }
  return hasKey;
}

function matchesStringModeEntryKey(key, lowerText, rawText) {
  const regexKey = parseStringModeRegexKey(key);
  return Boolean(regexKey && testSafeRegex(regexKey.pattern, regexKey.flags, rawText))
    || lowerText.includes(key.toLowerCase());
}

function parseStringModeRegexKey(key) {
  if (!key || key[0] !== '/') return null;
  const finalSlash = key.lastIndexOf('/');
  if (finalSlash <= 1) return null;
  const flags = key.slice(finalSlash + 1);
  if ([...flags].some((flag) => !'gimsuy'.includes(flag))) return null;
  const pattern = key.slice(1, finalSlash);
  if ([...pattern].some((character) => ['\n', '\r', '\u2028', '\u2029'].includes(character))) return null;
  return { pattern, flags };
}

function matchAnyLiteralEntryKey(value, lowerText) {
  let hit = false;
  const hasKeys = forEachEntryKey(value, (key) => {
    if (!lowerText.includes(key.toLowerCase())) return true;
    hit = true;
    return false;
  });
  return { hasKeys, hit };
}

function matchAllLiteralEntryKeys(value, lowerText) {
  let hit = true;
  const hasKeys = forEachEntryKey(value, (key) => {
    if (lowerText.includes(key.toLowerCase())) return true;
    hit = false;
    return false;
  });
  return { hasKeys, hit: hasKeys && hit };
}

function groupWeight(entryById, match) {
  return Math.max(clampNumber(entryById.get(match.id)?.group_weight, 0, Number.POSITIVE_INFINITY, 0), 1);
}

function normalizeEnum(value) {
  const number = Number(value);
  return Number.isInteger(number) && [0, 1, 2].includes(number) ? number : 0;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
