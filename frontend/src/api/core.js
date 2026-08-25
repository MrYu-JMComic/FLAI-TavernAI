import { createSseParser } from '../../../shared/sse.js';
import { recordFrontendDiagnostic } from '../diagnostics.js';

const jsonHeaders = {
  'Content-Type': 'application/json'
};
const PAINT_YIELD_SSE_EVENTS = new Set(['content', 'reasoning', 'tool', 'step', 'nudge', 'ping']);

const MAX_ERROR_BODY_LENGTH = 1000;
const CONNECTION_RETRY_DELAYS_MS = [150, 450, 900];
const TRANSIENT_CONNECTION_STATUSES = new Set([408, 502, 503, 504]);

// ── CSRF Token 管理 ──
let csrfToken = '';

export function __resetApiCsrfTokenForTests() {
  csrfToken = '';
}

function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (typeof document === 'undefined' || !document.cookie) return csrfToken;
  const decoded = readCookieValue(document.cookie, 'flai_csrf');
  if (decoded) csrfToken = decoded;
  return csrfToken;
}

function readCookieValue(cookieText, cookieName) {
  const target = `${cookieName}=`;
  const text = String(cookieText || '');
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf(';', start);
    if (end === -1) {
      end = text.length;
    }
    let pairStart = start;
    while (pairStart < end && text.charCodeAt(pairStart) <= 32) {
      pairStart += 1;
    }
    if (text.startsWith(target, pairStart)) {
      return safeDecodeCookieValue(text.slice(pairStart + target.length, end).trim());
    }
    start = end + 1;
  }
  return '';
}

function safeDecodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export async function ensureCsrfToken() {
  if (getCsrfToken()) return csrfToken;
  try {
    const res = await fetchWithConnectionRetry(apiUrl('/api/csrf-token'), { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken || '';
  } catch (error) {
    recordFrontendDiagnostic('api.csrf.preload', error, { path: '/api/csrf-token' });
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

const configuredApiBase = normalizeBaseUrl(import.meta.env?.VITE_API_BASE_URL || '');

export async function apiRequest(path, options = {}) {
  let response;
  let data;
  let base;

  try {
    ({ response, data, base } = await requestJsonWithConnectionRetry(path, options));
  } catch (error) {
    throwApiError(normalizeNetworkError(error), null, { cause: error?.message || String(error) });
  }

  const retryBase = getApiBackendRetryBase(path, response);
  if (retryBase && !shouldBlockApiBackendRetry(data)) {
    ({ response, data, base } = await guardedRequestJson(path, options, retryBase));
  }

  if (shouldRetryAfterCsrf(response, data, options)) {
    await refreshCsrfToken();
    ({ response, data } = await guardedRequestJson(path, options, base));
  }

  if (!response.ok) {
    throwApiError(getResponseErrorMessage(response, data), response, data);
  }
  return data;
}

/**
 * Shared SSE streaming implementation.
 * Handles CSRF, retry, response validation, and SSE block parsing.
 * @param {string} path - API path
 * @param {object} payload - request payload (will be merged with { stream: true })
 * @param {object} handlers - event name → handler map
 * @param {AbortSignal} signal - abort signal
 * @param {object} options - { throwOnError, doneEventName, returnDoneData }
 * @returns {Promise<object|undefined>} - { aborted } or done event data
 */
export async function streamSSE(path, payload, handlers = {}, signal, options = {}) {
  const {
    throwOnError = false,
    returnDoneData = false,
    includeStreamFlag = true,
    method = 'POST'
  } = options;
  const requestMethod = String(method || 'POST').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod);
  if (isMutation) {
    await ensureCsrfToken();
  }
  const requestPayload = includeStreamFlag
    ? { ...(payload || {}), stream: true }
    : payload;
  const body = ['GET', 'HEAD'].includes(requestMethod)
    ? undefined
    : JSON.stringify(requestPayload ?? {});
  const buildRequest = () => ({
    method: requestMethod,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : jsonHeaders),
      Accept: 'text/event-stream',
      ...(isMutation ? { 'X-CSRF-Token': getCsrfToken() || '' } : {})
    },
    body,
    signal
  });

  let streamBase = configuredApiBase;
  let result = await fetchSseResponse(path, streamBase, buildRequest, signal);
  if (result.aborted) return { aborted: true };
  let response = result.response;
  let responseErrorDetail = null;

  const retryBase = getApiBackendRetryBase(path, response);
  if (retryBase) {
    const retryDetail = await readResponseBodyOrHttpError(response);
    if (!shouldBlockApiBackendRetry(retryDetail)) {
      streamBase = retryBase;
      result = await fetchSseResponse(path, streamBase, buildRequest, signal);
      if (result.aborted) return { aborted: true };
      response = result.response;
    } else {
      responseErrorDetail = retryDetail;
    }
  }

  if (isMutation && (response.status === 403 || response.status === 419)) {
    const detail = await readResponseBody(response).catch(() => ({}));
    if (isCsrfFailure(response, detail)) {
      await refreshCsrfToken();
      result = await fetchSseResponse(path, streamBase, buildRequest, signal);
      if (result.aborted) return { aborted: true };
      response = result.response;
    } else {
      responseErrorDetail = detail;
    }
  }

  if (!response.ok) {
    const detail = responseErrorDetail || (await readResponseBody(response).catch(() => ({})));
    throwApiError(getResponseErrorMessage(response, detail), response, detail);
  }

  const reader = getSseReader(response);
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let doneData = null;

  const handleSseEvent = async (event) => {
    if (signal?.aborted) return false;
    if (returnDoneData && event.name === 'done') {
      doneData = event.data;
    }
    if (throwOnError && event.name === 'error') {
      if (handlers.error) {
        await handlers.error(event.data);
      }
      throwApiError(
        getStructuredErrorMessage(event.data) || normalizeRawErrorText(event.rawText) || 'AI 助手生成失败',
        null,
        event.data
      );
    } else if (event.name && handlers[event.name]) {
      await handlers[event.name](event.data);
    }
    if (PAINT_YIELD_SSE_EVENTS.has(event.name)) {
      await nextPaint(signal);
    }
    return !signal?.aborted;
  };

  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          return { aborted: true };
        }
        throwApiError('流式响应中断，请检查网络后重试。', null, {
          cause: error?.message || String(error)
        });
      }

      const { done, value } = chunk;
      if (done) {
        break;
      }

      for (const rawEvent of parser.push(decoder.decode(value, { stream: true }))) {
        if (!await handleSseEvent(normalizeSseEvent(rawEvent))) return { aborted: true };
      }
    }

    for (const rawEvent of parser.push(decoder.decode())) {
      if (!await handleSseEvent(normalizeSseEvent(rawEvent))) return { aborted: true };
    }
    for (const rawEvent of parser.end()) {
      if (!await handleSseEvent(normalizeSseEvent(rawEvent))) return { aborted: true };
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return returnDoneData ? doneData : undefined;
}

