import { isLocalOrPrivateBaseUrl } from '../../../shared/privateNetwork.js';
import { parseJson } from '../utils/json.js';
import { normalizeProviderBaseUrl, trimSlash } from './providerUrls.js';
import { appConfig } from '../config.js';
import {
  assertProviderUrlAllowed,
  PROVIDER_MAX_REDIRECTS,
  providerUrlPolicyOptions
} from './providerUrlPolicy.js';
import { executeProviderRequest } from './providerResilience.js';

export async function providerFetch(settings, endpoint, options = {}) {
  const baseUrl = normalizeProviderBaseUrl(settings.providerType, settings.baseUrl);
  const url = `${trimSlash(baseUrl)}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const request = {
    ...options,
    headers: requestHeaders(settings, options.headers)
  };
  const response = await providerFetchUrl(settings, url, request);

  if (!shouldRetryProviderWithoutAuth(response, settings)) {
    return response;
  }

  if (response.body?.cancel) {
    await response.body.cancel().catch((error) => {
      console.error('[provider] Failed to cancel authenticated retry response body', error);
    });
  }
  return providerFetchUrl(settings, url, {
    ...options,
    headers: requestHeaders({ ...settings, apiKey: '' }, options.headers)
  });
}

export function providerFetchUrl(settings, url, request = {}) {
  return resilientProviderFetch(settings, String(url), request);
}

function resilientProviderFetch(settings, url, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const { idempotent, ...fetchRequest } = request;
  const resilienceKey = [
    String(settings.providerType || 'custom'),
    String(settings.model || ''),
    new URL(url).host
  ].join(':');
  return executeProviderRequest(
    resilienceKey,
    ({ signal }) => fetchProviderRequest(url, { ...fetchRequest, signal }, providerFetchPolicy(settings)),
    {
      signal: request.signal,
      timeoutMs: settings.timeoutMs,
      concurrency: settings.concurrencyLimit,
      retryBudget: settings.retryBudget,
      idempotent: ['GET', 'HEAD', 'OPTIONS'].includes(method) || idempotent === true
    }
  );
}

export async function readJsonResponse(response) {
  return readJsonResponseValue(response);
}

export async function readJsonResponseValue(response, options = {}) {
  const text = await response.text().catch(() => '');
  const json = parseJson(text || 'null', null);
  if (json === null) {
    throw new Error(responseErrorMessage(response, text));
  }

  if (!response.ok) {
    const errorMsg = providerJsonErrorMessage(json) || responseErrorMessage(response, text);
    // 包含响应内容以便诊断
    const detailedError = new Error(errorMsg);
    detailedError.response = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: text.length > 2000 ? text.substring(0, 2000) + '...(truncated)' : text,
      json: json
    };
    throw detailedError;
  }

  if ((Array.isArray(json) && !options.allowArray) || !json || typeof json !== 'object') {
    const detailedError = new Error('AI response JSON must be an object.');
    detailedError.response = {
      status: response.status,
      body: text.length > 2000 ? text.substring(0, 2000) + '...(truncated)' : text,
      json: json
    };
    throw detailedError;
  }

  return json;
}

export async function responseErrorText(response) {
  const text = await response.text().catch(() => '');
  return responseErrorMessage(response, text);
}

export async function fetchProviderRequest(url, request = {}, options = {}) {
  const policy = providerUrlPolicyOptions(options);
  let currentUrl = String(url);
  let currentRequest = { ...request, redirect: 'manual' };

  for (let redirectCount = 0; redirectCount <= PROVIDER_MAX_REDIRECTS; redirectCount += 1) {
    await assertProviderUrlAllowed(currentUrl, policy);
    let response;
    try {
      response = await fetch(currentUrl, currentRequest);
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        const timeoutError = new Error('AI 请求超时，请稍后重试或检查网关状态。', { cause: error });
        timeoutError.code = 'PROVIDER_TIMEOUT';
        timeoutError.retryable = true;
        throw timeoutError;
      }
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (!(error instanceof TypeError)) {
        throw error;
      }
      const networkError = new Error('AI 请求失败，请检查网络、Base URL 或网关状态。', { cause: error });
      networkError.code = 'PROVIDER_NETWORK_ERROR';
      networkError.retryable = true;
      throw networkError;
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    if (redirectCount === PROVIDER_MAX_REDIRECTS) {
      throw new Error('Provider 重定向次数超过限制。');
    }
    const location = response.headers?.get?.('location');
    if (!location) {
      throw new Error('Provider 重定向缺少目标地址。');
    }
    try {
      await response.body?.cancel?.();
    } catch {
      // The redirect response body is not needed after its Location is read.
    }
    currentUrl = new URL(location, currentUrl).toString();
    if (response.status === 303 && !['GET', 'HEAD'].includes(String(currentRequest.method || 'GET').toUpperCase())) {
      currentRequest = { ...currentRequest, method: 'GET', body: undefined };
    }
  }

  throw new Error('Provider 重定向失败。');
}

function providerFetchPolicy(settings = {}) {
  return {
    allowPrivateNetwork: settings.allowPrivateNetwork === true
      || (!appConfig.isProduction && appConfig.allowPrivateProviderNetworkInDevelopment),
    resolveDns: settings.resolveDns,
    lookup: settings.lookup
  };
}

function requestHeaders(settings = {}, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  const apiKey = settings.apiKey || '';
  if (settings.providerType === 'anthropic') {
    headers['anthropic-version'] = settings.anthropicVersion || '2023-06-01';
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    return {
      ...headers,
      ...extraHeaders
    };
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return {
    ...headers,
    ...extraHeaders
  };
}

function shouldRetryProviderWithoutAuth(response, settings) {
  return Boolean(settings?.apiKey && [401, 403].includes(response.status) && providerAllowsNoAuth(settings));
}

export function providerAllowsNoAuth(settings) {
  return settings?.providerType === 'custom' && isLocalOrPrivateBaseUrl(settings.baseUrl);
}

function providerJsonErrorMessage(json) {
  if (typeof json?.error === 'string') {
    return json.error;
  }
  return json?.error?.message || json?.message || '';
}

function responseErrorMessage(response, text = '') {
  const detail = String(text || '').trim();
  return detail ? detail.slice(0, 600) : `AI 请求失败：${response.status}`;
}
