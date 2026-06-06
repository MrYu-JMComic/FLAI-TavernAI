import { createHash } from 'node:crypto';
import { decryptSecret } from '../security.js';
import { parseJson } from '../utils/json.js';

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

const providerModelCache = new Map();
const PROVIDER_MODEL_CACHE_TTL_MS = 30 * 60 * 1000;

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
  anthropic: {
    providerType: 'anthropic',
    gatewayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    supportsReasoning: true,
    extraBody: {}
  },
  xai: {
    providerType: 'xai',
    gatewayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.1',
    supportsReasoning: true,
    extraBody: {}
  },
  mistral: {
    providerType: 'mistral',
    gatewayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-medium-3-5',
    supportsReasoning: true,
    extraBody: {}
  },
  qwen: {
    providerType: 'qwen',
    gatewayName: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-plus',
    supportsReasoning: true,
    extraBody: {}
  },
  glm: {
    providerType: 'glm',
    gatewayName: 'Z.AI GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.1',
    supportsReasoning: true,
    extraBody: {}
  },
  kimi: {
    providerType: 'kimi',
    gatewayName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    supportsReasoning: true,
    extraBody: {}
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
  options = options ?? {};
  const extraBody = normalizeProviderExtraBody(settings.extraBody);
  const body = {
    model: resolveProviderModel(settings, options),
    messages,
    stream,
    ...extraBody
  };

  // Apply preset / override parameters
  if (options.temperature != null) {
    body.temperature = Number(options.temperature);
  }
  if (options.maxTokens != null) {
    body.max_tokens = Number(options.maxTokens);
  }
  if (options.topP != null) {
    body.top_p = Number(options.topP);
  }
  if (options.frequencyPenalty != null) {
    body.frequency_penalty = Number(options.frequencyPenalty);
  }
  if (options.presencePenalty != null) {
    body.presence_penalty = Number(options.presencePenalty);
  }

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice || 'auto';
  }

  applyNativeChatReasoningSwitch(body, settings, options);

  if (settings.providerType === 'deepseek' && stream && !body.stream_options) {
    body.stream_options = { include_usage: true };
  }
  if (isDeepSeekThinkingEnabled(body, settings)) {
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
  }
  if (settings.providerType === 'kimi' && isKimiThinkingModel(body.model)) {
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
  }

  return body;
}

function applyNativeChatReasoningSwitch(body, settings = {}, options = {}) {
  if (!settings.supportsReasoning) {
    return;
  }

  if (settings.providerType === 'gemini') {
    applyGeminiReasoningEffort(body, options);
  }

  if (settings.providerType === 'mistral' || settings.providerType === 'xai') {
    applyReasoningEffortSwitch(body, options);
  }

  if (settings.providerType === 'qwen') {
    applyQwenThinkingSwitch(body, options);
  }

  if (settings.providerType === 'glm') {
    applyGlmThinkingSwitch(body, options);
  }

  if (settings.providerType === 'kimi') {
    applyKimiThinkingSwitch(body, options);
  }

  if (settings.providerType === 'deepseek') {
    applyDeepSeekThinkingSwitch(body, options);
  }
}

function applyDeepSeekThinkingSwitch(body, options = {}) {
  const thinkingEnabled = options.thinkingEnabled !== false;
  body.thinking = {
    type: thinkingEnabled ? 'enabled' : 'disabled'
  };

  if (!thinkingEnabled) {
    delete body.reasoning_effort;
    return;
  }

  if (body.reasoning_effort === undefined) {
    body.reasoning_effort = 'high';
  }
}

function isDeepSeekThinkingEnabled(body, settings = {}) {
  return settings.providerType === 'deepseek' && settings.supportsReasoning && body.thinking?.type === 'enabled';
}

function applyReasoningEffortSwitch(body, options = {}) {
  if (body.reasoning_effort !== undefined) {
    return;
  }
  body.reasoning_effort = options.thinkingEnabled === false ? 'none' : 'high';
}

function applyQwenThinkingSwitch(body, options = {}) {
  body.enable_thinking = options.thinkingEnabled !== false;
}

