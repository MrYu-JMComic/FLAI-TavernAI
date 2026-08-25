export const THINKING_LEVELS = Object.freeze([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

export const DEFAULT_THINKING_LEVEL = 'high';

const THINKING_LEVEL_ALIASES = Object.freeze({
  none: 'off',
  disabled: 'off',
  disable: 'off',
  false: 'off',
  on: 'high',
  enabled: 'high',
  true: 'high',
  default: 'high',
  ultra: 'max',
  extreme: 'max'
});

const THINKING_LEVEL_RANK = Object.freeze({
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6
});

export function normalizeThinkingLevel(value, fallback = DEFAULT_THINKING_LEVEL) {
  const normalized = normalizeThinkingLevelValue(value);
  if (normalized) {
    return normalized;
  }
  const normalizedFallback = normalizeThinkingLevelValue(fallback);
  return normalizedFallback || DEFAULT_THINKING_LEVEL;
}

export function resolveSupportedThinkingLevel(value, control = {}, fallback = control.defaultLevel) {
  const levels = Array.isArray(control.levels) ? control.levels : [];
  if (!levels.length) {
    return '';
  }
  const requested = normalizeThinkingLevel(value, fallback || control.defaultLevel || DEFAULT_THINKING_LEVEL);
  if (levels.includes(requested)) {
    return requested;
  }

  // A provider may expose only a subset (for example DeepSeek low/high/max).
  // Pick the closest supported level instead of sending an invalid enum.
  const requestedRank = THINKING_LEVEL_RANK[requested] ?? THINKING_LEVEL_RANK.high;
  let closest = levels[0];
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    const levelRank = THINKING_LEVEL_RANK[level] ?? requestedRank;
    const closestRank = THINKING_LEVEL_RANK[closest] ?? requestedRank;
    const distance = Math.abs(levelRank - requestedRank);
    const preferHigherTie = distance === closestDistance && levelRank >= requestedRank && closestRank < requestedRank;
    if (distance < closestDistance || preferHigherTie) {
      closest = level;
      closestDistance = distance;
    }
  }
  return closest;
}

export function listThinkingPreferenceLevels(control = {}) {
  const levels = Array.isArray(control.levels) ? control.levels : [];
  if (!levels.length) {
    return [];
  }
  return levels.includes('off') ? [...levels] : ['off', ...levels];
}

export function resolveThinkingPreferenceLevel(value, control = {}, fallback = control.defaultLevel) {
  const levels = Array.isArray(control.levels) ? control.levels : [];
  if (!levels.length) {
    return '';
  }
  const requested = normalizeThinkingLevel(value, fallback || control.defaultLevel || DEFAULT_THINKING_LEVEL);
  if (requested === 'off') {
    return 'off';
  }
  return resolveSupportedThinkingLevel(requested, control, fallback);
}

export function supportsGeminiMinimalThinking(model) {
  const value = normalizeThinkingModel(model);
  // Google documents minimal for the Gemini 3 Flash family. Third-party
  // aliases such as gemini-3.7-flash-high are not official model ids and may
  // expose only low/medium/high, so keep minimal out of those requests.
  return /^(?:gemini-3-flash(?:-preview)?|gemini-3\.1-flash(?:-preview)?)$/.test(value);
}

export function resolveGeminiNativeThinkingLevel(level, model) {
  const normalized = normalizeThinkingLevel(level, 'low');
  if (normalized === 'minimal' && !supportsGeminiMinimalThinking(model)) {
    return 'low';
  }
  if (normalized === 'xhigh' || normalized === 'max') {
    return 'high';
  }
  return normalized;
}

export function resolveThinkingControl(providerType, model, supportsReasoning = true) {
  const type = normalizeProviderThinkingType(providerType);
  const modelId = normalizeThinkingModel(model);
  if (!supportsReasoning) {
    return createThinkingControl({
      providerType: type,
      model: modelId,
      supported: false,
      levels: [],
      defaultLevel: ''
    });
  }

  switch (type) {
    case 'deepseek':
      return createThinkingControl({
        providerType: type,
        model: modelId,
        levels: ['off', 'low', 'high', 'max'],
        defaultLevel: 'high',
        strategy: 'deepseek'
      });
    case 'gemini':
      return resolveGeminiThinkingControl(modelId);
    case 'anthropic':
      return createThinkingControl({
        providerType: type,
        model: modelId,
        levels: usesAnthropicAdaptiveThinking(modelId)
          ? ['off', 'low', 'medium', 'high', 'max']
          : ['off', 'low', 'medium', 'high'],
        defaultLevel: 'high',
        strategy: usesAnthropicAdaptiveThinking(modelId) ? 'anthropic-adaptive' : 'anthropic-budget'
      });
    case 'xai':
      return createThinkingControl({
        providerType: type,
        model: modelId,
        // xAI reasoning models always reason; low is the minimum effort.
        levels: isXaiExtendedEffortModel(modelId)
          ? ['low', 'medium', 'high', 'xhigh']
          : ['low', 'medium', 'high'],
        defaultLevel: 'high',
        strategy: 'reasoning-effort'
      });
    case 'mistral':
      return createThinkingControl({
        providerType: type,
        model: modelId,
        levels: ['off', 'high'],
        defaultLevel: 'high',
        strategy: 'reasoning-effort'
      });
    case 'qwen':
      return createThinkingControl({
        providerType: type,
        model: modelId,
        levels: ['off', 'low', 'medium', 'high', 'max'],
        defaultLevel: 'high',
        strategy: 'qwen-budget'
      });
    case 'glm':
      return resolveGlmThinkingControl(modelId);
    case 'kimi':
      return resolveKimiThinkingControl(modelId);
    case 'openai':
      return resolveOpenAiThinkingControl(modelId);
    case 'custom':
    default:
      return resolveCustomThinkingControl(modelId);
  }
}

export function inferProviderThinkingType(model) {
  const value = normalizeThinkingModel(model);
  if (!value) return '';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('claude')) return 'anthropic';
  if (value.includes('grok')) return 'xai';
  if (value.includes('mistral') || value.includes('magistral') || value.includes('ministral')) return 'mistral';
  if (value.includes('qwen')) return 'qwen';
  if (/(?:^|[/_-])glm(?:[/_.-]|$)/.test(value)) return 'glm';
  if (value.includes('kimi') || value.includes('moonshot')) return 'kimi';
  if (value.startsWith('gpt-') || /(?:^|[/_-])(?:o1|o3|o4)(?:[/_.-]|$)/.test(value)) return 'openai';
  return '';
}

