import { createHash } from 'node:crypto';

export const WORLD_BOOK_PROFILE_FIELDS = Object.freeze([
  'name', 'description', 'scanDepth', 'lorebookContextPercent'
]);

export const WORLD_BOOK_ENTRY_FIELDS = Object.freeze([
  'name', 'triggerKeys', 'content', 'position', 'enabled', 'orderIndex',
  'regexMode', 'alwaysActive', 'depth', 'selective', 'selectiveLogic',
  'keysSecondary', 'probability', 'useProbability', 'group', 'groupWeight',
  'role', 'sticky', 'cooldown', 'delay', 'knowledgeVisibility', 'audienceCastKeys'
]);

// Use content rather than timestamps: two edits may share the same millisecond.
// Character associations are saved separately and cannot invalidate a content draft.
export function worldBookRevision(book = {}) {
  return hashWorldBookValue({
    id: book.id,
    ...pickFields(book, WORLD_BOOK_PROFILE_FIELDS),
    entries: (book.entries || []).map((entry) => ({
      id: entry.id,
      ...pickFields(entry, WORLD_BOOK_ENTRY_FIELDS)
    }))
  });
}

export function hashWorldBookValue(value) {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function pickFields(value, fields) {
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}
