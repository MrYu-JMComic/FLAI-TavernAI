import { resolveProviderModelCapabilities } from '../../../shared/providerCapabilities.js';
import { resolveThinkingPreferenceLevel } from '../../../shared/providerThinking.js';

export function objectOrEmpty(value) {
  return value && typeof value === 'object' ? value : {};
}

export function nullToEmptyObject(value) {
  return value ?? {};
}

export function cloneToolCalls(toolCalls = []) {
  const cloned = [];
  const source = Array.isArray(toolCalls) ? toolCalls : [];
  for (let index = 0; index < source.length; index += 1) {
    const call = source[index];
    cloned.push({
      name: call.name,
      arguments: call.arguments,
      ...(call.policy ? { policy: call.policy } : {}),
      result: call.result
    });
  }
  return cloned;
}

export function parseLooseJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) {
    return {};
  }

  try {
    return objectOrEmpty(JSON.parse(value));
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return objectOrEmpty(JSON.parse(match[0]));
    } catch {
      return {};
    }
  }
}

/**
 * Resolve the thinking budget an assistant run may use. The requested level is
 * clamped by what the resolved provider/model actually supports so a stored UI
 * preference can never force an unsupported request body.
 */
export function resolveAssistantThinking(settings, requestedLevel) {
  const control = resolveProviderModelCapabilities(settings).thinking || {};
  const level = resolveThinkingPreferenceLevel(requestedLevel, control, control.defaultLevel) || 'off';
  return {
    enabled: Boolean(control.supported && level !== 'off'),
    level
  };
}

/**
 * True when a provider-streaming failure is worth retrying in stable
 * (non-streaming) mode. User aborts and real provider errors are not.
 */
export function shouldRecoverAssistantStream(error, signal) {
  if (signal?.aborted || error?.name === 'AbortError') return false;
  return /AI 流式响应(?:中断|不可用)/.test(String(error?.message || ''));
}
