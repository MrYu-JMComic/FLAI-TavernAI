export function findSseBlockSeparator(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }
    const start = index > 0 && text.charCodeAt(index - 1) === 13 ? index - 1 : index;
    const firstLength = index - start + 1;
    const nextIndex = index + 1;
    if (text.charCodeAt(nextIndex) === 10) {
      return { index: start, length: firstLength + 1 };
    }
    if (text.charCodeAt(nextIndex) === 13 && text.charCodeAt(nextIndex + 1) === 10) {
      return { index: start, length: firstLength + 2 };
    }
  }
  return null;
}

export function forEachSseLine(text, visit) {
  const source = String(text || '');
  let lineStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) !== 10) {
      continue;
    }
    const lineEnd = index > lineStart && source.charCodeAt(index - 1) === 13
      ? index - 1
      : index;
    visit(source.slice(lineStart, lineEnd));
    lineStart = index + 1;
  }

  visit(source.slice(lineStart));
}
