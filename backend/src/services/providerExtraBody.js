export function normalizeProviderExtraBody(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return {};
  }
  return value;
}

export function normalizeProviderRequestExtraBody(providerType, value) {
  const extraBody = normalizeProviderExtraBody(value);
  if (providerType !== 'gemini') {
    return extraBody;
  }
  return omitGeminiNativeRequestFields(extraBody);
}

function omitGeminiNativeRequestFields(extraBody) {
  let sanitized = extraBody;
  for (const key in extraBody) {
    if (!Object.prototype.hasOwnProperty.call(extraBody, key) || !isGeminiNativeRequestField(key)) {
      continue;
    }
    if (sanitized === extraBody) {
      sanitized = { ...extraBody };
    }
    delete sanitized[key];
  }
  return sanitized;
}

function isGeminiNativeRequestField(key) {
  switch (key) {
    case 'contents':
    case 'systemInstruction':
    case 'system_instruction':
    case 'safetySettings':
    case 'safety_settings':
    case 'generationConfig':
    case 'generation_config':
    case 'toolConfig':
    case 'tool_config':
    case 'cachedContent':
    case 'cached_content':
      return true;
    default:
      return false;
  }
}
