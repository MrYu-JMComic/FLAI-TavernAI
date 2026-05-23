const jsonHeaders = {
  'Content-Type': 'application/json'
};

const configuredApiBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '');

export async function apiRequest(path, options = {}) {
  let { response, data } = await requestJson(path, options);

  if (shouldRetryApiOnBackend(path, response, data)) {
    ({ response, data } = await requestJson(path, options, devBackendBase()));
  }

  if (!response.ok) {
    throwApiError(data.error || `请求失败：${response.status}`, response, data);
  }
  return data;
}

export function getMe() {
  return apiRequest('/api/auth/me');
}

export function register(payload) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function login(payload) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export function fetchCharacters({ search = '', sort = 'created' } = {}) {
  const params = new URLSearchParams({ search, sort });
  return apiRequest(`/api/characters?${params.toString()}`);
}

export function fetchCharacter(id) {
  return apiRequest(`/api/characters/${id}`);
}

export function createCharacter(payload) {
  return apiRequest('/api/characters', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCharacter(id, payload) {
  return apiRequest(`/api/characters/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteCharacter(id) {
  return apiRequest(`/api/characters/${id}`, {
    method: 'DELETE'
  });
}

export function getProviderSettings() {
  return apiRequest('/api/settings/provider');
}

export function saveProviderSettings(payload) {
  return apiRequest('/api/settings/provider', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchProviderModels(payload) {
  return apiRequest('/api/providers/models', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchDeepSeekBalance() {
  return apiRequest('/api/providers/deepseek/balance');
}

export function fetchConversations({ characterId = '' } = {}) {
  const params = new URLSearchParams();
  if (characterId) {
    params.set('characterId', characterId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations${suffix}`);
}

export function createConversation(characterId) {
  return apiRequest('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ characterId })
  });
}

export function fetchConversationMessages(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/messages`);
}

export function sendMessage(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, stream: false })
  });
}

export async function streamMessage(conversationId, payload, handlers = {}, signal) {
  const path = `/api/conversations/${conversationId}/messages`;
  const request = {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ ...payload, stream: true }),
    signal
  };
  const streamBase = configuredApiBase || devBackendBase();
  let response = await fetch(apiUrl(path, streamBase), request);

  if (shouldRetryApiOnBackend(path, response)) {
    response = await fetch(apiUrl(path, devBackendBase()), request);
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throwApiError(detail.error || `请求失败：${response.status}`, response, detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (signal?.aborted || err.name === 'AbortError') {
        return { aborted: true };
      }
      throw err;
    }

    const { done, value } = chunk;
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let match = buffer.match(/\r?\n\r?\n/);
    while (match) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = parseSseBlock(block);
      if (event.name && handlers[event.name]) {
        await handlers[event.name](event.data);
      } else if (event.name === 'content' || event.name === 'reasoning') {
        await nextPaint();
      }
      match = buffer.match(/\r?\n\r?\n/);
    }
  }
}

function parseSseBlock(block) {
  let name = 'message';
  const dataLines = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      name = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    name,
    data: safeJson(dataLines.join('\n'))
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function requestJson(path, options = {}, base = configuredApiBase) {
  const response = await fetch(apiUrl(path, base), {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? jsonHeaders : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  return {
    response,
    data: text ? safeJson(text) : {}
  };
}

function apiUrl(path, base = configuredApiBase) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return base ? `${base}${path}` : path;
}

function shouldRetryApiOnBackend(path, response, data = {}) {
  return (
    response.status === 404 &&
    path.startsWith('/api/') &&
    !configuredApiBase &&
    !data.error &&
    Boolean(devBackendBase())
  );
}

function devBackendBase() {
  if (typeof window === 'undefined') {
    return '';
  }

  if (!['5173', '4173'].includes(window.location.port)) {
    return '';
  }

  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function throwApiError(message, response, data) {
  const error = new Error(message);
  error.status = response.status;
  error.data = data;
  throw error;
}

function nextPaint() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
