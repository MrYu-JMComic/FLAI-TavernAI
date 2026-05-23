import { decryptSecret } from '../security.js';

const deepSeekPricingCnyPerMillion = {
  'deepseek-v4-flash': {
    cachedInput: 0.02,
    uncachedInput: 1,
    output: 2
  },
  'deepseek-v4-pro': {
    cachedInput: 0.025,
    uncachedInput: 3,
    output: 6
  }
};

export const providerPresets = {
  openai: {
    providerType: 'openai',
    gatewayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    supportsReasoning: false,
    extraBody: {}
  },
  deepseek: {
    providerType: 'deepseek',
    gatewayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    supportsReasoning: true,
    extraBody: {}
  },
  gemini: {
    providerType: 'gemini',
    gatewayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    supportsReasoning: true,
    extraBody: {
      extra_body: {
        google: {
          thinking_config: {
            include_thoughts: true
          }
        }
      }
    }
  },
  custom: {
    providerType: 'custom',
    gatewayName: '自定义网关',
    baseUrl: '',
    model: '',
    supportsReasoning: false,
    extraBody: {}
  }
};

export function defaultProviderSettings() {
  return providerPresets.deepseek;
}

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

export function buildProviderBody(settings, messages, stream, options = {}) {
  const body = {
    model: normalizeProviderModel(settings.providerType, settings.model),
    messages,
    stream,
    ...settings.extraBody
  };

  if (settings.providerType === 'deepseek') {
    body.thinking = {
      type: options.thinkingEnabled === false ? 'disabled' : 'enabled'
    };
  }

  if (settings.providerType === 'deepseek' && stream && !body.stream_options) {
    body.stream_options = { include_usage: true };
  }

  return body;
}

export function buildUsageSnapshot(usage, metadata = {}) {
  if (!usage) {
    return null;
  }

  const providerType = metadata.providerType || metadata.provider_type || '';
  const model = normalizeProviderModel(providerType, metadata.model);
  const outputTokens = readNumber(usage.completion_tokens, usage.completionTokens, usage.output_tokens, usage.outputTokens, 0);
  const inputTokens = readNumber(usage.prompt_tokens, usage.promptTokens, usage.input_tokens, usage.inputTokens, 0);
  const explicitTotalTokens = readOptionalNumber(usage.total_tokens ?? usage.totalTokens ?? usage.total);
  const totalTokens = explicitTotalTokens ?? inputTokens + outputTokens;
  const cachedInputTokens = readNumber(
    usage.prompt_cache_hit_tokens,
    usage.promptCacheHitTokens,
    usage.input_cache_hit_tokens,
    usage.inputCacheHitTokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.promptTokensDetails?.cachedTokens,
    0
  );
  const uncachedInputTokens = readNumber(
    usage.prompt_cache_miss_tokens,
    usage.promptCacheMissTokens,
    usage.input_cache_miss_tokens,
    usage.inputCacheMissTokens,
    Math.max(inputTokens - cachedInputTokens, 0)
  );
  const pricing = providerType === 'deepseek' ? deepSeekPricingCnyPerMillion[model] : null;
  const totalCostCny = pricing
    ? roundMoney(
        (cachedInputTokens * pricing.cachedInput +
          uncachedInputTokens * pricing.uncachedInput +
          outputTokens * pricing.output) /
          1_000_000
      )
    : null;

  return {
    ...usage,
    _flai: {
      providerType,
      model,
      totalTokens,
      totalCostCny,
      currency: 'CNY'
    }
  };
}

export function summarizeUsageSnapshots(usages = []) {
  let totalTokens = 0;
  let totalCostCny = 0;
  let hasCost = false;

  for (const usage of usages) {
    if (!usage) {
      continue;
    }

    const flai = usage._flai || {};
    totalTokens += readNumber(flai.totalTokens, usage.total_tokens, usage.totalTokens, 0);
    const cost = readOptionalNumber(flai.totalCostCny);
    if (cost !== null) {
      hasCost = true;
      totalCostCny += cost;
    }
  }

  return {
    totalTokens,
    totalCostCny: hasCost ? roundMoney(totalCostCny) : null,
    currency: 'CNY'
  };
}

export function hasUsableProvider(settings) {
  return Boolean(settings?.baseUrl && settings?.model && settings?.apiKey && !settings?.apiKeyError);
}

