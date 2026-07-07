export function normalizeProviderBaseUrl(providerType, baseUrl) {
  const value = String(baseUrl || '').trim();
  if (providerType !== 'gemini' || !value) {
    return value;
  }
  return normalizeGeminiOpenAiBaseUrl(value);
}

export function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeGeminiOpenAiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (url.hostname !== 'generativelanguage.googleapis.com') {
    return value;
  }

  const trimmedPath = url.pathname.replace(/\/+$/, '');
  if (trimmedPath.includes('/openai')) {
    url.pathname = trimmedPath;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  }

  const version = resolveGeminiApiVersion(trimmedPath);
  url.pathname = `/${version}/openai`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function resolveGeminiApiVersion(pathname) {
  const match = /^\/([^/]+)/.exec(pathname);
  const segment = match?.[1] || '';
  return /^v\d+(?:[a-z]+)?$/i.test(segment) ? segment : 'v1beta';
}
