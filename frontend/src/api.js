const jsonHeaders = {
  'Content-Type': 'application/json'
};

// ── CSRF Token 管理 ──
let csrfToken = '';

function getCsrfToken() {
  if (csrfToken) return csrfToken;
  // 从 cookie 中读取
  const match = document.cookie.match(/flai_csrf=([^;]+)/);
  if (match) csrfToken = decodeURIComponent(match[1]);
  return csrfToken;
}

export async function ensureCsrfToken() {
  if (getCsrfToken()) return csrfToken;
  try {
    const res = await fetch(apiUrl('/api/csrf-token'), { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken || '';
  } catch {
    // 静默失败
  }
  return csrfToken;
}

async function refreshCsrfToken() {
  csrfToken = '';
  return ensureCsrfToken();
}

// 页面加载时获取 CSRF token
if (typeof window !== 'undefined') {
  ensureCsrfToken();
}

const configuredApiBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '');

export async function apiRequest(path, options = {}) {
  let { response, data, base } = await requestJson(path, options);

  if (shouldRetryApiOnBackend(path, response, data)) {
    ({ response, data, base } = await requestJson(path, options, devBackendBase()));
  }

  if (shouldRetryAfterCsrf(response, data, options)) {
    await refreshCsrfToken();
    ({ response, data } = await requestJson(path, options, base));
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

export function saveUserAvatar(payload) {
  return apiRequest('/api/users/me/avatar', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function getUserProfile() {
  return apiRequest('/api/users/me/profile');
}

export function saveUserProfile(payload) {
  return apiRequest('/api/users/me/profile', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchCharacters({ search = '', sort = 'created', tag = '' } = {}) {
  const params = new URLSearchParams({ search, sort, tag });
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

export function fetchCharacterWorldBooks(characterId) {
  return apiRequest(`/api/characters/${characterId}/world-books`);
}

export function linkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books`, {
    method: 'POST',
    body: JSON.stringify({ worldBookId })
  });
}

export function unlinkCharacterWorldBook(characterId, worldBookId) {
  return apiRequest(`/api/characters/${characterId}/world-books/${worldBookId}`, {
    method: 'DELETE'
  });
}

export function exportCharacter(id) {
  return apiRequest(`/api/characters/${id}/export`);
}

export function importCharacter(payload) {
  return apiRequest('/api/characters/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function completeCharacterDraft(payload) {
  return apiRequest('/api/characters/complete-draft', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function setCharacterFavorite(id, favorited) {
  return apiRequest(`/api/characters/${id}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorited })
  });
}

export function setCharacterLike(id, liked) {
  return apiRequest(`/api/characters/${id}/like`, {
    method: 'PUT',
    body: JSON.stringify({ liked })
  });
}

// ── Character Images (CG 立绘) ──

export function fetchCharacterImages(characterId) {
  return apiRequest(`/api/characters/${characterId}/images`);
}

export function createCharacterImage(characterId, payload) {
  return apiRequest(`/api/characters/${characterId}/images`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateCharacterImage(characterId, imageId, payload) {
  return apiRequest(`/api/characters/${characterId}/images/${imageId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteCharacterImage(characterId, imageId) {
  return apiRequest(`/api/characters/${characterId}/images/${imageId}`, {
    method: 'DELETE'
  });
}

export function reorderCharacterImages(characterId, orderedIds) {
  return apiRequest(`/api/characters/${characterId}/images/order`, {
    method: 'PUT',
    body: JSON.stringify({ orderedIds })
  });
}

// ── World Books ──

export function fetchWorldBooks() {
  return apiRequest('/api/world-books');
}

export function createWorldBook(payload) {
  return apiRequest('/api/world-books', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchWorldBook(id) {
  return apiRequest(`/api/world-books/${id}`);
}

export function updateWorldBook(id, payload) {
  return apiRequest(`/api/world-books/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteWorldBook(id) {
  return apiRequest(`/api/world-books/${id}`, {
    method: 'DELETE'
  });
}

export function createWorldBookEntry(bookId, payload) {
  return apiRequest(`/api/world-books/${bookId}/entries`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateWorldBookEntry(bookId, entryId, payload) {
  return apiRequest(`/api/world-books/${bookId}/entries/${entryId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteWorldBookEntry(bookId, entryId) {
  return apiRequest(`/api/world-books/${bookId}/entries/${entryId}`, {
    method: 'DELETE'
  });
}

// ── Tags ──

export function fetchTags() {
  return apiRequest('/api/tags');
}

export function createTag(payload) {
  return apiRequest('/api/tags', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteTag(id) {
  return apiRequest(`/api/tags/${id}`, {
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

export function deleteConversation(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}`, {
    method: 'DELETE'
  });
}

export function deleteConversations(ids) {
  return apiRequest('/api/conversations/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });
}

export function fetchConversationMessages(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/messages`);
}

export function fetchConversationBranches(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/branches`);
}

export function branchConversation(conversationId, messageId) {
  return apiRequest(`/api/conversations/${conversationId}/branch`, {
    method: 'POST',
    body: JSON.stringify({ messageId })
  });
}

export function fetchMessageSwipes(_conversationId, messageId) {
  return apiRequest(`/api/messages/${messageId}/swipes`);
}

export function createMessageSwipe(_conversationId, messageId, payload = {}) {
  return apiRequest(`/api/messages/${messageId}/swipes`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchConversationSettings(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/settings`);
}

export function saveConversationSettings(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/settings`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function fetchConversationAccessorySkills(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/accessory-skills`);
}

export function saveConversationAccessorySkills(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/accessory-skills`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function saveCharacterAccessorySkills(characterId, payload) {
  return apiRequest(`/api/characters/${characterId}/accessory-skills`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

// ── Saves ──

export function fetchSaves(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/saves`);
}

export function createSave(conversationId, payload = {}) {
  return apiRequest(`/api/conversations/${conversationId}/saves`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchSave(saveId) {
  return apiRequest(`/api/saves/${saveId}`);
}

export function loadSave(saveId) {
  return apiRequest(`/api/saves/${saveId}/load`, {
    method: 'POST'
  });
}

export function renameSave(saveId, name) {
  return apiRequest(`/api/saves/${saveId}`, {
    method: 'PUT',
    body: JSON.stringify({ name })
  });
}

export function deleteSave(saveId) {
  return apiRequest(`/api/saves/${saveId}`, {
    method: 'DELETE'
  });
}

// ── Regex Rules ──

export function fetchRegexRules(group = '') {
  const params = new URLSearchParams();
  if (group) params.set('group', group);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/regex-rules${suffix}`);
}

export function toggleRegexRule(ruleId) {
  return apiRequest(`/api/regex-rules/${ruleId}/toggle`, { method: 'PUT' });
}

export function reorderRegexRules(orderedIds) {
  return apiRequest('/api/regex-rules/order', {
    method: 'PUT',
    body: JSON.stringify({ orderedIds })
  });
}

export function importRegexRuleSet(payload) {
  return apiRequest('/api/regex-rules/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ── Presets ──

export function fetchPresets() {
  return apiRequest('/api/presets');
}

export function createPreset(payload) {
  return apiRequest('/api/presets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchPreset(id) {
  return apiRequest(`/api/presets/${id}`);
}

export function updatePreset(id, payload) {
  return apiRequest(`/api/presets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deletePreset(id) {
  return apiRequest(`/api/presets/${id}`, {
    method: 'DELETE'
  });
}

export function setDefaultPreset(id) {
  return apiRequest(`/api/presets/${id}/set-default`, {
    method: 'POST'
  });
}

// ── Talent Pools ──

export function fetchTalentPools() {
  return apiRequest('/api/talent-pools');
}

export function createTalentPool(payload) {
  return apiRequest('/api/talent-pools', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateTalentPool(id, payload) {
  return apiRequest(`/api/talent-pools/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteTalentPool(id) {
  return apiRequest(`/api/talent-pools/${id}`, {
    method: 'DELETE'
  });
}

// ── Character Talents ──

export function rollCharacterTalent(characterId, poolId) {
  return apiRequest(`/api/characters/${characterId}/roll-talent`, {
    method: 'POST',
    body: JSON.stringify({ poolId })
  });
}

export function fetchCharacterTalents(characterId) {
  return apiRequest(`/api/characters/${characterId}/talents`);
}

export function deleteCharacterTalent(characterId, talentId) {
  return apiRequest(`/api/characters/${characterId}/talents/${talentId}`, {
    method: 'DELETE'
  });
}

export function deleteAllCharacterTalents(characterId) {
  return apiRequest(`/api/characters/${characterId}/talents`, {
    method: 'DELETE'
  });
}

// ── Mods ──

export function fetchMods() {
  return apiRequest('/api/mods');
}

export function createMod(payload) {
  return apiRequest('/api/mods', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateMod(id, payload) {
  return apiRequest(`/api/mods/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteMod(id) {
  return apiRequest(`/api/mods/${id}`, {
    method: 'DELETE'
  });
}

export function reorderMods(order) {
  return apiRequest('/api/mods/order', {
    method: 'PUT',
    body: JSON.stringify({ order })
  });
}

export function updateMessage(conversationId, messageId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function deleteMessage(conversationId, messageId) {
  return apiRequest(`/api/conversations/${conversationId}/messages/${messageId}`, {
    method: 'DELETE'
  });
}

export function sendMessage(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, stream: false })
  });
}

// ── Economy ──

export function fetchConversationEconomy(conversationId, options = {}) {
  const params = new URLSearchParams();
  if (options.ensure === false) {
    params.set('ensure', '0');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/economy${suffix}`);
}

export function createEconomyTransaction(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/economy/transaction`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchEconomyHistory(conversationId, params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  if (params.currencyType) query.set('currencyType', params.currencyType);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/conversations/${conversationId}/economy/history${suffix}`);
}

// ── Status Bar ──

export function fetchStatusBar(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`);
}

export function saveStatusBar(conversationId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteStatusBar(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/status-bar`, {
    method: 'DELETE'
  });
}

// ── NPC Agent Engine ──

export function fetchConversationNpcs(conversationId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs`);
}

export function fetchNpcMemories(conversationId, npcName) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories`);
}

export function addNpcMemory(conversationId, npcName, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteNpcMemory(conversationId, npcName, memoryId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/memories/${memoryId}`, {
    method: 'DELETE'
  });
}

export function fetchNpcBehaviors(conversationId, npcName) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors`);
}

export function addNpcBehavior(conversationId, npcName, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateNpcBehavior(conversationId, npcName, behaviorId, payload) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors/${behaviorId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function deleteNpcBehavior(conversationId, npcName, behaviorId) {
  return apiRequest(`/api/conversations/${conversationId}/npcs/${encodeURIComponent(npcName)}/behaviors/${behaviorId}`, {
    method: 'DELETE'
  });
}

export async function streamMessage(conversationId, payload, handlers = {}, signal) {
  const path = `/api/conversations/${conversationId}/messages`;
  await ensureCsrfToken();
  const body = JSON.stringify({ ...payload, stream: true });
  const buildRequest = () => ({
    method: 'POST',
    credentials: 'include',
    headers: {
      ...jsonHeaders,
      'X-CSRF-Token': getCsrfToken() || ''
    },
    body,
    signal
  });
  let streamBase = configuredApiBase;
  let response = await fetch(apiUrl(path, streamBase), buildRequest());

  if (shouldRetryApiOnBackend(path, response)) {
    streamBase = devBackendBase();
    response = await fetch(apiUrl(path, streamBase), buildRequest());
  }

  if (response.status === 403 || response.status === 419) {
    const detail = await response.clone().json().catch(() => ({}));
    if (isCsrfFailure(response, detail)) {
      await refreshCsrfToken();
      response = await fetch(apiUrl(path, streamBase), buildRequest());
    }
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
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase());
  if (isMutation) {
    await ensureCsrfToken();
  }
  const csrfHeaders = isMutation ? { 'X-CSRF-Token': getCsrfToken() || '' } : {};
  const response = await fetch(apiUrl(path, base), {
    credentials: 'include',
    ...options,
    headers: {
      ...csrfHeaders,
      ...(options.body ? jsonHeaders : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  return {
    response,
    data: text ? safeJson(text) : {},
    base
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

function shouldRetryAfterCsrf(response, data, options = {}) {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase());
  return isMutation && isCsrfFailure(response, data);
}

function isCsrfFailure(response, data = {}) {
  return [403, 419].includes(response.status) && /csrf/i.test(String(data.error || data.message || ''));
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