export async function listProviderModels(settings) {
  if (!settings?.baseUrl) {
    throw new Error('请先填写 Base URL');
  }
  if (settings?.apiKeyError) {
    throw new Error(settings.apiKeyError);
  }
  if (!settings?.apiKey) {
    throw new Error('请先填写或保存 API Key');
  }

  const response = await fetch(`${trimSlash(settings.baseUrl)}/models`, {
    method: 'GET',
    headers: requestHeaders(settings.apiKey)
  });
  const json = await readJsonResponse(response);
  const models = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];

  return models
    .map((model) => {
      const id = typeof model === 'string' ? model : model.id || model.name || model.model;
      return id
        ? {
            id,
            label: model.display_name || model.displayName || model.name || id,
            ownedBy: model.owned_by || model.ownedBy || model.publisher || ''
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function generateCompletion(settings, messages, options = {}) {
  if (!hasUsableProvider(settings)) {
    return mockCompletion(messages, settings);
  }

  if (settings.providerType === 'openai' && settings.supportsReasoning && options.thinkingEnabled !== false) {
    return generateOpenAiResponse(settings, messages);
  }

  const response = await fetch(`${trimSlash(settings.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(settings.apiKey),
    body: JSON.stringify(buildProviderBody(settings, messages, false, options))
  });

  const json = await readJsonResponse(response);
  const message = json.choices?.[0]?.message || {};
  return {
    content: extractText(message.content),
    reasoning: extractReasoning(message),
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamCompletion(settings, messages, emit, signal, options = {}) {
  if (!hasUsableProvider(settings)) {
    return streamMockCompletion(messages, emit, settings);
  }

  if (settings.providerType === 'openai' && settings.supportsReasoning && options.thinkingEnabled !== false) {
    return streamOpenAiResponse(settings, messages, emit, signal);
  }

  const response = await fetch(`${trimSlash(settings.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(settings.apiKey),
    body: JSON.stringify(buildProviderBody(settings, messages, true, options)),
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;

  for await (const event of parseSse(response.body)) {
    if (event.data === '[DONE]') {
      break;
    }

    const json = parseJson(event.data, null);
    if (!json) {
      continue;
    }

    usage = json.usage || usage;
    const delta = json.choices?.[0]?.delta || {};
    const reasoningDelta = extractReasoning(delta);
    const contentDelta = extractText(delta.content);

    if (reasoningDelta) {
      reasoning += reasoningDelta;
      emit('reasoning', { text: reasoningDelta });
    }
    if (contentDelta) {
      content += contentDelta;
      emit('content', { text: contentDelta });
    }
  }

  return {
    content,
    reasoning,
    usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
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

async function generateOpenAiResponse(settings, messages) {
  const response = await fetch(`${trimSlash(settings.baseUrl)}/responses`, {
    method: 'POST',
    headers: requestHeaders(settings.apiKey),
    body: JSON.stringify({
      model: settings.model,
      input: messages,
      reasoning: { summary: 'auto' },
      ...settings.extraBody
    })
  });

  const json = await readJsonResponse(response);
  return {
    content: json.output_text || extractOpenAiOutputText(json),
    reasoning: extractOpenAiReasoning(json),
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

async function streamOpenAiResponse(settings, messages, emit, signal) {
  const response = await fetch(`${trimSlash(settings.baseUrl)}/responses`, {
    method: 'POST',
    headers: requestHeaders(settings.apiKey),
    body: JSON.stringify({
      model: settings.model,
      input: messages,
      reasoning: { summary: 'auto' },
      stream: true,
      ...settings.extraBody
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;

  for await (const event of parseSse(response.body)) {
    const json = parseJson(event.data, null);
    const type = json?.type || event.event;
    if (!json) {
      continue;
    }

    if (type === 'response.output_text.delta' && json.delta) {
      content += json.delta;
      emit('content', { text: json.delta });
    }

    if (type === 'response.reasoning_summary_text.delta' && json.delta) {
      reasoning += json.delta;
      emit('reasoning', { text: json.delta });
    }

    if (type === 'response.completed') {
      usage = json.response?.usage || usage;
    }
  }

  return {
    content,
    reasoning,
    usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

function mockCompletion(messages, settings = {}) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content || '';
  const providerHint = settings.apiKeyError
    ? settings.apiKeyError
    : '保存 API Key 后，这里会切换为真实模型回复。';
  return {
    content: `本地 Mock 回复：我收到了“${lastUserMessage}”。${providerHint}`,
    reasoning: '',
    usage: null,
    provider: 'Local Mock',
    providerType: 'mock',
    model: 'local-mock'
  };
}

async function streamMockCompletion(messages, emit, settings = {}) {
  const result = mockCompletion(messages, settings);
  for (const chunk of chunkText(result.content, 10)) {
    emit('content', { text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return result;
}

function requestHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
}

async function readJsonResponse(response) {
  const json = await response.json().catch(async () => {
    throw new Error(await responseErrorText(response));
  });

  if (!response.ok) {
    throw new Error(json.error?.message || json.message || `AI 请求失败：${response.status}`);
  }

  return json;
}

async function responseErrorText(response) {
  const text = await response.text().catch(() => '');
  if (!text) {
    return `AI 请求失败：${response.status}`;
  }

  return text.slice(0, 600);
}

async function* parseSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let match = buffer.match(/\r?\n\r?\n/);
    while (match) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = parseSseBlock(block);
      if (event.data) {
        yield event;
      }
      match = buffer.match(/\r?\n\r?\n/);
    }
  }
}

function parseSseBlock(block) {
  const event = { event: 'message', data: '' };
  const data = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event.event = line.slice(6).trim();
    }
    if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }

  event.data = data.join('\n');
  return event;
}

function extractReasoning(value = {}) {
  return extractText(
    value.reasoning_content ||
      value.reasoning ||
      value.thought ||
      value.thoughts ||
      value.thinking ||
      value.thinking_content
  );
}

function extractText(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractText(item?.text || item?.content || item)).join('');
  }

  if (typeof value === 'object') {
    return extractText(value.text || value.content);
  }

  return String(value);
}

function extractOpenAiOutputText(json) {
  return (json.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || '')
    .join('');
}

function extractOpenAiReasoning(json) {
  return (json.output || [])
    .filter((item) => item.type === 'reasoning')
    .flatMap((item) => item.summary || [])
    .map((item) => item.text || '')
    .join('\n');
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
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

function normalizeProviderModel(providerType, model) {
  const value = String(model || '').trim();
  if (providerType === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner'].includes(value)) {
    return providerPresets.deepseek.model;
  }

  return value;
}

function readNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
}

function readOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Number(value.toFixed(8));
}

function chunkText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}
