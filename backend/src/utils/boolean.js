export function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }

  if (value == null || value === '') {
    return Boolean(fallback);
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return Boolean(fallback);
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return Boolean(fallback);
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return Boolean(fallback);
}
