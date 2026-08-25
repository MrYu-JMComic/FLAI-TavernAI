import { normalizeProviderRequestExtraBody } from './providerExtraBody.js';
import { normalizeProviderModel } from './providerModels.js';
import { assignFiniteProviderNumber } from './providerNumbers.js';
import { optimizeTools } from './toolSchemaOptimizer.js';
import { adaptToolsForProvider } from './toolProviderAdapter.js';
import {
  inferProviderThinkingType,
  normalizeThinkingLevel,
  resolveGeminiNativeThinkingLevel,
  resolveSupportedThinkingLevel,
  resolveThinkingControl
} from '../../../shared/providerThinking.js';

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
    // 1. 优化工具定义以确保跨模型兼容性
    let tools = optimizeTools(options.tools);
    // 2. 为特定提供商适配工具定义（传入 model 名以便对 custom provider 做 gemini 检测）
    tools = adaptToolsForProvider(tools, settings.providerType, settings.model);
    body.tools = tools;
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
  if (isProviderThinkingFamily(settings, body.model, 'kimi') && isKimiThinkingModel(body.model)) {
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
    applyReasoningEffortSwitch(body, options, settings);
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

  // Custom/OpenAI-compatible gateways: honour the thinking toggle via the
  // standard reasoning_effort field so the switch is not a no-op. Only applies
  // when the user has explicitly opted in with supportsReasoning, and never
  // overrides an effort already provided through extraBody.
  if (settings.providerType === 'custom') {
    applyCustomThinkingControl(body, options, settings);
  }
}

function applyCustomThinkingControl(body, options = {}, settings = {}) {
  const inferredProviderType = inferProviderThinkingType(body.model);
  if (inferredProviderType === 'gemini') {
    applyGeminiReasoningEffort(body, options);
    return;
  }
  if (!hasExplicitThinkingLevel(options)) {
    applyReasoningEffortSwitch(body, options, settings);
    return;
  }
  switch (inferredProviderType) {
    case 'deepseek':
      applyDeepSeekThinkingSwitch(body, options);
      return;
    case 'qwen':
      applyQwenThinkingSwitch(body, options);
      return;
    case 'glm':
      applyGlmThinkingSwitch(body, options);
      return;
    case 'kimi':
      applyKimiThinkingSwitch(body, options);
      return;
    case 'xai':
    case 'mistral':
      applyReasoningEffortSwitch(body, options, { ...settings, providerType: inferredProviderType });
      return;
    default:
      applyReasoningEffortSwitch(body, options, settings);
  }
}

function applyDeepSeekThinkingSwitch(body, options = {}) {
  if (hasExplicitThinkingLevel(options)) {
    const level = selectThinkingLevel('deepseek', body.model, options);
    const thinkingEnabled = level !== 'off';
    body.thinking = {
      type: thinkingEnabled ? 'enabled' : 'disabled'
    };
    if (!thinkingEnabled) {
      delete body.reasoning_effort;
      return;
    }
    body.reasoning_effort = mapDeepSeekEffort(level);
    return;
  }

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
  return isProviderThinkingFamily(settings, body.model, 'deepseek') &&
    settings.supportsReasoning && body.thinking?.type === 'enabled';
}

function isProviderThinkingFamily(settings = {}, model, providerType) {
  return settings.providerType === providerType ||
    (settings.providerType === 'custom' && inferProviderThinkingType(model) === providerType);
}

function applyReasoningEffortSwitch(body, options = {}, settings = {}) {
  if (hasExplicitThinkingLevel(options)) {
    const level = selectThinkingLevel(settings.providerType, body.model, options);
    body.reasoning_effort = mapReasoningEffort(level, settings.providerType);
    return;
  }
  if (body.reasoning_effort !== undefined) {
    return;
  }
  body.reasoning_effort = options.thinkingEnabled === false ? 'none' : 'high';
}

function applyQwenThinkingSwitch(body, options = {}) {
  if (hasExplicitThinkingLevel(options)) {
    const level = selectThinkingLevel('qwen', body.model, options);
    body.enable_thinking = level !== 'off';
    if (level === 'off') {
      delete body.thinking_budget;
      delete body.thinkingBudget;
      return;
    }
    body.thinking_budget = resolveQwenThinkingBudget(level);
    delete body.thinkingBudget;
    return;
  }
  body.enable_thinking = options.thinkingEnabled !== false;
}

