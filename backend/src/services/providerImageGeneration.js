import {
  providerFetch,
  providerFetchUrl,
  readJsonResponse
} from './providerHttp.js';
import { getImageGenerationCompatibility } from './providerImageModels.js';
import { normalizeProviderModel } from './providerModels.js';
import { providerPresets } from './providerRegistry.js';
import { normalizeProviderBaseUrl } from './providerUrls.js';
import { normalizeProviderExtraBody } from './providerExtraBody.js';
import { withProviderQuota } from './quotas.js';

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
  if (settings.providerType === 'gemini') {
    return generateGeminiImage(settings, prompt, options);
  }
  const response = await providerFetch(settings, '/images/generations', {
    method: 'POST',
    body: JSON.stringify({
      ...normalizeProviderExtraBody(settings.extraBody),
      model: resolveProviderModel(settings, options),
      prompt: String(prompt || '').trim(),
      n: 1,
      size: options.imageSize || '1024x1024',
      response_format: 'b64_json'
    })
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
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

async function generateGeminiImage(settings, prompt, options = {}) {
  const model = normalizeProviderModel(settings.providerType, resolveProviderModel(settings, options));
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
    })
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

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}
