// World book trigger rules. Pure: no database, no network, no Express.
//
// Both consumers call into here so the runtime and the preview can never
// disagree about whether an entry triggers:
//   - services/worldBooks/worldBookMatcher.js (chat runtime; rolls probability,
//     picks a random inclusion-group winner)
//   - services/worldBooks/worldBookMatchPreview.js (match lab, context
//     diagnostics and the AI preview_world_book_entries tool; collects per-key
//     detail, picks a deterministic group winner)
//
// Regexes are compiled fresh on every call. Do not cache them: string-mode keys
// may carry the `g` flag, and a shared instance would carry lastIndex across
// calls and change match results.
import { compileSafeRegex, REGEX_TEXT_MAX_LENGTH } from '../../services/regexSafety.js';

export const SELECTIVE_LOGIC = Object.freeze({ any: 0, notAny: 1, notAll: 2 });

export const ENTRY_POSITIONS = Object.freeze(['before_char', 'after_char', 'at_start', 'at_depth']);

const STRING_MODE_REGEX_FLAGS = 'gimsuy';
// LF, CR, U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR. Kept as numeric
// escapes so the source stays ASCII.
const LINE_TERMINATOR_CODES = new Set([0x0a, 0x0d, 0x2028, 0x2029]);

/** Read a field from either a camelCase draft object or a snake_case database row. */
export function readEntryField(entry, camelKey, snakeKey, fallback) {
  if (entry && Object.hasOwn(entry, camelKey)) {
    return entry[camelKey];
  }
  if (entry && Object.hasOwn(entry, snakeKey)) {
    return entry[snakeKey];
  }
  return fallback;
}

/**
 * Visit every non-empty comma-separated key. Return `false` from `onKey` to stop.
 * Returns whether the value contained at least one key.
 */