export async function streamAssistantDraft(path, payload, handlers = {}, signal) {
  return streamSSE(path, payload, handlers, signal, { throwOnError: true, returnDoneData: true });
}

async function fetchSseResponse(path, base, buildRequest, signal) {
  try {
    return { response: await fetch(apiUrl(path, base), buildRequest()) };
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') {
      return { aborted: true };
    }
    throwApiError(normalizeNetworkError(error), null, { cause: error?.message || String(error) });
  }
}

function getSseReader(response) {
  if (response.body && typeof response.body.getReader === 'function') {
    return response.body.getReader();
  }
  throwApiError('流式响应不可用，请稍后重试。', response, { error: 'Missing response body' });
}

function normalizeSseEvent(event) {
  const rawText = String(event?.data ?? '');
  return {
    name: event?.event || 'message',
    data: safeJson(rawText),
    rawText
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  return parseResponseBody(text, response);
}

async function readResponseBodyOrHttpError(response) {
  try {
    return await readResponseBody(response);
  } catch (error) {
    if (response.ok) {
      throw error;
    }
    return { error: normalizeHttpError(response) };
  }
}

function parseResponseBody(text, response) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return response.ok ? {} : { rawText: truncateResponseText(text) };
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

  return {
    response,
    data: await readResponseBodyOrHttpError(response),
    base
  };
}

async function requestJsonWithConnectionRetry(path, options = {}, base = configuredApiBase) {
  let attempt = 0;
  while (true) {
    try {
      const result = await requestJson(path, options, base);
      if (!shouldRetryConnectionResponse(result.response, result.data, options, attempt)) {
        return result;
      }
    } catch (error) {
      if (!shouldRetryConnectionError(error, options, attempt)) {
        throw error;
      }
    }
    await waitForConnectionRetry(attempt);
    attempt += 1;
  }
}

async function fetchWithConnectionRetry(url, options = {}) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (!shouldRetryConnectionResponse(response, {}, options, attempt)) {
        return response;
      }
    } catch (error) {
      if (!shouldRetryConnectionError(error, options, attempt)) {
        throw error;
      }
    }
    await waitForConnectionRetry(attempt);
    attempt += 1;
  }
}

function apiUrl(path, base = configuredApiBase) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return base ? `${base}${path}` : path;
}