function applyGlmThinkingSwitch(body, options = {}) {
  if (hasExplicitThinkingLevel(options)) {
    const control = resolveThinkingControl('glm', body.model, true);
    const level = resolveSupportedThinkingLevel(options.thinkingLevel, control, control.defaultLevel);
    const effortMode = control.strategy === 'glm-effort';
    const minimalDisablesThinking = effortMode && level === 'minimal' &&
      !String(body.model || '').toLowerCase().includes('glm-5.3');
    const thinkingDisabled = level === 'off' || minimalDisablesThinking;
    body.thinking = {
      ...(body.thinking && typeof body.thinking === 'object' ? body.thinking : {}),
      type: thinkingDisabled ? 'disabled' : 'enabled'
    };
    if (effortMode) {
      body.reasoning_effort = thinkingDisabled ? 'none' : mapGlmEffort(level, body.model);
    } else {
      delete body.reasoning_effort;
    }
    return;
  }
  body.thinking = {
    ...(body.thinking && typeof body.thinking === 'object' ? body.thinking : {}),
    type: options.thinkingEnabled === false ? 'disabled' : 'enabled'
  };
}

function applyKimiThinkingSwitch(body, options = {}) {
  if (hasExplicitThinkingLevel(options)) {
    const control = resolveThinkingControl('kimi', body.model, true);
    const level = resolveSupportedThinkingLevel(options.thinkingLevel, control, control.defaultLevel);
    if (control.strategy === 'reasoning-effort') {
      body.reasoning_effort = mapKimiEffort(level);
      delete body.thinking;
      return;
    }
    if (control.strategy === 'always-on') {
      delete body.thinking;
      delete body.reasoning_effort;
      return;
    }
    body.thinking = { type: level === 'off' ? 'disabled' : 'enabled' };
    return;
  }
  if (options.thinkingEnabled === false) {
    body.thinking = { type: 'disabled' };
    return;
  }
  delete body.thinking;
}

function applyGeminiReasoningEffort(body, options = {}) {
  sanitizeGeminiThinkingConfig(body);
  const explicitLevel = hasExplicitThinkingLevel(options);
  const hasNativeThinkingConfig = hasGeminiExplicitThinkingBudget(body);
  const wantsThinkingOff = explicitLevel && normalizeThinkingLevel(options.thinkingLevel, 'high') === 'off';

  if (!explicitLevel && options.thinkingEnabled === false && hasNativeThinkingConfig) {
    const disabledLevel = selectThinkingLevel('gemini', body.model, { thinkingLevel: 'off' });
    const thinkingConfig = buildGeminiThinkingConfig(disabledLevel, body.model);
    if (thinkingConfig) {
      delete body.reasoning_effort;
      replaceGeminiThinkingConfig(body, thinkingConfig);
      return;
    }
  }
  if (!explicitLevel && (body.reasoning_effort !== undefined || hasNativeThinkingConfig)) {
    return;
  }
  if (explicitLevel && hasNativeThinkingConfig && !wantsThinkingOff) {
    return;
  }
  if (explicitLevel) {
    const level = selectThinkingLevel('gemini', body.model, options);
    if (!level) {
      return;
    }
    const thinkingConfig = buildGeminiThinkingConfig(level, body.model);
    if (thinkingConfig) {
      delete body.reasoning_effort;
      replaceGeminiThinkingConfig(body, thinkingConfig);
    } else {
      body.reasoning_effort = mapGeminiEffort(level, body.model);
    }
    return;
  }
  body.reasoning_effort = options.thinkingEnabled === false
    ? resolveGeminiLowLatencyEffort(body.model)
    : 'high';
}

function hasGeminiExplicitThinkingBudget(body = {}) {
  const thinkingConfig = getGeminiThinkingConfig(body);
  if (!thinkingConfig || typeof thinkingConfig !== 'object') {
    return false;
  }
  return ['thinking_level', 'thinkingLevel', 'thinking_budget', 'thinkingBudget']
    .some((key) => Object.prototype.hasOwnProperty.call(thinkingConfig, key));
}

function getGeminiThinkingConfig(body = {}) {
  return body.extra_body?.google?.thinking_config ||
    body.extra_body?.extra_body?.google?.thinking_config ||
    null;
}

function sanitizeGeminiThinkingConfig(body = {}) {
  const thinkingConfig = getGeminiThinkingConfig(body);
  if (!thinkingConfig || typeof thinkingConfig !== 'object') {
    return;
  }
  const configuredLevel = thinkingConfig.thinking_level ?? thinkingConfig.thinkingLevel;
  if (configuredLevel === undefined || configuredLevel === null) {
    return;
  }
  const nativeLevel = resolveGeminiNativeThinkingLevel(configuredLevel, body.model);
  const isBudgetModel = String(body.model || '').toLowerCase().includes('gemini-2.5');
  const config = isBudgetModel
    ? { thinking_budget: resolveGeminiThinkingBudget(nativeLevel) }
    : { thinking_level: nativeLevel };
  replaceGeminiThinkingConfig(body, config);
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
  return value.includes('kimi-k2.5') || value.includes('kimi-k2-thinking') || value.includes('kimi-k2.6') ||
    value.includes('kimi-k2.7') || value.includes('kimi-k3');
}