function applyGlmThinkingSwitch(body, options = {}) {
  body.thinking = {
    ...(body.thinking && typeof body.thinking === 'object' ? body.thinking : {}),
    type: options.thinkingEnabled === false ? 'disabled' : 'enabled'
  };
}

function applyKimiThinkingSwitch(body, options = {}) {
  if (options.thinkingEnabled === false) {
    body.thinking = { type: 'disabled' };
    return;
  }
  delete body.thinking;
}

function applyGeminiReasoningEffort(body, options = {}) {
  if (body.reasoning_effort !== undefined || hasGeminiExplicitThinkingBudget(body)) {
    return;
  }
  body.reasoning_effort = options.thinkingEnabled === false
    ? resolveGeminiLowLatencyEffort(body.model)
    : 'high';
}

function hasGeminiExplicitThinkingBudget(body = {}) {
  const thinkingConfig = body.extra_body?.google?.thinking_config ||
    body.extra_body?.extra_body?.google?.thinking_config;
  return Boolean(thinkingConfig?.thinking_level || thinkingConfig?.thinkingLevel || thinkingConfig?.thinking_budget || thinkingConfig?.thinkingBudget);
}

function resolveGeminiLowLatencyEffort(model) {
  const value = String(model || '').toLowerCase();
  if (value.includes('2.5') && value.includes('flash') && !value.includes('pro')) {
    return 'none';
  }
  return 'low';
}

function isKimiThinkingModel(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('kimi-k2.5') || value.includes('kimi-k2-thinking') || value.includes('kimi-k2.6');
}

export function buildUsageSnapshot(usage, metadata = {}) {
  if (!usage) {
    return null;
  }
  metadata = metadata ?? {};

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
  usages = usages && typeof usages[Symbol.iterator] === 'function' ? usages : [];
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
  return Boolean(
    settings?.baseUrl &&
      settings?.model &&
      !settings?.apiKeyError &&
      (settings?.apiKey || providerAllowsNoAuth(settings))
  );
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

  const normalized = models
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
  return models.map((model) => ({ ...model }));
}

export function normalizeProviderExtraBody(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return {};
  }
  return value;
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
    return value.map(sortObject);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
}

