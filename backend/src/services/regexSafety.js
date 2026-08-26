import safeRegex from 'safe-regex2';

export const REGEX_PATTERN_MAX_LENGTH = 2_000;
export const REGEX_TEXT_MAX_LENGTH = 200_000;

const REGEX_REPETITION_LIMIT = 100;

export function compileSafeRegex(pattern, flags = 'g') {
  const source = String(pattern || '');
  if (!source || source.length > REGEX_PATTERN_MAX_LENGTH) {
    return null;
  }

  if (!safeRegex(source, { limit: REGEX_REPETITION_LIMIT })) {
    return null;
  }

  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

export function testSafeRegex(pattern, flags, value) {
  const text = String(value || '');
  if (text.length > REGEX_TEXT_MAX_LENGTH) {
    return false;
  }
  const regex = compileSafeRegex(pattern, flags);
  return regex ? regex.test(text) : false;
}

export function assertSafeRegexPattern(pattern, flags = 'g') {
  const source = String(pattern || '');
  if (source.length > REGEX_PATTERN_MAX_LENGTH) {
    throw new Error(`正则表达式最多 ${REGEX_PATTERN_MAX_LENGTH} 个字符`);
  }
  if (!compileSafeRegex(source, flags)) {
    throw new Error('正则表达式无效或可能导致服务阻塞');
  }
  return source;
}
