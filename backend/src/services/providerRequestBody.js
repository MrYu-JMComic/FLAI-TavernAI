import { normalizeProviderRequestExtraBody } from './providerExtraBody.js';
import { normalizeProviderModel } from './providerModels.js';
import { assignFiniteProviderNumber } from './providerNumbers.js';

export function buildProviderBody(settings, messages, stream, options = {}) {
  options = options ?? {};
  const extraBody = normalizeProviderRequestExtraBody(settings.providerType, settings.extraBody);
  const body = {
    ...extraBody,
    model: resolveProviderModel(settings, options),
    messages,
    stream
  };

  // Apply preset / override parameters
  assignFiniteProviderNumber(body, 'temperature', options.temperature);
  assignFiniteProviderNumber(body, 'max_tokens', options.maxTokens);
  assignFiniteProviderNumber(body, 'top_p', options.topP);
  assignFiniteProviderNumber(body, 'frequency_penalty', options.frequencyPenalty);
  assignFiniteProviderNumber(body, 'presence_penalty', options.presencePenalty);

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

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}
