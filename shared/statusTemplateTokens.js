export function parseStatusTemplateToken(token) {
  const text = String(token || '');
  const separatorIndex = text.indexOf('.');
  if (separatorIndex < 0) {
    return { rawName: text, rawProperty: '' };
  }
  return {
    rawName: text.slice(0, separatorIndex),
    rawProperty: text.slice(separatorIndex + 1)
  };
}
