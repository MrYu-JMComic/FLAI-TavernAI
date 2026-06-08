export function countOwnObjectKeys(value) {
  if (!value || typeof value !== 'object') {
    return 0;
  }
  let count = 0;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      count += 1;
    }
  }
  return count;
}
