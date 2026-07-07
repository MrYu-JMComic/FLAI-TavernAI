import { parseJson } from '../utils/json.js';
import {
  createThinkingTagFilter,
  extractReasoning,
  extractText,
  mergeReasoning,
  splitThinkingTags
} from './providerContent.js';
import {
  createJsonResponseDiagnostics,
  createJsonStreamResponseDiagnostics
} from './providerDiagnostics.js';
import { readJsonResponseValue } from './providerHttp.js';
import { normalizeProviderModel } from './providerModels.js';
import { readNumber, readOptionalNumber } from './providerNumbers.js';
import { extractResponsesOutputTextDelta } from './providerOpenAiResponses.js';

export async function streamChatCompletionJsonResponse(response, settings, emit) {
  const json = await readJsonResponseValue(response, { allowArray: true });
  const result = Array.isArray(json)
    ? consumeChatCompletionStreamPayloads(json, settings, emit)
    : parseChatCompletionResult(json, settings);
  result.diagnostics = Array.isArray(json)
    ? createJsonStreamResponseDiagnostics(response, result, json)
    : createJsonResponseDiagnostics(response, result);
  if (!Array.isArray(json)) {
    emitChatCompletionResult(result, emit);
  }
  return result;
}

export function parseChatCompletionResult(json, settings = {}) {
  const message = extractChatMessage(json);
  const parsedContent = splitThinkingTags(extractText(message.content));
  const reasoning = mergeReasoning(extractReasoning(message), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: extractChatCompletionUsage(json),
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

function emitChatCompletionResult(result = {}, emit) {
  if (typeof emit !== 'function') {
    return;
  }
  if (result.reasoning) {
    emit('reasoning', { text: result.reasoning });
  }
  if (result.content) {
    emit('content', { text: result.content });
  }
}

function extractChatCompletionUsage(json = {}) {
  return json.usage || normalizeGeminiUsage(json.usageMetadata || json.usage_metadata);
}

function consumeChatCompletionStreamPayloads(value, settings = {}, emit) {
  const state = { content: '', reasoning: '', usage: null };
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      state.content += text;
      emit?.('content', { text });
    },
    onReasoning(text) {
      state.reasoning += text;
      emit?.('reasoning', { text });
    }
  });

  for (const payload of collectChatCompletionStreamPayloads(value)) {
    consumeChatCompletionStreamPayload(payload, {}, state, thinkingTagFilter, emit);
  }
  thinkingTagFilter.flush();

  return {
    content: state.content,
    reasoning: state.reasoning,
    usage: state.usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export function consumeChatCompletionStreamPayload(payload, event, state, thinkingTagFilter, emit) {
  state.usage = extractStreamingUsage(payload, state.usage);
  const delta = extractStreamingDelta(payload);
  const reasoningDelta = extractStreamingReasoningDelta(payload, delta);
  const contentDelta = extractStreamingContentDelta(payload, delta, event);

  if (reasoningDelta) {
    state.reasoning += reasoningDelta;
    emit?.('reasoning', { text: reasoningDelta });
  }
  if (contentDelta) {
    thinkingTagFilter.push(contentDelta);
  }
}

export function collectChatCompletionStreamPayloads(value) {
  const payloads = [];
  appendChatCompletionStreamPayloads(payloads, value, 0);
  return payloads;
}

function appendChatCompletionStreamPayloads(payloads, value, depth) {
  if (depth > 5 || value == null) {
    return;
  }

  const parsed = parseNestedJsonPayload(value);
  if (parsed == null) {
    return;
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      appendChatCompletionStreamPayloads(payloads, item, depth + 1);
    }
    return;
  }

  if (typeof parsed !== 'object') {
    return;
  }

  if (hasDirectChatCompletionPayload(parsed)) {
    payloads.push(parsed);
    return;
  }

  appendWrappedChatCompletionPayloads(payloads, parsed, depth);
}

function appendWrappedChatCompletionPayloads(payloads, value, depth) {
  appendWrappedChatCompletionPayload(payloads, value, 'data', depth);
  appendWrappedChatCompletionPayload(payloads, value, 'payload', depth);
  appendWrappedChatCompletionPayload(payloads, value, 'chunk', depth);
  appendWrappedChatCompletionPayload(payloads, value, 'result', depth);
  appendWrappedChatCompletionPayload(payloads, value, 'response', depth);
}

function appendWrappedChatCompletionPayload(payloads, value, key, depth) {
  if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === value) {
    return;
  }
  appendChatCompletionStreamPayloads(payloads, value[key], depth + 1);
}

function parseNestedJsonPayload(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  return parseJson(trimmed, null);
}

function hasDirectChatCompletionPayload(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Boolean(
    Array.isArray(value.choices) ||
      Array.isArray(value.candidates) ||
      value.delta !== undefined ||
      value.content !== undefined ||
      value.text !== undefined ||
      value.output_text !== undefined ||
      value.output?.choices ||
      value.output?.message ||
      value.output?.delta ||
      value.output?.content ||
      value.message ||
      value.usage ||
      value.usageMetadata ||
      value.usage_metadata ||
      value.response?.usage ||
      value.response?.output_text ||
      value.response?.output
  );
}

function normalizeGeminiUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const promptTokens = readNumber(usage.prompt_tokens, usage.promptTokenCount, usage.prompt_token_count, 0);
  const completionTokens = readNumber(usage.completion_tokens, usage.candidatesTokenCount, usage.candidates_token_count, 0);
  const totalTokens = readOptionalNumber(usage.total_tokens ?? usage.totalTokenCount ?? usage.total_token_count) ??
    promptTokens + completionTokens;
  return {
    ...usage,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  };
}

export function isJsonResponse(response) {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  return contentType.includes('application/json') || contentType.includes('+json');
}

export function extractStreamingUsage(json = {}, fallback = null) {
  return json.usage || json.response?.usage || normalizeGeminiUsage(json.usageMetadata || json.usage_metadata) || fallback;
}

export function extractStreamingReasoningDelta(json = {}, delta = {}) {
  return mergeReasoning(
    extractReasoning(delta),
    extractText(json.reasoning_delta || json.reasoningDelta || json.reasoning_content_delta || '')
  );
}

export function extractStreamingContentDelta(json = {}, delta = {}, event = {}) {
  const deltaContent = extractText(delta?.content || delta?.text || delta?.output_text || delta?.text_delta || delta?.delta);
  if (deltaContent) {
    return deltaContent;
  }

  const responseDelta = extractResponsesOutputTextDelta(event?.event || json.type, json);
  if (responseDelta) {
    return responseDelta;
  }

  if (typeof json.delta === 'string') {
    return json.delta;
  }

  return extractText(
    json.content ||
      json.text ||
      json.output_text ||
      json.response?.output_text ||
      json.response?.text ||
      json.response?.content ||
      json.response?.output ||
      json.response ||
      json.message?.content ||
      json.choices?.[0]?.text ||
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.delta?.text ||
      json.output?.text ||
      json.output?.content
  );
}

export function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const normalized = [];
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    const fn = call?.function || {};
    const name = fn.name || call?.name;
    if (!name) {
      continue;
    }

    const id = call?.id || `tool-call-${index}`;
    normalized.push({
      id,
      name,
      arguments: parseJson(fn.arguments || call?.arguments || '{}', {}),
      raw: {
        id,
        type: call?.type || 'function',
        function: {
          name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || call?.arguments || {})
        }
      }
    });
  }
  return normalized;
}

export function collectRawToolCalls(calls = []) {
  const rawCalls = [];
  for (const call of calls) {
    rawCalls.push(call.raw);
  }
  return rawCalls;
}

export function normalizeStreamingToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const normalized = [];
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    normalized.push({
      index: Number.isFinite(call?.index) ? call.index : index,
      id: call?.id || '',
      name: call?.function?.name || '',
      arguments: call?.function?.arguments || ''
    });
  }
  return normalized;
}

export function extractChatMessage(json = {}) {
  return json.choices?.[0]?.message ||
    json.output?.choices?.[0]?.message ||
    json.output?.message ||
    normalizeGeminiCandidateMessage(json.candidates?.[0]) ||
    json.message ||
    {};
}

export function extractStreamingDelta(json = {}) {
  return firstStreamingPayload(
    json.choices?.[0]?.delta,
    json.choices?.[0]?.message,
    json.output?.choices?.[0]?.delta,
    json.output?.choices?.[0]?.message,
    json.output?.delta,
    normalizeGeminiCandidateMessage(json.candidates?.[0]),
    json.delta
  );
}

function firstStreamingPayload(...values) {
  for (const value of values) {
    if (hasStreamingPayload(value)) {
      return value;
    }
  }
  return {};
}

function hasStreamingPayload(value) {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return Boolean(value);
  }
  if (typeof value !== 'object') {
    return true;
  }
  return Boolean(
    extractText(value.content || value.text || value.parts) ||
      extractReasoning(value) ||
      hasListItems(value.tool_calls) ||
      value.function_call ||
      typeof value.delta === 'string'
  );
}

function hasListItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function normalizeGeminiCandidateMessage(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const parts = normalizeGeminiContentParts(candidate);
  const content = parts || candidate.content || candidate.text;
  const toolCalls = normalizeGeminiFunctionCallParts(parts);
  if (!content && !toolCalls.length) {
    return null;
  }

  return {
    content,
    tool_calls: toolCalls,
    reasoning: candidate.reasoning || candidate.thinking || candidate.content?.reasoning || ''
  };
}

function normalizeGeminiContentParts(candidate) {
  const parts = candidate?.content?.parts || candidate?.parts;
  return Array.isArray(parts) ? parts : null;
}

function normalizeGeminiFunctionCallParts(parts) {
  if (!Array.isArray(parts)) {
    return [];
  }

  const calls = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const functionCall = part?.functionCall || part?.function_call;
    if (!functionCall?.name) {
      continue;
    }
    const args = functionCall.args || functionCall.arguments || {};
    const argumentText = typeof args === 'string' ? args : JSON.stringify(args || {});
    calls.push({
      index,
      id: functionCall.id || `gemini-function-call-${index}`,
      type: 'function',
      function: {
        name: functionCall.name,
        arguments: argumentText
      }
    });
  }
  return calls;
}