export function forEachEntryKey(value, onKey) {
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

export function splitEntryKeys(value) {
  const keys = [];
  forEachEntryKey(value, (key) => {
    keys.push(key);
    return true;
  });
  return keys;
}

/** Parse a `/pattern/flags` key used while regexMode is off. Returns null when it is not one. */
export function parseStringModeRegexKey(key) {
  if (!key || key[0] !== '/') return null;
  const finalSlash = key.lastIndexOf('/');
  if (finalSlash <= 1) return null;
  const flags = key.slice(finalSlash + 1);
  if ([...flags].some((flag) => !STRING_MODE_REGEX_FLAGS.includes(flag))) return null;
  const pattern = key.slice(1, finalSlash);
  if (hasLineTerminator(pattern)) return null;
  return { pattern, flags };
}

export function normalizeSelectiveLogic(value) {
  const number = Number(value);
  return Number.isInteger(number) && [SELECTIVE_LOGIC.any, SELECTIVE_LOGIC.notAny, SELECTIVE_LOGIC.notAll].includes(number)
    ? number
    : SELECTIVE_LOGIC.any;
}

/** Inclusion-group weight, floored at 1 so a zero weight still has a chance of winning. */
export function entryGroupWeight(entry) {
  const raw = Number(readEntryField(entry, 'groupWeight', 'group_weight', 0));
  return Math.max(Number.isFinite(raw) ? Math.max(raw, 0) : 0, 1);
}

export function entryInclusionGroup(entry) {
  return String(readEntryField(entry, 'group', 'inclusion_group', '') || '').trim();
}

/**
 * Evaluate the primary trigger keys.
 *
 * `collectDetails: false` (the default) short-circuits on the first hit - this is
 * the chat runtime path. `collectDetails: true` evaluates every key and returns
 * per-key reasons, which the preview renders.
 */
export function evaluatePrimaryKeys(entry, rawText, lowerText, options = {}) {
  const collectDetails = options.collectDetails === true;
  const regexMode = readEntryFlag(entry, 'regexMode', 'regex_mode');
  const matchedKeys = [];
  const invalidRegexKeys = [];
  const keyDetails = [];
  let hit = false;
  let usedRegex = false;
  let validKeyCount = 0;

  const hasKeys = forEachEntryKey(readEntryField(entry, 'triggerKeys', 'trigger_keys', ''), (key) => {
    const detail = collectDetails
      ? { key, matched: false, mode: regexMode ? 'regex' : 'literal', invalidRegex: false }
      : null;

    if (regexMode) {
      usedRegex = true;
      const attempt = testEntryRegex(key, 'i', rawText);
      if (!attempt.valid) {
        invalidRegexKeys.push(key);
        if (detail) detail.invalidRegex = true;
      } else {
        validKeyCount += 1;
        if (attempt.matched) {
          hit = true;
          matchedKeys.push(key);
          if (detail) detail.matched = true;
        }
      }
      if (detail) keyDetails.push(detail);
      return collectDetails || !hit;
    }

    const regexKey = parseStringModeRegexKey(key);
    if (regexKey) {
      usedRegex = true;
      if (detail) detail.mode = 'string_regex';
      const attempt = testEntryRegex(regexKey.pattern, regexKey.flags, rawText);
      if (attempt.matched) {
        hit = true;
        matchedKeys.push(key);
        if (detail) {
          detail.matched = true;
          keyDetails.push(detail);
        }
        return collectDetails;
      }
      if (!attempt.valid) {
        invalidRegexKeys.push(key);
        if (detail) detail.invalidRegex = true;
      }
    }

    // A key that failed to match as a regex still falls back to a literal
    // substring test against its raw text, slashes included.
    validKeyCount += 1;
    if (lowerText.includes(key.toLowerCase())) {
      hit = true;
      matchedKeys.push(key);
      if (detail) detail.matched = true;
    }
    if (detail) keyDetails.push(detail);
    return collectDetails || !hit;
  });

  return { hasKeys, hit, matchedKeys, invalidRegexKeys, keyDetails, usedRegex, validKeyCount };
}

/** Evaluate the secondary (selective) keys. These are always literal substring tests. */
export function evaluateSecondaryKeys(entry, lowerText) {
  const keys = splitEntryKeys(readEntryField(entry, 'keysSecondary', 'keys_secondary', ''));
  const matchedKeys = [];
  for (const key of keys) {
    if (lowerText.includes(key.toLowerCase())) matchedKeys.push(key);
  }
  return {
    keys,
    hasKeys: keys.length > 0,
    matchedKeys,
    anyHit: matchedKeys.length > 0,
    allHit: keys.length > 0 && matchedKeys.length === keys.length
  };
}

/**
 * Apply selective logic. An entry with no secondary keys always passes, so
 * enabling `selective` without keys never blocks activation.
 */
export function passesSelectiveLogic(logic, secondary) {
  if (!secondary.hasKeys) return true;
  const normalized = normalizeSelectiveLogic(logic);
  if (normalized === SELECTIVE_LOGIC.notAll) return !secondary.allHit;
  if (normalized === SELECTIVE_LOGIC.notAny) return !secondary.anyHit;
  return secondary.anyHit;
}

export function selectiveLogicLabel(value) {
  const normalized = normalizeSelectiveLogic(value);
  if (normalized === SELECTIVE_LOGIC.notAny) return 'not_any';
  if (normalized === SELECTIVE_LOGIC.notAll) return 'not_all';
  return 'any';
}

/**
 * Read a field as a flag using database truthiness: any non-zero number counts
 * as true. The runtime matcher reads raw `world_book_entries` rows this way, so
 * the preview must agree.
 */
export function readEntryFlag(entry, camelKey, snakeKey, fallback = false) {
  const value = readEntryField(entry, camelKey, snakeKey, fallback);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return Boolean(fallback);
  }
  return Boolean(value);
}

function hasLineTerminator(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (LINE_TERMINATOR_CODES.has(value.charCodeAt(index))) return true;
  }
  return false;
}

function testEntryRegex(pattern, flags, rawText) {
  const regex = compileSafeRegex(pattern, flags);
  if (!regex) return { valid: false, matched: false };
  const text = String(rawText || '');
  if (text.length > REGEX_TEXT_MAX_LENGTH) return { valid: true, matched: false };
  return { valid: true, matched: regex.test(text) };
}
