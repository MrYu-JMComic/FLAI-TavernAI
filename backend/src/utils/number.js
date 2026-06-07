function normalizeFallback(fallback) {
  const numeric = Number(fallback);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeFiniteNumber(value, fallback = 0) {
  const fallbackValue = normalizeFallback(fallback);
  if (value == null) {
    return fallbackValue;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return fallbackValue;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallbackValue;
}

export function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

export function clampInteger(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
