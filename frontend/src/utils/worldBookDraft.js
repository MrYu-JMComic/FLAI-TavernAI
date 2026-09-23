const WORLD_BOOK_POSITIONS = new Set(['at_start', 'before_char', 'after_char', 'at_depth']);

export function normalizeAiWorldBookDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = String(value.name || '').trim();
  const entries = [];
  for (const rawEntry of Array.isArray(value.entries) ? value.entries : []) {
    const entry = normalizeWorldBookEntryForCreate(rawEntry, entries.length);
    if (
      entry.name
      && entry.content
      && (entry.alwaysActive || entry.triggerKeys)
      && (!entry.selective || entry.keysSecondary)
    ) {
      entries.push(entry);
    }
  }
  if (!name || !entries.length) return null;
  return {
    name,
    description: String(value.description || '').trim(),
    scanDepth: clampInteger(value.scanDepth, 1, 50, 4),
    lorebookContextPercent: clampInteger(value.lorebookContextPercent, 1, 100, 25),
    entries
  };
}

export function normalizeWorldBookEntryForCreate(value = {}, index = 0) {
  const entry = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    name: String(entry.name || '').trim(),
    triggerKeys: String(entry.triggerKeys || '').trim(),
    content: String(entry.content || '').trim(),
    position: WORLD_BOOK_POSITIONS.has(entry.position) ? entry.position : 'before_char',
    enabled: entry.enabled !== false,
    orderIndex: clampInteger(entry.orderIndex, 0, Number.MAX_SAFE_INTEGER, index),
    regexMode: Boolean(entry.regexMode),
    alwaysActive: Boolean(entry.alwaysActive),
    depth: clampInteger(entry.depth, 0, 10, 0),
    role: clampInteger(entry.role, 0, 2, 0),
    sticky: nullableInteger(entry.sticky),
    cooldown: nullableInteger(entry.cooldown),
    delay: nullableInteger(entry.delay),
    selective: Boolean(entry.selective),
    selectiveLogic: clampInteger(entry.selectiveLogic, 0, 2, 0),
    keysSecondary: String(entry.keysSecondary || '').trim(),
    useProbability: Boolean(entry.useProbability),
    probability: clampInteger(entry.probability, 0, 100, 100),
    group: String(entry.group || '').trim(),
    groupWeight: clampInteger(entry.groupWeight, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  return clampInteger(value, 0, 9999, 0);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
