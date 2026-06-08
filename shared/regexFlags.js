const VALID_REGEX_FLAGS = 'dgimsuvy';

export function normalizeRegexFlags(flags, fallback = 'g') {
  let normalized = '';
  for (const flag of String(flags || fallback)) {
    if (!VALID_REGEX_FLAGS.includes(flag) || normalized.includes(flag)) {
      continue;
    }
    normalized += flag;
  }
  return normalized || fallback;
}
