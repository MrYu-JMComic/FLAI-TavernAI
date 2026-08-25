import { createHash } from 'node:crypto';

export function normalizeCastText(value, maxLength = 4_000) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeCastName(value) {
  return normalizeCastText(value, 120);
}

export function castNameKey(value) {
  return normalizeCastName(value).toLowerCase();
}

export function castContentKey(value) {
  return stableCastHash(normalizeCastText(value, 20_000));
}

export function castBehaviorRuleKey(triggerCondition, action) {
  const normalized = `${normalizeCastText(triggerCondition, 2_000)}\n${normalizeCastText(action, 4_000)}`;
  return stableCastHash(normalized);
}

export function normalizeItemCode(value, fallbackSeed = '') {
  const normalized = normalizeCastText(value, 120)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) {
    return normalized;
  }
  return `item-${stableCastHash(fallbackSeed || 'cast-item').slice(0, 16)}`;
}

export function stableCastHash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

export function parseCastJson(value, fallback) {
  if (value == null || value === '') {
    return structuredClone(fallback);
  }
  if (typeof value === 'object') {
    return structuredClone(value);
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return structuredClone(fallback);
  }
}

export function stringifyCastJson(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}