export async function runToolCompletion(settings, messages, tools, executeTool, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    throw new Error('请先在用户页保存 API Key / SK，并确认网关和模型可用。');
  }

  if (settings.providerType === 'anthropic') {
    return runAnthropicToolCompletion(settings, messages, tools, executeTool, options);
  }

  const maxRounds = Math.min(Math.max(Number(options.maxRounds || 6), 1), 10);
  const nextMessages = messages.map((message) => ({ ...message }));
  const toolCalls = [];
  const process = [];
  let finalMessage = null;
  let usage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await providerFetch(settings, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(
        buildProviderBody(settings, nextMessages, false, {
          ...options,
          tools,
          toolChoice: options.toolChoice || 'auto',
          thinkingEnabled: options.thinkingEnabled ?? false
        })
      ),
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    usage = json.usage || usage;
    const message = extractChatMessage(json);
    finalMessage = message;
    const calls = normalizeToolCalls(message.tool_calls);
    const parsedContent = splitThinkingTags(extractText(message.content));
    const step = {
      round: round + 1,
      content: parsedContent.content,
      reasoning: mergeReasoning(extractReasoning(message), parsedContent.reasoning),
      tools: []
    };
    process.push(step);

    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        nextMessages.push({ role: 'assistant', content: step.content || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      break;
    }

    nextMessages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: calls.map((call) => call.raw)
    });

    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments, call);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      step.tools.push(log);
      toolCalls.push(log);
      nextMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
      if (result?.stop === true) {
        return {
          content: step.content,
          reasoning: step.reasoning,
          message,
          usage,
          toolCalls,
          process
        };
      }
    }
  }

  const finalParsedContent = splitThinkingTags(extractText(finalMessage?.content));
  return {
    content: finalParsedContent.content,
    reasoning: mergeReasoning(extractReasoning(finalMessage || {}), finalParsedContent.reasoning),
    message: finalMessage,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamToolCompletion(settings, messages, tools, executeTool, emit, signal, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    return streamMockCompletion(messages, emit, settings);
  }

  if (settings.providerType === 'anthropic') {
    return streamAnthropicToolCompletion(settings, messages, tools, executeTool, emit, signal, options);
  }

  const maxRounds = Math.min(Math.max(Number(options.maxRounds || 6), 1), 10);
  const nextMessages = messages.map((message) => ({ ...message }));
  const toolCalls = [];
  const process = [];
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const step = {
      round: round + 1,
      content: '',
      reasoning: '',
      tools: []
    };
    process.push(step);
    emit('step', step);

    const response = await providerFetch(settings, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(
        buildProviderBody(settings, nextMessages, true, {
          ...options,
          tools,
          toolChoice: options.toolChoice || 'auto',
          thinkingEnabled: options.thinkingEnabled ?? false
        })
      ),
      signal
    });

    if (!response.ok) {
      throw new Error(await responseErrorText(response));
    }

    let roundContent = '';
    let roundReasoning = '';
    const pendingToolCalls = new Map();
    const thinkingTagFilter = createThinkingTagFilter({
      onContent(text) {
        roundContent += text;
        finalContent += text;
        step.content += text;
        emit('content', { round: step.round, text });
      },
      onReasoning(text) {
        roundReasoning += text;
        finalReasoning += text;
        step.reasoning += text;
        emit('reasoning', { round: step.round, text });
      }
    });

    for await (const event of parseSse(response.body)) {
      if (event.data === '[DONE]') {
        break;
      }

      const json = parseJson(event.data, null);
      if (!json) {
        continue;
      }

      usage = json.usage || usage;
      const delta = extractStreamingDelta(json);
      const reasoningDelta = extractReasoning(delta);
      const contentDelta = extractText(delta.content);
      if (reasoningDelta) {
        roundReasoning += reasoningDelta;
        finalReasoning += reasoningDelta;
        step.reasoning += reasoningDelta;
        emit('reasoning', { round: step.round, text: reasoningDelta });
      }
      if (contentDelta) {
        thinkingTagFilter.push(contentDelta);
      }

      const deltaToolCalls = normalizeStreamingToolCalls(delta.tool_calls);
      for (const call of deltaToolCalls) {
        const existing = pendingToolCalls.get(call.index) || {
          id: call.id,
          name: '',
          arguments: ''
        };
        if (call.id) existing.id = call.id;
        if (call.name) existing.name = call.name;
        if (call.arguments) existing.arguments += call.arguments;
        pendingToolCalls.set(call.index, existing);
      }
    }
    thinkingTagFilter.flush();

    const calls = [...pendingToolCalls.values()]
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id || `tool-call-${round}-${index}`,
        name: call.name,
        arguments: parseJson(call.arguments || '{}', {}),
        raw: {
          id: call.id || `tool-call-${round}-${index}`,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.arguments || '{}'
          }
        }
      }));

    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        emit('nudge', { round: step.round, text: String(nudge) });
        nextMessages.push({ role: 'assistant', content: roundContent || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      return {
        content: finalContent,
        reasoning: finalReasoning,
        usage,
        toolCalls,
        process,
        provider: settings.gatewayName,
        providerType: settings.providerType,
        model: normalizeProviderModel(settings.providerType, settings.model)
      };
    }

    nextMessages.push({
      role: 'assistant',
      content: roundContent || null,
      tool_calls: calls.map((call) => call.raw)
    });

    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments, call);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      toolCalls.push(log);
      step.tools.push(log);
      emit('tool', { round: step.round, ...log });
      nextMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  return {
    content: finalContent,
    reasoning: finalReasoning,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function generateCompletion(settings, messages, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    return mockCompletion(messages, settings);
  }

  if (settings.providerType === 'anthropic') {
    return generateAnthropicMessage(settings, messages, options);
  }

  if (usesResponsesApi(settings)) {
    return generateOpenAiResponse(settings, messages, options);
  }

  const response = await providerFetch(settings, '/chat/completions', {
    method: 'POST',
    body: JSON.stringify(buildProviderBody(settings, messages, false, options))
  });

  const json = await readJsonResponse(response);
  const message = extractChatMessage(json);
  const parsedContent = splitThinkingTags(extractText(message.content));
  const reasoning = mergeReasoning(extractReasoning(message), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamCompletion(settings, messages, emit, signal, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    return streamMockCompletion(messages, emit, settings);
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

  let content = '';
  let reasoning = '';
  let usage = null;
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      content += text;
      emit('content', { text });
    },
    onReasoning(text) {
      reasoning += text;
      emit('reasoning', { text });
    }
  });

  for await (const event of parseSse(response.body)) {
    if (event.data === '[DONE]') {
      break;
    }

    const json = parseJson(event.data, null);
    if (!json) {
      continue;
    }

    usage = json.usage || usage;
    const delta = extractStreamingDelta(json);
    const reasoningDelta = extractReasoning(delta);
    const contentDelta = extractText(delta.content);

    if (reasoningDelta) {
      reasoning += reasoningDelta;
      emit('reasoning', { text: reasoningDelta });
    }
    if (contentDelta) {
      thinkingTagFilter.push(contentDelta);
    }
  }
  thinkingTagFilter.flush();

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