function resolveCustomThinkingControl(model) {
  const inferredProviderType = inferProviderThinkingType(model);
  if (inferredProviderType) {
    const inferredControl = resolveThinkingControl(inferredProviderType, model, true);
    return {
      ...inferredControl,
      providerType: 'custom',
      inferredProviderType
    };
  }
  return createThinkingControl({
    providerType: 'custom',
    model,
    levels: ['off', 'low', 'medium', 'high', 'max'],
    defaultLevel: 'high',
    strategy: 'reasoning-effort'
  });
}

export function normalizeProviderThinkingType(providerType) {
  const value = String(providerType || '').trim().toLowerCase();
  return [
    'openai',
    'deepseek',
    'gemini',
    'anthropic',
    'xai',
    'mistral',
    'qwen',
    'glm',
    'kimi',
    'custom'
  ].includes(value) ? value : 'custom';
}

function normalizeThinkingLevelValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'high' : 'off';
  }
  const valueString = String(value ?? '').trim().toLowerCase();
  if (!valueString) {
    return '';
  }
  const normalized = THINKING_LEVEL_ALIASES[valueString] || valueString;
  return THINKING_LEVELS.includes(normalized) ? normalized : '';
}

function normalizeThinkingModel(model) {
  return String(model || '').trim().toLowerCase();
}

function createThinkingControl({
  providerType,
  model,
  supported = true,
  levels = [],
  defaultLevel = DEFAULT_THINKING_LEVEL,
  strategy = 'reasoning-effort'
}) {
  const normalizedLevels = [...new Set(levels.filter((level) => THINKING_LEVELS.includes(level)))];
  const normalizedDefault = normalizedLevels.includes(defaultLevel)
    ? defaultLevel
    : normalizedLevels[normalizedLevels.length - 1] || '';
  return {
    supported: Boolean(supported && normalizedLevels.length),
    providerType,
    model,
    levels: normalizedLevels,
    defaultLevel: normalizedDefault,
    canDisable: normalizedLevels.includes('off'),
    strategy
  };
}

