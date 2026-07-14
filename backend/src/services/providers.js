import { createHash } from 'node:crypto';
import { decryptSecret } from '../security.js';
import { parseJson } from '../utils/json.js';
import {
  collectChatCompletionStreamPayloads,
  consumeChatCompletionStreamPayload,
  isJsonResponse,
  parseChatCompletionResult,
  streamChatCompletionJsonResponse
} from './providerChatCompletions.js';
import {
  generateAnthropicMessage,
  streamAnthropicMessage
} from './providerAnthropic.js';
import { createThinkingTagFilter } from './providerContent.js';
import {
  createStreamResponseDiagnostics,
  finalizeStreamDiagnostics,
  recordStreamEventDiagnostics
} from './providerDiagnostics.js';
import {
  normalizeProviderExtraBody
} from './providerExtraBody.js';
import {
  providerAllowsNoAuth,
  providerFetch,
  readJsonResponse,
  responseErrorText
} from './providerHttp.js';
import { mockCompletion, streamMockCompletion } from './providerMock.js';
import { normalizeProviderModel } from './providerModels.js';
import {
  generateOpenAiResponse,
  streamOpenAiResponse,
  usesResponsesApi
} from './providerOpenAiResponses.js';
import { hasUsableProvider } from './providerReadiness.js';
import { buildProviderBody } from './providerRequestBody.js';
import { defaultProviderSettings } from './providerRegistry.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';
import { trimSlash } from './providerUrls.js';

export { generateImage } from './providerImageGeneration.js';
export { isImageGenerationModel } from './providerImageModels.js';
export { defaultProviderSettings, providerPresets } from './providerRegistry.js';
export { normalizeProviderBaseUrl } from './providerUrls.js';
export { normalizeProviderExtraBody, normalizeProviderRequestExtraBody } from './providerExtraBody.js';
export { buildUsageSnapshot, summarizeUsageSnapshots } from './providerUsage.js';
export { hasUsableProvider } from './providerReadiness.js';
export { buildProviderBody } from './providerRequestBody.js';
export { runToolCompletion, streamToolCompletion } from './providerToolCompletions.js';

const providerModelCache = new Map();
const PROVIDER_MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
export function normalizeProviderRow(row) {
  if (!row) {
    return {
      ...defaultProviderSettings(),
      apiKeySet: false,
      apiKeyHint: null,
      apiKeyNeedsReset: false,
      apiKeyError: null
    };
  }

  const keyState = resolveApiKey(row);
  return {
    providerType: row.provider_type,
    gatewayName: row.gateway_name,
    baseUrl: row.base_url,
    model: normalizeProviderModel(row.provider_type, row.model),
    supportsReasoning: Boolean(row.supports_reasoning),
    extraBody: parseJson(row.extra_body, {}),
    apiKeySet: keyState.apiKeySet,
    apiKeyHint: row.api_key_hint || null,
    apiKeyNeedsReset: keyState.apiKeyNeedsReset,
    apiKeyError: keyState.apiKeyError,
    updatedAt: row.updated_at
  };
}

export function providerWithSecret(row) {
  const normalized = normalizeProviderRow(row);
  const keyState = resolveApiKey(row);

  return {
    ...normalized,
    ...keyState
  };
}

export async function listProviderModels(settings, options = {}) {
  options = options ?? {};
  if (!settings?.baseUrl) {
    throw new Error('请先填写 Base URL');
  }
  if (settings?.apiKeyError) {
    throw new Error(settings.apiKeyError);
  }
  if (!settings?.apiKey && !providerAllowsNoAuth(settings)) {
    throw new Error('请先填写或保存 API Key');
  }

  const cacheKey = providerModelCacheKey(settings);
  const cached = cacheKey ? providerModelCache.get(cacheKey) : null;
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cloneModels(cached.models);
  }

  const response = await providerFetch(settings, '/models', { method: 'GET' });
  const json = await readJsonResponse(response);
  const models = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];

  const normalized = [];
  for (const model of models) {
    const id = typeof model === 'string' ? model : model?.id || model?.name || model?.model;
    if (!id) {
      continue;
    }
    normalized.push({
      id,
      label: model?.display_name || model?.displayName || model?.name || id,
      ownedBy: model?.owned_by || model?.ownedBy || model?.publisher || ''
    });
  }
  normalized.sort((a, b) => a.id.localeCompare(b.id));

  if (cacheKey) {
    providerModelCache.set(cacheKey, {
      expiresAt: Date.now() + PROVIDER_MODEL_CACHE_TTL_MS,
      models: normalized
    });
  }

  return cloneModels(normalized);
}

