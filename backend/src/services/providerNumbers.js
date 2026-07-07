export function readNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
}

export function readOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeProviderNumber(value) {
  if (value == null || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function assignFiniteProviderNumber(target, key, value) {
  const numeric = normalizeProviderNumber(value);
  if (numeric != null) {
    target[key] = numeric;
  }
}

export function firstPositiveProviderNumber(values, fallback) {
  for (const value of values) {
    const numeric = normalizeProviderNumber(value);
    if (numeric != null) {
      return Math.max(1, numeric);
    }
  }
  return fallback;
}

export function normalizeToolCompletionRounds(value) {
  const defaultRounds = 6;
  const maxRounds = 100;
  if (value == null || typeof value === 'boolean') {
    return defaultRounds;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return defaultRounds;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultRounds;
  }

  const normalized = Math.trunc(numeric);
  if (!Number.isSafeInteger(normalized)) {
    return defaultRounds;
  }

  return Math.min(Math.max(normalized, 1), maxRounds);
}

export function roundMoney(value) {
  return Number(value.toFixed(8));
}