function resolveGeminiThinkingControl(model) {
  if (/gemini-(?:1\.5|2\.0|2\.0-flash|1\.0)/.test(model)) {
    return createThinkingControl({
      providerType: 'gemini',
      model,
      supported: false,
      levels: [],
      defaultLevel: '',
      strategy: 'unsupported'
    });
  }
  if (/gemini-3\.1[^/]*pro/.test(model) || /gemini-3[^/]*pro/.test(model)) {
    return createThinkingControl({
      providerType: 'gemini',
      model,
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'high',
      strategy: 'gemini-level'
    });
  }
  if (/gemini-3/.test(model)) {
    return createThinkingControl({
      providerType: 'gemini',
      model,
      levels: supportsGeminiMinimalThinking(model)
        ? ['minimal', 'low', 'medium', 'high']
        : ['low', 'medium', 'high'],
      defaultLevel: 'high',
      strategy: 'gemini-level'
    });
  }
  if (/gemini-2\.5[^/]*pro/.test(model)) {
    return createThinkingControl({
      providerType: 'gemini',
      model,
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'high',
      strategy: 'gemini-budget'
    });
  }
  return createThinkingControl({
    providerType: 'gemini',
    model,
    levels: ['off', 'low', 'medium', 'high'],
    defaultLevel: 'high',
    strategy: 'gemini-budget'
  });
}

function resolveOpenAiThinkingControl(model) {
  if (/\b(?:o1|o3|o4)(?:-|$)/.test(model)) {
    return createThinkingControl({
      providerType: 'openai',
      model,
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
      strategy: 'reasoning-effort'
    });
  }
  if (/gpt-5/.test(model)) {
    return createThinkingControl({
      providerType: 'openai',
      model,
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultLevel: 'medium',
      strategy: 'reasoning-effort'
    });
  }
  return createThinkingControl({
    providerType: 'openai',
    model,
    levels: ['off', 'low', 'medium', 'high'],
    defaultLevel: 'medium',
    strategy: 'reasoning-effort'
  });
}

function resolveGlmThinkingControl(model) {
  if (/glm-5\.3/.test(model)) {
    return createThinkingControl({
      providerType: 'glm',
      model,
      levels: ['low', 'high', 'max'],
      defaultLevel: 'high',
      strategy: 'glm-effort'
    });
  }
  if (/glm-5\.2/.test(model)) {
    return createThinkingControl({
      providerType: 'glm',
      model,
      levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      defaultLevel: 'high',
      strategy: 'glm-effort'
    });
  }
  return createThinkingControl({
    providerType: 'glm',
    model,
    levels: ['off', 'high'],
    defaultLevel: 'high',
    strategy: 'glm-switch'
  });
}

function resolveKimiThinkingControl(model) {
  if (/kimi[-_]?k3/.test(model)) {
    return createThinkingControl({
      providerType: 'kimi',
      model,
      levels: ['low', 'high', 'max'],
      defaultLevel: 'max',
      strategy: 'reasoning-effort'
    });
  }
  if (/kimi[-_]?k2\.7.*code/.test(model)) {
    return createThinkingControl({
      providerType: 'kimi',
      model,
      levels: ['high'],
      defaultLevel: 'high',
      strategy: 'always-on'
    });
  }
  return createThinkingControl({
    providerType: 'kimi',
    model,
    levels: ['off', 'high'],
    defaultLevel: 'high',
    strategy: 'kimi-switch'
  });
}

function usesAnthropicAdaptiveThinking(model) {
  return model.includes('claude-opus-4-7') ||
    model.includes('claude-opus-4-8') ||
    model.includes('claude-sonnet-4-6') ||
    model.includes('claude-opus-4-6') ||
    model.includes('claude-mythos');
}

function isXaiExtendedEffortModel(model) {
  return /grok-4\.(?:5|6)/.test(model) || /grok-4-6/.test(model);
}