function getApiBackendRetryBase(path, response) {
  if (response.status !== 404 || !isApiPath(path) || configuredApiBase) {
    return '';
  }
  return devBackendBase();
}

function isApiPath(path) {
  return path === '/api' || path.startsWith('/api/');
}

function shouldBlockApiBackendRetry(data = {}) {
  return Boolean(getRetryBlockingErrorMessage(data));
}

function shouldRetryAfterCsrf(response, data, options = {}) {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase());
  return isMutation && isCsrfFailure(response, data);
}

function isCsrfFailure(response, data = {}) {
  const message = getReadableErrorMessage(data);
  return [403, 419].includes(response.status) && /csrf/i.test(message);
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

async function guardedRequestJson(path, options = {}, base = configuredApiBase) {
  try {
    return await requestJsonWithConnectionRetry(path, options, base);
  } catch (error) {
    throwApiError(normalizeNetworkError(error), null, { cause: error?.message || String(error) });
  }
}

function shouldRetryConnectionResponse(response, data, options = {}, attempt = 0) {
  return Boolean(
    canRetryConnection(options, attempt) &&
      TRANSIENT_CONNECTION_STATUSES.has(response.status) &&
      !getStructuredErrorMessage(data)
  );
}

function shouldRetryConnectionError(error, options = {}, attempt = 0) {
  return Boolean(canRetryConnection(options, attempt) && isTransientConnectionError(error));
}

function canRetryConnection(options = {}, attempt = 0) {
  return isIdempotentRequest(options) && attempt < CONNECTION_RETRY_DELAYS_MS.length && !options.signal?.aborted;
}

function isIdempotentRequest(options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function isTransientConnectionError(error) {
  const message = String(error?.message || error || '');
  return error instanceof TypeError || /Failed to fetch|NetworkError|fetch|ECONNREFUSED|ECONNRESET|terminated/i.test(message);
}

function waitForConnectionRetry(attempt) {
  const delayMs = CONNECTION_RETRY_DELAYS_MS[attempt] || 0;
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

function getResponseErrorMessage(response, data = {}) {
  const structuredMessage = getStructuredErrorMessage(data);
  if (structuredMessage) return structuredMessage;
  if (response.status === 502) return normalizeHttpError(response);
  return normalizeRawErrorText(data?.rawText) || normalizeHttpError(response);
}

function getReadableErrorMessage(data = {}) {
  return getStructuredErrorMessage(data) || normalizeRawErrorText(data?.rawText);
}

function getRetryBlockingErrorMessage(data = {}) {
  const structuredMessage = getStructuredErrorMessage(data);
  if (structuredMessage) return structuredMessage;
  const rawMessage = normalizeRawErrorText(data?.rawText);
  return isGenericDevNotFoundText(rawMessage) ? '' : rawMessage;
}

function getStructuredErrorMessage(data) {
  if (typeof data === 'string') return data.trim();
  if (!data || typeof data !== 'object') return '';
  return normalizeStructuredMessageValue(data.error) || normalizeStructuredMessageValue(data.message);
}

function normalizeStructuredMessageValue(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return normalizeStructuredMessageValue(value.message) || normalizeStructuredMessageValue(value.error);
}

function normalizeRawErrorText(text) {
  const value = String(text || '').trim();
  if (!value || value.startsWith('<')) return '';
  if (['{}', '[]', 'null'].includes(value)) return '';
  return value.replace(/\s+/g, ' ');
}

function isGenericDevNotFoundText(message) {
  return /^(not found|cannot (get|post|put|patch|delete) \/api(?:\/\S*)?)$/i.test(message);
}

function truncateResponseText(text) {
  const value = String(text || '').trim();
  if (value.length <= MAX_ERROR_BODY_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}

function normalizeHttpError(response) {
  if (response.status === 502) {
    return '后端连接中断或正在重启，请看后端日志窗口，等 3001 启动完成后重试。';
  }
  return `请求失败：${response.status}`;
}

function normalizeNetworkError(error) {
  const message = String(error?.message || error || '');
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) {
    return '无法连接后端服务，请确认 3001 后端窗口正在运行。';
  }
  return message || '请求失败，请稍后重试。';
}

function throwApiError(message, response, data) {
  const error = new Error(message);
  error.status = response?.status || 0;
  error.data = data;
  throw error;
}

function nextPaint(signal) {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let frameId = null;
    const timeoutId = setTimeout(finish, 80);
    const handleAbort = () => finish();

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (frameId !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameId);
      }
      signal?.removeEventListener?.('abort', handleAbort);
      resolve();
    }

    signal?.addEventListener?.('abort', handleAbort, { once: true });
    frameId = window.requestAnimationFrame(finish);
  });
}
