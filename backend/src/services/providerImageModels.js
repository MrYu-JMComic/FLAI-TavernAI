import { normalizeProviderModel } from './providerModels.js';
import { normalizeProviderBaseUrl } from './providerUrls.js';

const OPENAI_IMAGE_GENERATION_MODELS = new Set(['gpt-image-1.5', 'gpt-image-2']);
const XAI_IMAGE_GENERATION_MODELS = new Set([
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-image-2.0'
]);
const GEMINI_IMAGE_GENERATION_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image'
]);

const DEFAULT_IMAGE_GENERATION_MODELS = Object.freeze({
  openai: 'gpt-image-2',
  gemini: 'gemini-3.1-flash-image',
  xai: 'grok-imagine-image'
});

export function isImageGenerationModel(settings = {}, options = {}) {
  const providerType = String(settings.providerType || '').trim();
  const model = normalizeProviderModel(providerType, options.modelOverride || options.imageModel || settings.model);
  if (!model) {
    return false;
  }
  if (providerType === 'openai') {
    return OPENAI_IMAGE_GENERATION_MODELS.has(model);
  }
  if (providerType === 'xai') {
    return XAI_IMAGE_GENERATION_MODELS.has(model);
  }
  if (providerType === 'gemini') {
    return GEMINI_IMAGE_GENERATION_MODELS.has(model);
  }
  return providerType === 'custom' && isKnownImageGenerationModel(model);
}

export function getImageGenerationCompatibility(settings = {}, options = {}) {
  const providerType = String(settings.providerType || '').trim();
  const model = resolveImageGenerationModel(settings, options);
  if (!model) {
    return { supported: false, model: '', error: imageGenerationUnsupportedMessage(model, providerType) };
  }
  if (providerType === 'custom') {
    if (isGeminiImageGenerationModel(model) && !isOfficialGeminiEndpoint(settings.baseUrl)) {
      return {
        supported: false,
        model,
        error: geminiImageGenerationRouteMessage(model)
      };
    }
    return { supported: true, model, error: '' };
  }
  if (providerType === 'openai') {
    return {
      supported: OPENAI_IMAGE_GENERATION_MODELS.has(model),
      model,
      error: OPENAI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model, providerType)
    };
  }
  if (providerType === 'xai') {
    return {
      supported: XAI_IMAGE_GENERATION_MODELS.has(model),
      model,
      error: XAI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model, providerType)
    };
  }
  if (providerType === 'gemini') {
    return {
      supported: GEMINI_IMAGE_GENERATION_MODELS.has(model),
      model,
      error: GEMINI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model, providerType)
    };
  }
  return { supported: false, model, error: imageGenerationUnsupportedMessage(model, providerType) };
}

export function resolveImageGenerationModel(settings = {}, options = {}) {
  const providerType = String(settings.providerType || '').trim().toLowerCase();
  const explicitModel = options.modelOverride || options.imageModel || options.imageGenerationModel;
  const configuredModel = explicitModel || settings.imageModel;
  if (configuredModel) {
    return normalizeProviderModel(providerType, configuredModel);
  }

  const currentModel = normalizeProviderModel(providerType, settings.model);
  if (isKnownImageGenerationModelForProvider(providerType, currentModel)) {
    return currentModel;
  }
  // If the configured chat model looks like an image model but is not in the
  // provider's allow-list, surface a useful compatibility error instead of
  // silently switching to a different default model.
  if (looksLikeImageModel(currentModel)) {
    return currentModel;
  }

  const defaultModel = DEFAULT_IMAGE_GENERATION_MODELS[providerType];
  if (defaultModel) {
    return defaultModel;
  }

  // Custom OpenAI-compatible gateways have no reliable model registry. Keep
  // the legacy behavior as a fallback when the user explicitly enabled image
  // generation and did not configure a separate model.
  return providerType === 'custom' ? currentModel : '';
}

export function isGeminiImageGenerationModel(model) {
  return GEMINI_IMAGE_GENERATION_MODELS.has(String(model || '').trim());
}

function looksLikeImageModel(model) {
  return /(?:image|imagen|imagine|dall[-_ ]?e|flux|wanx)/i.test(String(model || ''));
}

function isKnownImageGenerationModel(model) {
  return OPENAI_IMAGE_GENERATION_MODELS.has(model) ||
    XAI_IMAGE_GENERATION_MODELS.has(model) ||
    GEMINI_IMAGE_GENERATION_MODELS.has(model);
}

function isKnownImageGenerationModelForProvider(providerType, model) {
  if (!model) {
    return false;
  }
  if (providerType === 'openai') return OPENAI_IMAGE_GENERATION_MODELS.has(model);
  if (providerType === 'xai') return XAI_IMAGE_GENERATION_MODELS.has(model);
  if (providerType === 'gemini') return GEMINI_IMAGE_GENERATION_MODELS.has(model);
  return providerType === 'custom' && isKnownImageGenerationModel(model);
}

function imageGenerationUnsupportedMessage(model, providerType = '') {
  const normalizedModel = String(model || '').trim() || '当前模型';
  if (!model) {
    return `请为 ${providerType || '当前供应商'} 配置图片模型，例如 gpt-image-2 或 gemini-3.1-flash-image。`;
  }
  return `Model ${normalizedModel} is not supported for this provider's image generation route. Use gpt-image-1.5 or gpt-image-2 on OpenAI, grok-imagine-image, grok-imagine-image-quality, or grok-imagine-image-2.0 on xAI, gemini-3.1-flash-image, gemini-3-pro-image, or gemini-2.5-flash-image on Gemini, or a configured OpenAI-compatible custom image model.`;
}

function geminiImageGenerationRouteMessage(model) {
  return `Gemini 图片模型 ${model} 不能发送到当前 Codex/OpenAI-compatible 图片接口。请将供应商切换为 Gemini 并使用 generativelanguage.googleapis.com，或改用该网关已配置的 OpenAI-compatible 图片模型（例如 gpt-image-2 或 grok-imagine-image）。`;
}

function isOfficialGeminiEndpoint(baseUrl = '') {
  try {
    return new URL(normalizeProviderBaseUrl('gemini', baseUrl || '')).hostname
      === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}
