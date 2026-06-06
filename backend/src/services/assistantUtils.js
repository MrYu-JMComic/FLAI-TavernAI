export function objectOrEmpty(value) {
  return value && typeof value === 'object' ? value : {};
}

export function nullToEmptyObject(value) {
  return value ?? {};
}

export function parseLooseJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) {
    return {};
  }

  try {
    return objectOrEmpty(JSON.parse(value));
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return objectOrEmpty(JSON.parse(match[0]));
    } catch {
      return {};
    }
  }
}
