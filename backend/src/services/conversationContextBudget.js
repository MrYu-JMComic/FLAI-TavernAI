import { parseJson } from '../utils/json.js';
import { normalizeThinkingLevel, resolveThinkingPreferenceLevel } from '../../../shared/providerThinking.js';
import { resolveProviderModelCapabilities } from '../../../shared/providerCapabilities.js';
import { buildAnthropicBody } from './providerAnthropic.js';
import { normalizeProviderNumber } from './providerNumbers.js';
import { resolvePromptTokenBudget } from './promptTokenBudget.js';
import { assertConversationIdle } from './conversationTimeline.js';

const BUDGET_FIELDS = ['inputTokenLimit', 'reservedOutputTokens', 'imageTokensPerImage', 'contextWindowTokens'];

export function readConversationContextBudget(database, userId, conversationId) {
  const row = database.prepare('SELECT context_budget_json FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  return row ? parseJson(row.context_budget_json, {}) : null;
}

export function updateConversationContextBudget(database, userId, conversationId, payload, settings = {}) {
  const current = readConversationContextBudget(database, userId, conversationId);
  if (!current) return null;
  assertConversationIdle(database, userId, conversationId, { allowActiveJob: true });
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some((key) => !BUDGET_FIELDS.includes(key))) {
    throw budgetError('Invalid context budget fields');
  }
  const next = { ...current };
  for (const key of BUDGET_FIELDS) {
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (value === null) { delete next[key]; continue; }
    if (!Number.isInteger(value) || value <= 0 || value > 10_000_000) {
      throw budgetError(`${key} must be a positive integer no greater than 10000000`);
    }
    next[key] = value;
  }
  if (Object.hasOwn(payload, 'contextWindowTokens')) {
    if (next.contextWindowTokens) {
      if (!settings.model || !settings.providerType) throw budgetError('Configure a provider and model before setting its context window');
      next.forModel = settings.model;
      next.forProviderType = settings.providerType;
    } else {
      delete next.forModel;
      delete next.forProviderType;
    }
  }
  database.prepare('UPDATE conversations SET context_budget_json = ? WHERE id = ? AND user_id = ?')
    .run(JSON.stringify(next), conversationId, userId);
  return next;
}

export function buildConversationCompletionOptions(settings = {}, contextBudget = {}, body = {}, activePreset = null) {
  const hasThinkingLevel = body.thinkingLevel !== undefined && body.thinkingLevel !== null;
  const thinkingLevel = hasThinkingLevel
    ? normalizeThinkingLevel(body.thinkingLevel, body.thinkingEnabled === false ? 'off' : 'high') : '';
  const options = { thinkingEnabled: thinkingLevel ? thinkingLevel !== 'off' : body.thinkingEnabled !== false };
  if (thinkingLevel) options.thinkingLevel = thinkingLevel;
  if (activePreset) {
    for (const key of ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty']) options[key] = activePreset[key];
    options.maxTokens = activePreset.maxTokens;
  }
  const extra = settings.extraBody || {};
  const configuredOutput = options.maxTokens
    ?? extra.max_output_tokens
    ?? extra.max_completion_tokens
    ?? extra.max_tokens
    ?? extra.maxOutputTokens
    ?? extra.maxCompletionTokens
    ?? extra.maxTokens;
  const output = normalizeProviderNumber(configuredOutput);
  // No explicit output cap is the same as the 0 sentinel: keep a finite
  // reservation only for input packing and context-window calculations.
  const unlimitedOutput = output === null || output === 0;
  options.maxTokens = resolvePromptTokenBudget(settings, {
    ...contextBudget, ...(output > 0 ? { maxTokens: Math.floor(output) } : {})
  }).reservedOutputTokens;
  if (unlimitedOutput) {
    // Keep the finite reservation for input packing and context-window math;
    // provider adapters use this flag to omit their output-limit field.
    options.unlimitedOutput = true;
  }
  // Use the existing adapter's normalization, including its reasoning-token minimum.
  if (settings.providerType === 'anthropic' && options.maxTokens > 0 && !options.unlimitedOutput) {
    options.maxTokens = buildAnthropicBody(settings, [], false, options).max_tokens;
  }
  return options;
}

export function resolveConversationThinkingLevel(settings = {}, options = {}) {
  const control = resolveProviderModelCapabilities(settings).thinking || {};
  if (!control.supported || !Array.isArray(control.levels) || !control.levels.length) {
    return 'off';
  }
  const hasExplicitLevel = options.thinkingLevel !== undefined
    && options.thinkingLevel !== null
    && String(options.thinkingLevel).trim() !== '';
  if (hasExplicitLevel) {
    const requested = normalizeThinkingLevel(
      options.thinkingLevel,
      options.thinkingEnabled === false ? 'off' : control.defaultLevel
    );
    return resolveThinkingPreferenceLevel(requested, control, control.defaultLevel) || control.defaultLevel;
  }
  if (options.thinkingEnabled === false) {
    return 'off';
  }
  return control.defaultLevel || 'off';
}

export function describeConversationContextBudget(config, settings = {}, activePreset = null) {
  const options = buildConversationCompletionOptions(settings, config, {}, activePreset);
  return {
    config,
    resolved: resolvePromptTokenBudget(settings, { ...config, reservedOutputTokens: options.maxTokens }),
    provider: { providerType: settings.providerType || '', model: settings.model || '' }
  };
}

function budgetError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'CONTEXT_BUDGET_INVALID', publicMessage: message });
}
