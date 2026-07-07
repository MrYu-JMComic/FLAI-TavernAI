import { sanitizeDiagnosticLogPayload, sanitizeDiagnosticText } from './diagnosticRedaction.js';

export function captureAssistantStreamText(target, event, data) {
  if (!target || !data || typeof data.text !== 'string') {
    return;
  }
  if (event === 'content') {
    target.content += data.text;
  } else if (event === 'reasoning') {
    target.reasoning += data.text;
  }
}

export function hasAssistantPayload(result = {}) {
  return Boolean(String(result.content || '').trim() || String(result.reasoning || '').trim());
}

export function createDiagnosticId(prefix = 'chat') {
  const normalizedPrefix = String(prefix || 'chat').trim().replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'chat';
  return `${normalizedPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createChatDiagnosticId() {
  return createDiagnosticId('chat');
}

export function logAssistantPayloadFailure({
  diagnosticId,
  stage,
  mode,
  request,
  conversation,
  character,
  settings,
  result,
  partialAssistant,
  modelMessages,
  worldBookMatches
}) {
  try {
    console.warn('[chat] assistant payload missing', {
      diagnosticId,
      stage,
      mode,
      userId: request?.auth?.user?.id || '',
      conversationId: conversation?.id || '',
      characterId: character?.id || conversation?.characterId || conversation?.character_id || '',
      providerType: settings?.providerType || '',
      gatewayName: settings?.gatewayName || '',
      model: settings?.model || '',
      baseUrlHost: safeUrlHost(settings?.baseUrl),
      supportsReasoning: Boolean(settings?.supportsReasoning),
      messageCount: countIterable(modelMessages),
      worldBookMatchCount: countIterable(worldBookMatches),
      resultKeys: listOwnKeys(result),
      resultProvider: result?.provider || '',
      resultProviderType: result?.providerType || '',
      resultModel: result?.model || '',
      contentLength: String(result?.content || '').length,
      reasoningLength: String(result?.reasoning || '').length,
      partialContentLength: String(partialAssistant?.content || '').length,
      partialReasoningLength: String(partialAssistant?.reasoning || '').length,
      usageKeys: listOwnKeys(result?.usage),
      providerDiagnostics: sanitizeDiagnosticLogPayload(result?.diagnostics || null)
    });
  } catch (error) {
    console.warn('[chat] assistant payload missing; failed to build diagnostics', diagnosticId, sanitizeDiagnosticText(error?.message || error));
  }
}

export function isAbortError(error) {
  const message = String(error?.message || '');
  return error?.name === 'AbortError' || /aborted|abort/i.test(message);
}

function safeUrlHost(value) {
  try {
    return value ? new URL(String(value)).host : '';
  } catch {
    return '';
  }
}

function countIterable(value) {
  if (!value || typeof value[Symbol.iterator] !== 'function') {
    return 0;
  }
  let count = 0;
  for (const _item of value) {
    count += 1;
  }
  return count;
}

function listOwnKeys(value, limit = 12) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const keys = [];
  for (const key of Object.keys(value)) {
    keys.push(key);
    if (keys.length >= limit) {
      break;
    }
  }
  return keys;
}
