import { resolveThinkingControl } from './providerThinking.js';

const providerCapabilityDefaults = {
  streaming: true,
  reasoning: false,
  tools: true,
  vision: false,
  imageGeneration: false,
  embedding: false,
  usage: true
};

const providerCapabilityPresets = {
  openai: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: true,
    usage: true
  },
  deepseek: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: false,
    imageGeneration: false,
    usage: true
  },
  gemini: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: true,
    usage: true
  },
  anthropic: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: false,
    usage: true
  },
  xai: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: true,
    usage: true
  },
  mistral: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: false,
    usage: true
  },
  qwen: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: false,
    usage: true
  },
  glm: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: true,
    imageGeneration: false,
    usage: true
  },
  kimi: {
    streaming: true,
    reasoning: true,
    tools: true,
    vision: false,
    imageGeneration: false,
    usage: true
  },
  custom: {
    streaming: true,
    reasoning: false,
    tools: true,
    vision: true,
    imageGeneration: true,
    usage: false
  }
};

const imageGenerationModelsByProvider = {
  openai: new Set(['gpt-image-1.5', 'gpt-image-2']),
  xai: new Set(['grok-imagine-image', 'grok-imagine-image-quality', 'grok-imagine-image-2.0']),
  gemini: new Set([
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-2.5-flash-image'
  ])
};

export function buildProviderCapabilitySummary(providerType, settings = {}) {
  const type = normalizeProviderCapabilityType(providerType);
  const providerCapabilities = resolveProviderCapabilities(type, settings);
  return {
    providerType: type,
    capabilities: providerCapabilities,
    modelCapabilities: resolveProviderModelCapabilities({
      ...settings,
      providerType: type
    }, providerCapabilities)
  };
}

export function resolveProviderModelCapabilities(settings = {}, providerCapabilities = null) {
  const providerType = normalizeProviderCapabilityType(settings.providerType);
  const capabilities = providerCapabilities || resolveProviderCapabilities(providerType, settings);
  const model = normalizeProviderModelId(providerType, settings.model);
  const thinking = resolveThinkingControl(providerType, model, capabilities.reasoning);
  // Keep the model-specific flag for transport gates. Image generation itself
  // is exposed separately as a provider-level capability so a normal chat
  // model can invoke a dedicated image model.
  const imageGenerationModel = Boolean(capabilities.imageGeneration && isKnownImageGenerationModel(providerType, model));
  const imageGeneration = imageGenerationModel;
  const task = inferProviderModelTask(model, settings.task);
  const embeddingModel = task === 'embedding';
  const modelVision = providerType === 'deepseek'
    ? isDeepSeekVisionModel(model)
    : capabilities.vision;
  return {
    ...capabilities,
    task,
    embedding: embeddingModel,
    embeddingProtocol: embeddingModel && providerType === 'qwen' ? 'dashscope-text-embedding-v1' : '',
    streaming: Boolean(capabilities.streaming && !imageGenerationModel && !embeddingModel),
    vision: Boolean(modelVision && !imageGenerationModel && !embeddingModel),
    reasoning: Boolean(capabilities.reasoning && !embeddingModel),
    imageGeneration,
    imageGenerationModel,
    imageGenerationAvailable: Boolean(capabilities.imageGeneration),
    tools: Boolean(capabilities.tools && !imageGenerationModel && !embeddingModel),
    model,
    thinking,
    thinkingLevels: thinking.levels
  };
}

/** Prefer explicit catalogue task metadata; known vector models never enter chat fallbacks. */
export function inferProviderModelTask(model, explicitTask = '') {
  if (explicitTask === 'embedding' || explicitTask === 'chat') return explicitTask;
  return /(?:^|[-_.])(?:embedding|embed)(?:[-_.]|$)/i.test(String(model || '')) ? 'embedding' : 'chat';
}

export function isKnownImageGenerationModel(providerType, model) {
  const type = normalizeProviderCapabilityType(providerType);
  const normalizedModel = normalizeProviderModelId(type, model);
  if (!normalizedModel) {
    return false;
  }
  const providerModels = imageGenerationModelsByProvider[type];
  if (providerModels?.has(normalizedModel)) {
    return true;
  }
  return type === 'custom' && isKnownImageGenerationModelForAnyProvider(normalizedModel);
}

function isDeepSeekVisionModel(model) {
  const value = String(model || '').trim().toLowerCase();
  // Legacy Flash identifiers are normalized before this model-specific check.
  return value.startsWith('deepseek-flash');
}

export function normalizeProviderCapabilityType(providerType) {
  const type = String(providerType || '').trim().toLowerCase();
  return providerCapabilityPresets[type] ? type : 'custom';
}

function resolveProviderCapabilities(providerType, settings = {}) {
  const type = normalizeProviderCapabilityType(providerType);
  const preset = providerCapabilityPresets[type] || providerCapabilityPresets.custom;
  return {
    ...providerCapabilityDefaults,
    ...preset,
    reasoning: Boolean(settings.supportsReasoning ?? preset.reasoning)
  };
}

function isKnownImageGenerationModelForAnyProvider(model) {
  for (const providerModels of Object.values(imageGenerationModelsByProvider)) {
    if (providerModels.has(model)) {
      return true;
    }
  }
  return false;
}

function normalizeProviderModelId(providerType, model) {
  const value = String(model || '').trim();
  if (providerType === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'].includes(value.toLowerCase())) {
    return 'deepseek-flash';
  }
  return value;
}
