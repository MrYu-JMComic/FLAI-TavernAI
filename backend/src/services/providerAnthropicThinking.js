import {
  normalizeThinkingLevel,
  resolveSupportedThinkingLevel,
  resolveThinkingControl
} from '../../../shared/providerThinking.js';

export function applyAnthropicThinkingSwitch(body, settings = {}, options = {}) {
  if (!settings.supportsReasoning) {
    return;
  }
  if (hasExplicitThinkingLevel(options)) {
    applyAnthropicThinkingLevel(body, options);
    return;
  }
  if (options.thinkingEnabled === false) {
    applyAnthropicThinkingLevel(body, { thinkingLevel: 'off' });
    return;
  }

  if (resolveThinkingControl('anthropic', body.model, true).strategy === 'anthropic-adaptive') {
    if (body.thinking?.type === 'disabled') {
      applyAnthropicThinkingLevel(body, { thinkingLevel: 'off' });
      return;
    }
    const existingThinking = body.thinking && typeof body.thinking === 'object' ? body.thinking : {};
    body.thinking = {
      ...existingThinking,
      type: 'adaptive',
      display: existingThinking.display || 'summarized'
    };
    delete body.thinking.budget_tokens;
    body.output_config = {
      ...(body.output_config || {}),
      effort: body.output_config?.effort || 'high'
    };
    return;
  }

  if (body.thinking && typeof body.thinking === 'object') {
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

function applyAnthropicThinkingLevel(body, options = {}) {
  const control = resolveThinkingControl('anthropic', body.model, true);
  const fallback = options.thinkingEnabled === false ? 'off' : control.defaultLevel;
  const level = resolveSupportedThinkingLevel(
    normalizeThinkingLevel(options.thinkingLevel, fallback),
    control,
    fallback
  );
  if (level === 'off') {
    delete body.thinking;
    if (body.output_config && typeof body.output_config === 'object') {
      const outputConfig = { ...body.output_config };
      delete outputConfig.effort;
      if (Object.keys(outputConfig).length) {
        body.output_config = outputConfig;
      } else {
        delete body.output_config;
      }
    }
    return;
  }

  if (control.strategy === 'anthropic-adaptive') {
    const existingThinking = body.thinking && typeof body.thinking === 'object' ? body.thinking : {};
    body.thinking = {
      ...existingThinking,
      type: 'adaptive',
      display: existingThinking.display || 'summarized'
    };
    delete body.thinking.budget_tokens;
    body.output_config = {
      ...(body.output_config && typeof body.output_config === 'object' ? body.output_config : {}),
      effort: mapAnthropicAdaptiveEffort(level)
    };
    return;
  }

  const budgetTokens = resolveAnthropicThinkingBudget(level);
  const existingThinking = body.thinking && typeof body.thinking === 'object' ? body.thinking : {};
  body.thinking = {
    ...existingThinking,
    type: 'enabled',
    budget_tokens: budgetTokens,
    display: existingThinking.display || 'summarized'
  };
  if (Number(body.max_tokens) <= budgetTokens) {
    body.max_tokens = budgetTokens + 1024;
  }
}

function hasExplicitThinkingLevel(options = {}) {
  return options.thinkingLevel !== undefined && options.thinkingLevel !== null && String(options.thinkingLevel).trim() !== '';
}

function mapAnthropicAdaptiveEffort(level) {
  if (level === 'max' || level === 'xhigh') return 'max';
  if (level === 'minimal') return 'low';
  return level;
}

function resolveAnthropicThinkingBudget(level) {
  switch (level) {
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 4096;
    case 'max':
    case 'xhigh':
      return 16384;
    case 'high':
    default:
      return 8192;
  }
}

