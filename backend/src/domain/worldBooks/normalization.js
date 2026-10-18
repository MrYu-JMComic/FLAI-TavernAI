// World book value normalization. Pure: no database, no network, no Express.
//
// Single source of truth for the shape of a world book and its entries. The
// service uses it on the write path, the runtime matcher uses it when projecting
// matched rows, and the preview uses it instead of keeping its own copy of these
// clamps.
import { normalizeBoolean } from '../../utils/boolean.js';
import { normalizeFiniteNumber } from '../../utils/number.js';
import { WORLD_BOOK_ENTRY_LIMITS, WORLD_BOOK_LIMITS } from './limits.js';
import { ENTRY_POSITIONS, readEntryField, readEntryFlag } from './entryRules.js';

export function normalizeWorldBookName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > WORLD_BOOK_LIMITS.name) {
    throw new Error('世界书名称长度需为 1-80 个字符');
  }
  return value;
}

export function normalizeWorldBookDescription(value) {
  return String(value || '').trim().slice(0, WORLD_BOOK_LIMITS.description);
}

export function normalizeLorebookContextPercent(value) {
  const normalized = normalizeFiniteNumber(value, 25);
  return Math.max(WORLD_BOOK_LIMITS.contextPercentMin, Math.min(WORLD_BOOK_LIMITS.contextPercentMax, normalized));
}

export function normalizeScanDepth(value, fallback = 1) {
  const normalized = Math.trunc(normalizeFiniteNumber(value, fallback));
  return Math.max(WORLD_BOOK_LIMITS.scanDepthMin, Math.min(WORLD_BOOK_LIMITS.scanDepthMax, normalized));
}

/** Returns null when no usable positive context size was supplied. */
export function normalizeContextSize(value) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const normalized = Math.trunc(normalizeFiniteNumber(value, 0));
  return normalized > 0 ? normalized : null;
}

export function normalizeMessageCount(value, fallback = 0) {
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

export function normalizeEntryPosition(value) {
  return ENTRY_POSITIONS.includes(value) ? value : 'before_char';
}

export function normalizeEntryDepth(value) {
  return normalizeClampedEntryNumber(value, 0, 0, WORLD_BOOK_ENTRY_LIMITS.depthMax);
}

export function normalizeEntryProbability(value) {
  return normalizeClampedEntryNumber(value, 100, 0, WORLD_BOOK_ENTRY_LIMITS.probabilityMax);
}

export function normalizeEntryGroupWeight(value) {
  return normalizeClampedEntryNumber(value, 0, 0, Number.POSITIVE_INFINITY);
}

export function normalizeEntryOrderIndex(value, fallback = 0) {
  const normalized = Math.trunc(normalizeFiniteNumber(value, fallback));
  return Math.max(0, normalized);
}

export function normalizeEntryEnumNumber(value, fallback = 0, allowed = [0, 1, 2]) {
  const fallbackNumber = typeof fallback === 'boolean' ? 0 : normalizeFiniteNumber(fallback, 0);
  const normalizedFallback = Number.isInteger(fallbackNumber) && allowed.includes(fallbackNumber) ? fallbackNumber : 0;
  if (typeof value === 'boolean') {
    return normalizedFallback;
  }
  const normalized = normalizeFiniteNumber(value, normalizedFallback);
  return Number.isInteger(normalized) && allowed.includes(normalized) ? normalized : normalizedFallback;
}

/** sticky / cooldown / delay are optional: null means "rule not configured". */
export function normalizeOptionalEntryNumber(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(WORLD_BOOK_ENTRY_LIMITS.stateDurationMax, numeric))
    : null;
}

