import {
  providerFetch,
  providerFetchUrl,
  providerAllowsNoAuth,
  readJsonResponse
} from './providerHttp.js';
import {
  getImageGenerationCompatibility,
  isGeminiImageGenerationModel,
  resolveImageGenerationModel
} from './providerImageModels.js';
import { providerPresets } from './providerRegistry.js';
import { normalizeProviderBaseUrl } from './providerUrls.js';
import { normalizeProviderExtraBody } from './providerExtraBody.js';
import { withProviderQuota } from './quotas.js';
import { AppError } from '../errors.js';

export async function generateImage(settings, prompt, options = {}) {
  options = options ?? {};
  return withProviderQuota(
    options.database,
    options.userId,
    () => generateImageInternal(settings, prompt, { ...options, __quotaHandled: true }),
    options
  );
}

async function generateImageInternal(settings, prompt, options = {}) {
  const compatibility = getImageGenerationCompatibility(settings, options);
  if (!compatibility.supported) {
    throw new Error(compatibility.error);
  }
  if (settings.apiKeyError) {
    throw new Error(settings.apiKeyError);
  }
  if (!settings.apiKey && !providerAllowsNoAuth(settings)) {
    throw new Error('请先填写或保存 API Key / SK，再调用图片模型。');
  }
  const model = compatibility.model || resolveImageGenerationModel(settings, options);
  if (isGeminiImageGenerationModel(model) && isOfficialGeminiEndpoint(settings.baseUrl)) {
    return generateGeminiImage(settings, prompt, options);
  }
  const requestBody = {
    ...normalizeProviderExtraBody(settings.extraBody),
    model,
    prompt: String(prompt || '').trim(),
    n: 1,
    size: options.imageSize || '1024x1024'
  };
  if (isGptImageModel(model)) {
    // GPT Image models return b64_json by default and reject the legacy
    // response_format parameter. output_format is the supported selector.
    delete requestBody.response_format;
    requestBody.output_format = normalizeOutputFormat(options.outputFormat);
  } else {
    requestBody.response_format = 'b64_json';
  }
  try {
    const response = await providerFetch(settings, '/images/generations', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    const image = normalizeGeneratedImage(json);
    if (!image) {
      throw new Error('生图模型没有返回图片数据');
    }
    return {
      content: image.revisedPrompt ? `已生成图片：${image.revisedPrompt}` : '已生成图片',
      attachments: [image],
      usage: json.usage || null,
      provider: settings.gatewayName,
      providerType: settings.providerType,
      model
    };
  } catch (error) {
    throw normalizeImageGenerationError(error, model);
  }
}

async function generateGeminiImage(settings, prompt, options = {}) {
  const model = resolveImageGenerationModel(settings, options);
  try {
    const response = await providerFetchUrl(settings, geminiNativeGenerateContentUrl(settings, model), {
      method: 'POST',
      headers: geminiNativeRequestHeaders(settings),
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: String(prompt || '').trim() }]
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      }),
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    const image = normalizeGeminiGeneratedImage(json);
    if (!image) {
      throw new Error('Gemini 生图模型没有返回 inlineData 图片数据');
    }
    return {
      content: image.revisedPrompt ? `已生成图片：${image.revisedPrompt}` : '已生成图片',
      attachments: [image],
      usage: json.usageMetadata || json.usage_metadata || json.usage || null,
      provider: settings.gatewayName,
      providerType: settings.providerType,
      model
    };
  } catch (error) {
    throw normalizeImageGenerationError(error, model);
  }
}

function normalizeGeneratedImage(json = {}) {
  const first = Array.isArray(json.data) ? json.data[0] : json.image || json.output?.[0] || null;
  if (!first || typeof first !== 'object') {
    return null;
  }
  const b64 = String(first.b64_json || first.b64Json || first.base64 || '').trim();
  if (!b64) {
    return null;
  }
  const mimeType = String(first.mime_type || first.mimeType || 'image/png').trim() || 'image/png';
  return {
    type: 'image',
    dataUrl: `data:${mimeType};base64,${b64}`,
    mimeType,
    name: 'generated-image.png',
    alt: String(first.revised_prompt || first.revisedPrompt || '生成图片').trim(),
    size: Math.floor((b64.length * 3) / 4),
    revisedPrompt: String(first.revised_prompt || first.revisedPrompt || '').trim()
  };
}

function normalizeGeminiGeneratedImage(json = {}) {
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  let revisedPrompt = '';
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || candidate?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        revisedPrompt = revisedPrompt ? `${revisedPrompt}\n${part.text.trim()}` : part.text.trim();
        continue;
      }
      const inlineData = part?.inlineData || part?.inline_data;
      const b64 = String(inlineData?.data || '').trim();
      if (!b64) {
        continue;
      }
      const mimeType = String(inlineData.mimeType || inlineData.mime_type || 'image/png').trim() || 'image/png';
      return {
        type: 'image',
        dataUrl: `data:${mimeType};base64,${b64}`,
        mimeType,
        name: 'gemini-generated-image.png',
        alt: 'Gemini generated image',
        size: Buffer.byteLength(b64, 'base64'),
        revisedPrompt
      };
    }
  }
  return null;
}

function geminiNativeGenerateContentUrl(settings = {}, model = '') {
  let url;
  try {
    url = new URL(normalizeProviderBaseUrl('gemini', settings.baseUrl || providerPresets.gemini.baseUrl));
  } catch {
    url = new URL(providerPresets.gemini.baseUrl);
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/openai')) {
    pathname = pathname.slice(0, -'/openai'.length);
  }
  url.pathname = `${pathname}/models/${encodeURIComponent(model)}:generateContent`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function geminiNativeRequestHeaders(settings = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (settings.apiKey) {
    headers['x-goog-api-key'] = settings.apiKey;
  }
  return headers;
}

function isOfficialGeminiEndpoint(baseUrl = '') {
  try {
    return new URL(normalizeProviderBaseUrl('gemini', baseUrl || providerPresets.gemini.baseUrl)).hostname
      === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

function isGptImageModel(model = '') {
  return /^gpt-image(?:-|$)/i.test(String(model || '').trim());
}

function normalizeOutputFormat(value = '') {
  const format = String(value || '').trim().toLowerCase();
  return ['png', 'jpeg', 'webp'].includes(format) ? format : 'png';
}

function normalizeImageGenerationError(error, model = '') {
  const message = String(error?.message || '').trim();
  if (!/auth_not_found\s*:\s*no auth available/i.test(message)) {
    return error;
  }
  const normalizedModel = String(model || '所选图片模型').trim() || '所选图片模型';
  const upstreamStatus = Number(error?.response?.status);
  const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 ? upstreamStatus : 503;
  const authError = new AppError(
    status,
    'IMAGE_AUTH_UNAVAILABLE',
    `图片模型鉴权失败：当前网关没有可用于 ${normalizedModel} 的图片凭据。请修复 Codex/代理的图片授权，或改用已配置 API Key 的 OpenAI-compatible 图片网关。`,
    { cause: error }
  );
  // AppError keeps the upstream message in `cause`; expose the safe, actionable
  // image-auth explanation to direct service callers as well as HTTP routes.
  authError.message = authError.publicMessage;
  return authError;
}
