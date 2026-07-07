import { normalizeProviderModel } from './providerModels.js';

const OPENAI_IMAGE_GENERATION_MODELS = new Set(['gpt-image-2']);
const XAI_IMAGE_GENERATION_MODELS = new Set(['grok-imagine-image', 'grok-imagine-image-quality']);
const GEMINI_IMAGE_GENERATION_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image'
]);

export function isImageGenerationModel(settings = {}, options = {}) {
  const providerType = String(settings.providerType || '').trim();
  const model = resolveProviderModel(settings, options);
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
  const model = resolveProviderModel(settings, options);
  if (providerType === 'custom') {
    return { supported: Boolean(model), error: model ? '' : imageGenerationUnsupportedMessage(model) };
  }
  if (providerType === 'openai') {
    return {
      supported: OPENAI_IMAGE_GENERATION_MODELS.has(model),
      error: OPENAI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model)
    };
  }
  if (providerType === 'xai') {
    return {
      supported: XAI_IMAGE_GENERATION_MODELS.has(model),
      error: XAI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model)
    };
  }
  if (providerType === 'gemini') {
    return {
      supported: GEMINI_IMAGE_GENERATION_MODELS.has(model),
      error: GEMINI_IMAGE_GENERATION_MODELS.has(model) ? '' : imageGenerationUnsupportedMessage(model)
    };
  }
  return { supported: false, error: imageGenerationUnsupportedMessage(model) };
}

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}

function isKnownImageGenerationModel(model) {
  return OPENAI_IMAGE_GENERATION_MODELS.has(model) ||
    XAI_IMAGE_GENERATION_MODELS.has(model) ||
    GEMINI_IMAGE_GENERATION_MODELS.has(model);
}

function imageGenerationUnsupportedMessage(model) {
  const normalizedModel = String(model || '').trim() || '当前模型';
  return `Model ${normalizedModel} is not supported for this provider's image generation route. Use gpt-image-2 on OpenAI, grok-imagine-image or grok-imagine-image-quality on xAI, gemini-3.1-flash-image, gemini-3-pro-image, or gemini-2.5-flash-image on Gemini, or a configured OpenAI-compatible custom image model.`;
}
