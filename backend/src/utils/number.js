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