function usesResponsesApi(settings = {}) {
  return Boolean(settings.supportsReasoning && ['openai', 'xai'].includes(settings.providerType));
}

async function generateAnthropicMessage(settings, messages, options = {}) {
  const requestBody = buildAnthropicBody(settings, messages, false, options);
  const response = await providerFetch(settings, '/messages', {
    method: 'POST',
    body: JSON.stringify(requestBody)
  });

  const json = await readJsonResponse(response);
  const parsedContent = splitThinkingTags(extractText(json.content));
  const reasoning = mergeReasoning(extractReasoningBlocks(json.content), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, json.model || settings.model)
  };
}

async function streamAnthropicMessage(settings, messages, emit, signal, options = {}) {
  const requestBody = buildAnthropicBody(settings, messages, true, options);
  const response = await providerFetch(settings, '/messages', {
    method: 'POST',
    body: JSON.stringify(requestBody),
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      content += text;
      emit('content', { text });
    },
    onReasoning(text) {
      reasoning += text;
      emit('reasoning', { text });
    }
  });

  for await (const event of parseSse(response.body)) {
    const json = parseJson(event.data, null);
    if (!json) {
      continue;
    }

    if (json.type === 'content_block_delta') {
      const delta = json.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        thinkingTagFilter.push(delta.text);
      }
      if ((delta.type === 'thinking_delta' || delta.type === 'signature_delta') && delta.thinking) {
        reasoning += delta.thinking;
        emit('reasoning', { text: delta.thinking });
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        thinkingTagFilter.push(delta.partial_json);
      }
    }

    if (json.type === 'message_delta' && json.usage) {
      usage = {
        ...(usage || {}),
        ...json.usage
      };
    }
    if (json.type === 'message_stop') {
      break;
    }
  }
  thinkingTagFilter.flush();

  return {
    content,
    reasoning,
    usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

function buildAnthropicBody(settings, messages, stream, options = {}) {
  const converted = convertMessagesForAnthropic(messages);
  return buildAnthropicRequestBody(settings, converted.system, converted.messages, stream, options);
}

function buildAnthropicRequestBody(settings, system, messages, stream, options = {}) {
  const extraBody = normalizeProviderExtraBody(settings.extraBody);
  const maxTokens = Math.max(1, Number(options.maxTokens ?? extraBody.max_tokens ?? extraBody.maxTokens ?? 4096));
  const body = {
    model: normalizeProviderModel(settings.providerType, settings.model),
    max_tokens: maxTokens,
    messages,
    stream,
    ...extraBody
  };

  if (system) {
    body.system = system;
  }
  if (options.temperature != null) {
    body.temperature = Number(options.temperature);
  }
  if (options.topP != null) {
    body.top_p = Number(options.topP);
  }
  if (options.tools?.length) {
    body.tools = convertToolsForAnthropic(options.tools);
    body.tool_choice = convertToolChoiceForAnthropic(options.toolChoice);
  }

  applyAnthropicThinkingSwitch(body, settings, options);
  return body;
}

async function runAnthropicToolCompletion(settings, messages, tools, executeTool, options = {}) {
  const maxRounds = Math.min(Math.max(Number(options.maxRounds || 6), 1), 10);
  const converted = convertMessagesForAnthropic(messages);
  const nextMessages = converted.messages.map((message) => ({ ...message }));
  const toolCalls = [];
  const process = [];
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;
  let finalMessage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const body = buildAnthropicRequestBody(settings, converted.system, nextMessages, false, {
      ...options,
      tools,
      toolChoice: options.toolChoice || 'auto',
      thinkingEnabled: options.thinkingEnabled ?? false
    });
    const response = await providerFetch(settings, '/messages', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    finalMessage = json;
    usage = json.usage || usage;

    const parsedContent = splitThinkingTags(extractText(json.content));
    const reasoning = mergeReasoning(extractReasoningBlocks(json.content), parsedContent.reasoning);
    const step = {
      round: round + 1,
      content: parsedContent.content,
      reasoning,
      tools: []
    };
    process.push(step);
    finalContent += parsedContent.content;
    finalReasoning = mergeReasoning(finalReasoning, reasoning);

    const calls = normalizeAnthropicToolUses(json.content);
    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        nextMessages.push({ role: 'assistant', content: json.content || step.content || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      break;
    }

    nextMessages.push({
      role: 'assistant',
      content: json.content || []
    });

    const toolResults = [];
    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments, call);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      step.tools.push(log);
      toolCalls.push(log);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result)
      });
      if (result?.stop === true) {
        return {
          content: finalContent,
          reasoning: finalReasoning,
          message: finalMessage,
          usage,
          toolCalls,
          process,
          provider: settings.gatewayName,
          providerType: settings.providerType,
          model: normalizeProviderModel(settings.providerType, settings.model)
        };
      }
    }

    nextMessages.push({
      role: 'user',
      content: toolResults
    });
  }

  return {
    content: finalContent,
    reasoning: finalReasoning,
    message: finalMessage,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

async function streamAnthropicToolCompletion(settings, messages, tools, executeTool, emit, signal, options = {}) {
  const result = await runAnthropicToolCompletion(settings, messages, tools, executeTool, {
    ...options,
    signal
  });

  for (const step of result.process || []) {
    emit('step', step);
    if (step.reasoning) {
      emit('reasoning', { round: step.round, text: step.reasoning });
    }
    if (step.content) {
      emit('content', { round: step.round, text: step.content });
    }
    for (const tool of step.tools || []) {
      emit('tool', { round: step.round, ...tool });
    }
  }

  return result;
}

function applyAnthropicThinkingSwitch(body, settings = {}, options = {}) {
  if (!settings.supportsReasoning) {
    return;
  }
  if (options.thinkingEnabled === false) {
    delete body.thinking;
    return;
  }

  if (body.thinking && typeof body.thinking === 'object') {
    return;
  }

  if (usesAnthropicAdaptiveThinking(body.model)) {
    body.thinking = {
      type: 'adaptive',
      display: 'summarized'
    };
    body.output_config = {
      ...(body.output_config || {}),
      effort: body.output_config?.effort || 'high'
    };
    return;
  }

  const budgetTokens = Math.max(1024, Math.min(8192, Number(body.max_tokens) - 1024 || 2048));
  body.thinking = {
    type: 'enabled',
    budget_tokens: budgetTokens,
    display: 'summarized'
  };
  if (Number(body.max_tokens) <= budgetTokens) {
    body.max_tokens = budgetTokens + 1024;
  }
}

function usesAnthropicAdaptiveThinking(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('claude-opus-4-7') ||
    value.includes('claude-opus-4-8') ||
    value.includes('claude-sonnet-4-6') ||
    value.includes('claude-opus-4-6') ||
    value.includes('claude-mythos');
}

function convertMessagesForAnthropic(messages = []) {
  messages = messages && typeof messages[Symbol.iterator] === 'function' ? messages : [];
  const system = [];
  const converted = [];

  for (const message of messages) {
    const role = message?.role;
    const content = extractText(message?.content);
    if (!content) {
      continue;
    }
    if (role === 'system') {
      system.push(content);
      continue;
    }
    if (role === 'user' || role === 'assistant') {
      converted.push({ role, content });
    }
  }

  return {
    system: system.join('\n\n'),
    messages: converted.length ? converted : [{ role: 'user', content: '' }]
  };
}

function convertToolsForAnthropic(tools = []) {
  return tools
    .map((tool) => {
      const fn = tool?.function || {};
      const name = fn.name || tool.name;
      if (!name) {
        return null;
      }
      return {
        name,
        description: fn.description || tool.description || '',
        input_schema: fn.parameters || tool.input_schema || {
          type: 'object',
          properties: {}
        }
      };
    })
    .filter(Boolean);
}

function convertToolChoiceForAnthropic(toolChoice) {
  if (!toolChoice || toolChoice === 'auto') {
    return { type: 'auto' };
  }
  if (toolChoice === 'none') {
    return { type: 'none' };
  }
  if (typeof toolChoice === 'string') {
    return { type: 'tool', name: toolChoice };
  }
  const name = toolChoice?.function?.name || toolChoice?.name;
  return name ? { type: 'tool', name } : { type: 'auto' };
}

function normalizeAnthropicToolUses(content = []) {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((item) => item?.type === 'tool_use' && item.name)
    .map((item) => ({
      id: item.id || newIdForToolUse(item.name),
      name: item.name,
      arguments: item.input && typeof item.input === 'object' ? item.input : parseJson(item.input || '{}', {})
    }));
}

function newIdForToolUse(name) {
  return `tool-use-${String(name || 'call').replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}`;
}

async function generateOpenAiResponse(settings, messages, options = {}) {
  const response = await providerFetch(settings, '/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: resolveProviderModel(settings, options),
      input: messages,
      reasoning: buildOpenAiReasoning(settings, options),
      ...normalizeProviderExtraBody(settings.extraBody)
    })
  });

  const json = await readJsonResponse(response);
  const parsedContent = splitThinkingTags(json.output_text || extractOpenAiOutputText(json));
  const reasoning = mergeReasoning(extractOpenAiReasoning(json), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

async function streamOpenAiResponse(settings, messages, emit, signal, options = {}) {
  const response = await providerFetch(settings, '/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: resolveProviderModel(settings, options),
      input: messages,
      reasoning: buildOpenAiReasoning(settings, options),
      stream: true,
      ...normalizeProviderExtraBody(settings.extraBody)
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      content += text;
      emit('content', { text });
    },
    onReasoning(text) {
      reasoning += text;
      emit('reasoning', { text });
    }
  });

  for await (const event of parseSse(response.body)) {
    const json = parseJson(event.data, null);
    const type = json?.type || event.event;
    if (!json) {
      continue;
    }

    if (type === 'response.output_text.delta' && json.delta) {
      thinkingTagFilter.push(json.delta);
    }

    const reasoningDelta = extractResponsesReasoningDelta(type, json);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      emit('reasoning', { text: reasoningDelta });
    }

    if (type === 'response.completed') {
      usage = json.response?.usage || usage;
    }
  }
  thinkingTagFilter.flush();

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

