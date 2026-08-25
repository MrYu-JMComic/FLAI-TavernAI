export const DIAGNOSTIC_REDACTED_VALUE = '[redacted]';

const SECRET_KEY_PATTERN = /(?:api[_-]?key(?![_-]?(?:set|hint|needs[_-]?reset|error))|apikey(?!set|hint|needsreset|error)|authorization|cookie|set[_-]?cookie|secret|token|password|session|csrf|encrypted)/i;
const IMAGE_DATA_URL_PATTERN = /\bdata:(image\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[a-z0-9._~+/=-]+/gi;
const OPENAI_STYLE_SECRET_PATTERN = /\bsk-[a-z0-9][a-z0-9._-]{5}\b/gi;
const HEADER_SECRET_PATTERN = /\b(authorization|cookie|set-cookie|x-csrf-token|csrf-token|x-api-key|api-key|api_key|password|token|secret)\s*[:=]\s*[^,\r\n]+/gi;
const COOKIE_PAIR_PATTERN = /\b(flai_session|session|sessionid|csrf|csrf_token|csrf-token|x-csrf-token)=([^;\s,]+)/gi;

export function sanitizeDiagnosticValue(value) {
  return sanitizeDiagnosticValueInternal(value, '', new WeakMap());
}

export function sanitizeDiagnosticLogPayload(value) {
  return sanitizeDiagnosticValue(value);
}

export function sanitizeDiagnosticText(value) {
  return redactSensitiveText(String(value || ''));
}

export function isDiagnosticSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ''));
}

function sanitizeDiagnosticValueInternal(value, key, seen) {
  if (isDiagnosticSecretKey(key)) {
    return DIAGNOSTIC_REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) {
      output.push(sanitizeDiagnosticValueInternal(item, key, seen));
    }
    return output;
  }

  if (value instanceof Error) {
    return {
      name: sanitizeDiagnosticValueInternal(value.name, 'name', seen),
      message: sanitizeDiagnosticValueInternal(value.message, 'message', seen),
      stack: sanitizeDiagnosticValueInternal(value.stack || '', 'stack', seen)
    };
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const cached = seen.get(value);
  if (cached) {
    return '[circular]';
  }

  const output = {};
  seen.set(value, output);
  for (const [entryKey, entryValue] of Object.entries(value)) {
    output[entryKey] = sanitizeDiagnosticValueInternal(entryValue, entryKey, seen);
  }
  return output;
}

function redactSensitiveText(value) {
  return value
    .replace(IMAGE_DATA_URL_PATTERN, 'data:$1;base64,[redacted]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [redacted]')
    .replace(HEADER_SECRET_PATTERN, '$1: [redacted]')
    .replace(COOKIE_PAIR_PATTERN, '$1=[redacted]')
    .replace(OPENAI_STYLE_SECRET_PATTERN, DIAGNOSTIC_REDACTED_VALUE);
}