/** Normalize an entry write payload into the column shape the repository stores. */
export function normalizeEntryPayload(payload = {}, fallback = {}) {
  payload = payload ?? {};
  fallback = fallback ?? {};
  return {
    name: String(payload.name || '').trim().slice(0, WORLD_BOOK_ENTRY_LIMITS.name),
    triggerKeys: String(payload.triggerKeys || '').trim().slice(0, WORLD_BOOK_ENTRY_LIMITS.triggerKeys),
    content: String(payload.content || '').slice(0, WORLD_BOOK_ENTRY_LIMITS.content),
    position: normalizeEntryPosition(payload.position),
    enabled: normalizeBoolean(payload.enabled, true),
    orderIndex: normalizeEntryOrderIndex(payload.orderIndex, fallback.orderIndex),
    regexMode: normalizeBoolean(payload.regexMode) ? 1 : 0,
    alwaysActive: normalizeBoolean(payload.alwaysActive) ? 1 : 0,
    depth: normalizeEntryDepth(payload.depth),
    selective: normalizeBoolean(payload.selective) ? 1 : 0,
    selectiveLogic: normalizeEntryEnumNumber(payload.selectiveLogic, fallback.selectiveLogic),
    keysSecondary: String(payload.keysSecondary || '').trim().slice(0, WORLD_BOOK_ENTRY_LIMITS.keysSecondary),
    probability: normalizeEntryProbability(payload.probability),
    useProbability: normalizeBoolean(payload.useProbability) ? 1 : 0,
    group: String(payload.group || '').trim().slice(0, WORLD_BOOK_ENTRY_LIMITS.group),
    groupWeight: normalizeEntryGroupWeight(payload.groupWeight),
    role: normalizeEntryEnumNumber(payload.role, fallback.role),
    sticky: normalizeOptionalEntryNumber(payload.sticky),
    cooldown: normalizeOptionalEntryNumber(payload.cooldown),
    delay: normalizeOptionalEntryNumber(payload.delay)
  };
}

/**
 * Project a `world_books` row into the API shape. `character_id` is not a column
 * on the table (migration 0019); the repository derives it from the book's
 * primary `character_world_books` link.
 */
export function toWorldBook(row) {
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

/** Project a `world_book_entries` row into the API shape. */
export function toWorldBookEntry(row) {
  return {
    id: row.id,
    worldBookId: row.world_book_id,
    name: row.name || '',
    triggerKeys: row.trigger_keys || '',
    content: row.content || '',
    position: normalizeEntryPosition(row.position),
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

/** Project a matched entry row into the shape the prompt pipeline consumes. */
export function toMatchedWorldBookEntry(entry) {
  return {
    id: entry.id,
    worldBookId: entry.world_book_id,
    worldBookName: entry.world_book_name || '',
    name: entry.name,
    content: entry.content,
    position: entry.position,
    depth: normalizeEntryDepth(entry.depth),
    role: normalizeEntryEnumNumber(entry.role),
    orderIndex: normalizeEntryOrderIndex(entry.order_index)
  };
}

/**
 * Normalize an entry for read-only explanation. Tolerates camelCase drafts and
 * snake_case rows, because the preview runs on saved rows, unsaved AI drafts and
 * request bodies alike.
 */
export function normalizeExplainableEntry(entry, fallbackOrderIndex = 0) {
  return {
    id: String(entry?.id || ''),
    name: String(readEntryField(entry, 'name', 'name', '') || 'Untitled entry'),
    enabled: readEntryFlag(entry, 'enabled', 'enabled', true),
    regexMode: readEntryFlag(entry, 'regexMode', 'regex_mode'),
    alwaysActive: readEntryFlag(entry, 'alwaysActive', 'always_active'),
    position: normalizeEntryPosition(readEntryField(entry, 'position', 'position', 'before_char')),
    depth: normalizeEntryDepth(readEntryField(entry, 'depth', 'depth', 0)),
    role: normalizeEntryEnumNumber(readEntryField(entry, 'role', 'role', 0)),
    orderIndex: normalizeEntryOrderIndex(readEntryField(entry, 'orderIndex', 'order_index', fallbackOrderIndex), fallbackOrderIndex),
    selective: readEntryFlag(entry, 'selective', 'selective'),
    selectiveLogic: normalizeEntryEnumNumber(readEntryField(entry, 'selectiveLogic', 'selective_logic', 0)),
    probability: normalizeEntryProbability(readEntryField(entry, 'probability', 'probability', 100)),
    useProbability: readEntryFlag(entry, 'useProbability', 'use_probability'),
    group: String(readEntryField(entry, 'group', 'inclusion_group', '') || '').trim(),
    groupWeight: normalizeEntryGroupWeight(readEntryField(entry, 'groupWeight', 'group_weight', 0)),
    sticky: normalizeOptionalEntryNumber(readEntryField(entry, 'sticky', 'sticky', null)),
    cooldown: normalizeOptionalEntryNumber(readEntryField(entry, 'cooldown', 'cooldown', null)),
    delay: normalizeOptionalEntryNumber(readEntryField(entry, 'delay', 'delay', null))
  };
}

function normalizeClampedEntryNumber(value, fallback, min, max) {
  const normalized = normalizeFiniteNumber(value, fallback);
  return Math.max(min, Math.min(max, normalized));
}