function hasExplicitThinkingLevel(options = {}) {
  return options.thinkingLevel !== undefined && options.thinkingLevel !== null && String(options.thinkingLevel).trim() !== '';
}

function selectThinkingLevel(providerType, model, options = {}) {
  const control = resolveThinkingControl(providerType, model, true);
  const fallback = options.thinkingEnabled === false ? 'off' : control.defaultLevel;
  return resolveSupportedThinkingLevel(
    normalizeThinkingLevel(options.thinkingLevel, fallback),
    control,
    fallback
  );
}

function mapDeepSeekEffort(level) {
  switch (level) {
    case 'low':
      return 'low';
    case 'max':
      return 'max';
    case 'minimal':
    case 'medium':
    case 'xhigh':
    case 'high':
    default:
      return 'high';
  }
}

function mapReasoningEffort(level, providerType) {
  if (providerType === 'xai') {
    if (level === 'max') return 'xhigh';
    if (level === 'off' || level === 'minimal') return 'low';
    return level;
  }
  if (providerType === 'mistral') {
    return level === 'off' || level === 'minimal' ? 'none' : 'high';
  }
  if (level === 'off') return 'none';
  return level === 'xhigh' ? 'xhigh' : level;
}

function mapGeminiEffort(level, model) {
  const value = String(model || '').toLowerCase();
  if (level === 'off') {
    return value.includes('2.5') && value.includes('flash') && !value.includes('pro') ? 'none' : 'low';
  }
  if (level === 'xhigh' || level === 'max') {
    return 'high';
  }
  return level;
}

function buildGeminiThinkingConfig(level, model) {
  const value = String(model || '').toLowerCase();
  const nativeLevel = resolveGeminiNativeThinkingLevel(level, model);
  if (value.includes('gemini-3')) {
    return {
      thinking_level: nativeLevel
    };
  }
  if (value.includes('gemini-2.5')) {
    return {
      thinking_budget: resolveGeminiThinkingBudget(nativeLevel)
    };
  }
  return null;
}

function resolveGeminiThinkingBudget(level) {
  switch (level) {
    case 'off':
      return 0;
    case 'minimal':
    case 'low':
      return 1024;
    case 'medium':
      return 8192;
    case 'max':
      return -1;
    case 'high':
    default:
      return 24576;
  }
}

function setGeminiThinkingConfig(body, config) {
  const existingExtraBody = body.extra_body && typeof body.extra_body === 'object'
    ? body.extra_body
    : {};
  const nestedExtraBody = existingExtraBody.extra_body && typeof existingExtraBody.extra_body === 'object'
    ? existingExtraBody.extra_body
    : null;
  if (nestedExtraBody) {
    const google = nestedExtraBody.google && typeof nestedExtraBody.google === 'object'
      ? nestedExtraBody.google
      : {};
    const thinkingConfig = google.thinking_config && typeof google.thinking_config === 'object'
      ? google.thinking_config
      : {};
    body.extra_body = {
      ...existingExtraBody,
      extra_body: {
        ...nestedExtraBody,
        google: {
          ...google,
          thinking_config: { ...thinkingConfig, ...config }
        }
      }
    };
    return;
  }
  const google = existingExtraBody.google && typeof existingExtraBody.google === 'object'
    ? existingExtraBody.google
    : {};
  const thinkingConfig = google.thinking_config && typeof google.thinking_config === 'object'
    ? google.thinking_config
    : {};
  body.extra_body = {
    ...existingExtraBody,
    google: {
      ...google,
      thinking_config: { ...thinkingConfig, ...config }
    }
  };
}

function replaceGeminiThinkingConfig(body, config) {
  const thinkingConfig = getGeminiThinkingConfig(body);
  if (thinkingConfig && typeof thinkingConfig === 'object') {
    delete thinkingConfig.thinking_level;
    delete thinkingConfig.thinkingLevel;
    delete thinkingConfig.thinking_budget;
    delete thinkingConfig.thinkingBudget;
  }
  setGeminiThinkingConfig(body, config);
}

function resolveQwenThinkingBudget(level) {
  switch (level) {
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 4096;
    case 'max':
      return 16384;
    case 'high':
    default:
      return 8192;
  }
}

function mapGlmEffort(level, model) {
  if (String(model || '').toLowerCase().includes('glm-5.3')) {
    if (level === 'low') return 'low';
    if (level === 'max' || level === 'xhigh') return 'max';
    return 'high';
  }
  if (level === 'minimal') return 'none';
  if (level === 'low' || level === 'medium') return 'high';
  if (level === 'xhigh' || level === 'max') return 'max';
  return 'high';
}

function mapKimiEffort(level) {
  if (level === 'low') return 'low';
  if (level === 'max' || level === 'xhigh') return 'max';
  return 'high';
}

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}