function providerModelCacheKey(settings = {}) {
  const baseUrl = trimSlash(String(settings.baseUrl || '').trim()).toLowerCase();
  if (!baseUrl) {
    return '';
  }

  return [
    String(settings.providerType || '').trim().toLowerCase(),
    String(settings.gatewayName || '').trim().toLowerCase(),
    baseUrl,
    apiKeyCacheFingerprint(settings.apiKey),
    String(Boolean(settings.supportsReasoning)),
    stableStringifyExtraBody(settings.extraBody)
  ].join('|');
}

function apiKeyCacheFingerprint(apiKey) {
  const value = String(apiKey || '');
  if (!value) {
    return 'no-key';
  }
  return `key:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function cloneModels(models = []) {
  const cloned = [];
  for (const model of models) {
    cloned.push({ ...model });
  }
  return cloned;
}

function stableStringifyExtraBody(value) {
  const extraBody = normalizeProviderExtraBody(value);
  if (!Object.keys(extraBody).length) {
    return '{}';
  }
  try {
    return JSON.stringify(sortObject(extraBody));
  } catch {
    return String(extraBody || '').trim();
  }
}

function sortObject(value) {
  if (Array.isArray(value)) {
    const sortedItems = [];
    for (const item of value) {
      sortedItems.push(sortObject(item));
    }
    return sortedItems;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sorted[key] = sortObject(value[key]);
  }
  return sorted;
}

export const NON_STREAM_COMPLETION_TIMEOUT_MS = 300_000;

function buildNonStreamSignal(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : NON_STREAM_COMPLETION_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
}

export async function generateCompletion(settings, messages, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    return mockCompletion(messages, settings);
  }

  // Non-stream requests otherwise hang forever on a stuck gateway; bound them
  // with the same 300s ceiling the stream path uses.
  const signal = buildNonStreamSignal(options);
  options = { ...options, signal };

  if (settings.providerType === 'anthropic') {
    return generateAnthropicMessage(settings, messages, options);
  }

  if (usesResponsesApi(settings)) {
    return generateOpenAiResponse(settings, messages, options);
  }

  const response = await providerFetch(settings, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify(buildProviderBody(settings, messages, false, options)),
    signal
  });

  const json = await readJsonResponse(response);
  return parseChatCompletionResult(json, settings);
}

export async function streamCompletion(settings, messages, emit, signal, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    const streamEmit = createStreamEmitQueue(emit);
    const result = await streamMockCompletion(messages, streamEmit.emit, settings);
    await streamEmit.wait();
    return result;
  }

  if (settings.providerType === 'anthropic') {
    return streamAnthropicMessage(settings, messages, emit, signal, options);
  }

  if (usesResponsesApi(settings)) {
    return streamOpenAiResponse(settings, messages, emit, signal, options);
  }

  const response = await providerFetch(settings, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify(buildProviderBody(settings, messages, true, options)),
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  const streamEmit = createStreamEmitQueue(emit);
  if (isJsonResponse(response)) {
    const result = await streamChatCompletionJsonResponse(response, settings, streamEmit.emit);
    await streamEmit.wait();
    return result;
  }

  const state = { content: '', reasoning: '', usage: null };
  const diagnostics = createStreamResponseDiagnostics(response);
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      state.content += text;
      streamEmit.emit('content', { text });
    },
    onReasoning(text) {
      state.reasoning += text;
      streamEmit.emit('reasoning', { text });
    }
  });

  for await (const event of parseSse(response.body)) {
    if (event.data === '[DONE]') {
      diagnostics.doneEvent = true;
      break;
    }

    const json = parseJson(event.data, null);
    if (!json) {
      recordStreamEventDiagnostics(diagnostics, event, null);
      continue;
    }

    recordStreamEventDiagnostics(diagnostics, event, json);
    for (const payload of collectChatCompletionStreamPayloads(json)) {
      consumeChatCompletionStreamPayload(payload, event, state, thinkingTagFilter, streamEmit.emit);
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  await streamEmit.wait();

  return {
    content: state.content,
    reasoning: state.reasoning,
    usage: state.usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model),
    diagnostics: finalizeStreamDiagnostics(diagnostics)
  };
}

export async function fetchDeepSeekBalance(settings) {
  if (settings?.apiKeyError) {
    throw new Error(settings.apiKeyError);
  }
  if (!settings?.apiKey) {
    throw new Error('请先保存 DeepSeek API Key');
  }

  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      Accept: 'application/json'
    }
  });

  return readJsonResponse(response);
}

function resolveApiKey(row) {
  if (!row?.encrypted_api_key) {
    return {
      apiKey: '',
      apiKeySet: false,
      apiKeyNeedsReset: false,
      apiKeyError: null
    };
  }

  try {
    return {
      apiKey: decryptSecret(row.encrypted_api_key),
      apiKeySet: true,
      apiKeyNeedsReset: false,
      apiKeyError: null
    };
  } catch {
    return {
      apiKey: '',
      apiKeySet: false,
      apiKeyNeedsReset: true,
      apiKeyError: '已保存的 API Key 无法解密，请重新输入并保存。'
    };
  }
}
