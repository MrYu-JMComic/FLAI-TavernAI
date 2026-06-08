export function samePlainValue(current, next) {
  if (Object.is(current, next)) {
    return true;
  }
  if (!current || !next || typeof current !== 'object' || typeof next !== 'object') {
    return false;
  }
  if (Array.isArray(current) || Array.isArray(next)) {
    if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
      return false;
    }
    for (let index = 0; index < current.length; index += 1) {
      if (!samePlainValue(current[index], next[index])) {
        return false;
      }
    }
    return true;
  }
  let currentKeyCount = 0;
  for (const key in current) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      continue;
    }
    currentKeyCount += 1;
    if (!Object.prototype.hasOwnProperty.call(next, key) || !samePlainValue(current[key], next[key])) {
      return false;
    }
  }
  let nextKeyCount = 0;
  for (const key in next) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      nextKeyCount += 1;
    }
  }
  return currentKeyCount === nextKeyCount;
}