async function providerFetch(settings, endpoint, options = {}) {
  const url = `${trimSlash(settings.baseUrl)}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const request = {
    ...options,
    headers: requestHeaders(settings, options.headers)
  };
  const response = await fetchProviderRequest(url, request);

  if (!shouldRetryProviderWithoutAuth(response, settings)) {
    return response;
  }

  if (response.body?.cancel) {
    await response.body.cancel().catch(() => null);
  }
  return fetchProviderRequest(url, {
    ...options,
    headers: requestHeaders({ ...settings, apiKey: '' }, options.headers)
  });
}

async function fetchProviderRequest(url, request) {
  try {
    return await fetch(url, request);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new Error('AI 请求失败，请检查网络、Base URL 或网关状态。', { cause: error });
  }
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

function providerAllowsNoAuth(settings) {
  return settings?.providerType === 'custom' && isLocalOrPrivateBaseUrl(settings.baseUrl);
}

function isLocalOrPrivateBaseUrl(value) {
  try {
    const { hostname } = new URL(String(value || ''));
    const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) || host.startsWith('127.')) {
      return true;
    }
    const parts = host.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && parts[1] === 18)
    );
  } catch {
    return false;
  }
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => '');
  const json = parseJson(text || 'null', null);
  if (json === null) {
    throw new Error(responseErrorMessage(response, text));
  }

  if (!response.ok) {
    throw new Error(providerJsonErrorMessage(json) || responseErrorMessage(response, text));
  }

  if (Array.isArray(json) || typeof json !== 'object') {
    throw new Error('AI response JSON must be an object.');
  }

  return json;
}

async function responseErrorText(response) {
  const text = await response.text().catch(() => '');
  return responseErrorMessage(response, text);
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

async function* parseSse(stream) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('AI 流式响应不可用，请稍后重试。');
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await readSseChunk(reader);
    if (done) {
      buffer += decoder.decode();
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

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event.data) {
      yield event;
    }
  }
}

async function readSseChunk(reader) {
  try {
    return await reader.read();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    throw new Error('AI 流式响应中断，请稍后重试。', { cause: error });
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

function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((call, index) => {
      const fn = call.function || {};
      const name = fn.name || call.name;
      if (!name) {
        return null;
      }

      return {
        id: call.id || `tool-call-${index}`,
        name,
        arguments: parseJson(fn.arguments || call.arguments || '{}', {}),
        raw: {
          id: call.id || `tool-call-${index}`,
          type: call.type || 'function',
          function: {
            name,
            arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || call.arguments || {})
          }
        }
      };
    })
    .filter(Boolean);
}

function normalizeStreamingToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.map((call, index) => ({
    index: Number.isFinite(call?.index) ? call.index : index,
    id: call?.id || '',
    name: call?.function?.name || '',
    arguments: call?.function?.arguments || ''
  }));
}

function extractChatMessage(json = {}) {
  return json.choices?.[0]?.message ||
    json.output?.choices?.[0]?.message ||
    json.output?.message ||
    json.message ||
    {};
}

function extractStreamingDelta(json = {}) {
  return json.choices?.[0]?.delta ||
    json.choices?.[0]?.message ||
    json.output?.choices?.[0]?.delta ||
    json.output?.choices?.[0]?.message ||
    json.output?.delta ||
    json.delta ||
    {};
}

function extractReasoning(value = {}) {
  return mergeReasoning(
    extractText(
    value.reasoning_content ||
      value.reasoning ||
      value.reasoning_details ||
      value.reasoningDetails ||
      value.reasoning_delta ||
      value.thought ||
      value.thoughts ||
      value.thinking ||
      value.thinking_content ||
      value.thinking_delta ||
      value.delta?.reasoning ||
      value.delta?.thinking
    ),
    extractReasoningBlocks(value.content)
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
    return value
      .filter((item) => !isReasoningBlock(item))
      .map((item) => extractText(item?.text || item?.content || item))
      .join('');
  }

  if (typeof value === 'object') {
    return extractText(value.text || value.content);
  }

  return String(value);
}

function extractReasoningBlocks(value) {
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .filter(isReasoningBlock)
    .map((item) => extractText(item?.thinking || item?.text || item?.content || item))
    .filter(Boolean)
    .join('\n\n');
}

function isReasoningBlock(item) {
  return Boolean(item && typeof item === 'object' && (item.type === 'thinking' || item.type === 'reasoning' || item.thought === true));
}

function mergeReasoning(...items) {
  return items.map((item) => String(item || '').trim()).filter(Boolean).join('\n\n');
}

function splitThinkingTags(text) {
  const value = String(text || '');
  if (!value) {
    return { content: '', reasoning: '' };
  }
  const reasoning = [];
  let content = value.replace(/<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi, (_match, inner) => {
    if (String(inner || '').trim()) {
      reasoning.push(String(inner).trim());
    }
    return '';
  });
  content = content.replace(/<thinking\b[^>]*>[\s\S]*$/i, (match) => {
    const inner = match.replace(/^<thinking\b[^>]*>/i, '').trim();
    if (inner) {
      reasoning.push(inner);
    }
    return '';
  });
  content = content.replace(/<\/thinking>/gi, '');
  return {
    content: content.trimStart(),
    reasoning: reasoning.join('\n\n')
  };
}

function createThinkingTagFilter({ onContent, onReasoning }) {
  let buffer = '';
  let inThinking = false;
  const openTag = '<thinking>';
  const closeTag = '</thinking>';

  const drain = (flush = false) => {
    while (buffer) {
      const lower = buffer.toLowerCase();
      if (!inThinking) {
        const index = lower.indexOf(openTag);
        if (index >= 0) {
          emitStreamText(onContent, buffer.slice(0, index));
          buffer = buffer.slice(index + openTag.length);
          inThinking = true;
          continue;
        }
        const emitLength = flush ? buffer.length : safeTagEmitLength(buffer, openTag);
        if (emitLength <= 0) {
          break;
        }
        emitStreamText(onContent, buffer.slice(0, emitLength));
        buffer = buffer.slice(emitLength);
        break;
      }

      const index = lower.indexOf(closeTag);
      if (index >= 0) {
        emitStreamText(onReasoning, buffer.slice(0, index));
        buffer = buffer.slice(index + closeTag.length);
        inThinking = false;
        continue;
      }
      const emitLength = flush ? buffer.length : safeTagEmitLength(buffer, closeTag);
      if (emitLength <= 0) {
        break;
      }
      emitStreamText(onReasoning, buffer.slice(0, emitLength));
      buffer = buffer.slice(emitLength);
      break;
    }
  };

  return {
    push(text) {
      buffer += String(text || '');
      drain(false);
    },
    flush() {
      drain(true);
      buffer = '';
    }
  };
}

function emitStreamText(callback, text) {
  if (text) {
    callback(text);
  }
}

function safeTagEmitLength(value, tag) {
  const lower = String(value || '').toLowerCase();
  const target = String(tag || '').toLowerCase();
  const maxKeep = Math.min(target.length - 1, lower.length);
  for (let keep = maxKeep; keep > 0; keep -= 1) {
    if (target.startsWith(lower.slice(-keep))) {
      return lower.length - keep;
    }
  }
  return lower.length;
}

function extractOpenAiOutputText(json) {
  return (json.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || '')
    .join('');
}

function extractOpenAiReasoning(json) {
  const items = [];
  for (const item of json.output || []) {
    if (item?.type !== 'reasoning') {
      continue;
    }
    items.push(extractText(item.summary || ''));
    items.push(extractText(item.content || ''));
    items.push(extractText(item.text || item.reasoning || item.reasoning_content || ''));
  }
  items.push(extractText(json.reasoning || json.response?.reasoning || ''));
  return mergeReasoning(...items);
}

function extractResponsesReasoningDelta(type, json = {}) {
  const isReasoningEvent = /^response\.(reasoning|reasoning_summary|reasoning_summary_text|reasoning_text|reasoning_content)(\.|$)/.test(String(type || ''));
  if (isReasoningEvent) {
    return extractText(json.delta || json.text || json.reasoning || json.reasoning_content || json.summary || json.output_text || '');
  }
  return extractReasoning(json);
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
    return 'deepseek-v4-flash';
  }
  return value;
}

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}

function buildOpenAiReasoning(settings = {}, options = {}) {
  if (settings.extraBody?.reasoning && typeof settings.extraBody.reasoning === 'object') {
    return settings.extraBody.reasoning;
  }
  if (settings.providerType === 'xai') {
    return {
      effort: options.thinkingEnabled === false ? 'none' : 'high'
    };
  }
  return {
    effort: options.thinkingEnabled === false ? 'low' : 'medium',
    summary: 'auto'
  };
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
