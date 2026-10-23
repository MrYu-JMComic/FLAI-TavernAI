import { parseJson } from '../utils/json.js';
import {
  appendReasoning,
  createThinkingTagFilter,
  extractText,
  mergeReasoning,
  splitThinkingTags
} from './providerContent.js';
import { normalizeProviderExtraBody } from './providerExtraBody.js';
import { providerFetch, readJsonResponse, responseErrorText } from './providerHttp.js';
import { normalizeProviderModel } from './providerModels.js';
import { normalizeToolCompletionRounds, normalizeProviderNumber } from './providerNumbers.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';
import {
  hasProviderStreamError,
  providerStreamErrorMessage
} from './providerStreamErrors.js';
import { executeProviderTool } from './providerToolResults.js';
import { resolveToolChoice } from './providerToolChoice.js';
import { appendProcessContent, appendProcessTool } from './providerProcessActivity.js';
import {
  normalizeThinkingLevel,
  resolveSupportedThinkingLevel,
  resolveThinkingControl
} from '../../../shared/providerThinking.js';

export function usesResponsesApi(settings = {}) {
  return Boolean(settings.supportsReasoning && ['openai', 'xai'].includes(settings.providerType));
}

function responseExtraBody(settings, options = {}) {
  const extraBody = normalizeProviderExtraBody(settings.extraBody);
  if (!options.unlimitedOutput) return extraBody;
  const sanitized = { ...extraBody };
  delete sanitized.max_output_tokens;
  delete sanitized.max_completion_tokens;
  delete sanitized.max_tokens;
  delete sanitized.maxOutputTokens;
  delete sanitized.maxCompletionTokens;
  delete sanitized.maxTokens;
  return sanitized;
}

function responseOutputLimit(options) {
  if (options.unlimitedOutput) return {};
  const limit = normalizeProviderNumber(options.maxTokens);
  return limit != null && limit > 0 ? { max_output_tokens: Math.floor(limit) } : {};
}

export async function generateOpenAiResponse(settings, messages, options = {}) {
  const response = await providerFetch(settings, '/responses', {
    method: 'POST',
    body: JSON.stringify({
      ...responseExtraBody(settings, options),
      model: resolveProviderModel(settings, options),
      input: convertMessagesForOpenAiResponses(messages),
      reasoning: buildOpenAiReasoning(settings, options),
      ...responseOutputLimit(options),
      stream: false
    }),
    signal: options.signal,
    requestTrace: options.requestTrace,
    timeoutMs: options.timeoutMs
  });

  const json = await readJsonResponse(response);
  const parsedContent = splitThinkingTags(json.output_text || extractOpenAiOutputText(json));
  const reasoning = mergeReasoning(extractOpenAiReasoning(json), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamOpenAiResponse(settings, messages, emit, signal, options = {}) {
  const response = await providerFetch(settings, '/responses', {
      method: 'POST',
      body: JSON.stringify({
      ...responseExtraBody(settings, options),
      model: resolveProviderModel(settings, options),
      input: convertMessagesForOpenAiResponses(messages),
      reasoning: buildOpenAiReasoning(settings, options),
      ...responseOutputLimit(options),
      stream: true
    }),
    signal,
    requestTrace: options.requestTrace,
    timeoutMs: options.timeoutMs
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  let terminalEvent = '';
  const streamEmit = createStreamEmitQueue(emit);
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      content += text;
      streamEmit.emit('content', { text });
    },
    onReasoning(text) {
      reasoning += text;
      streamEmit.emit('reasoning', { text });
    }
  });

  for await (const event of parseSse(response.body)) {
    const json = parseJson(event.data, null);
    const type = json?.type || event.event;
    if (!json) {
      continue;
    }
    if (hasProviderStreamError(json, event.event) || type === 'response.failed') {
      throw new Error(providerStreamErrorMessage(json, 'Responses API 流式响应失败'));
    }
    if (type === 'response.incomplete') {
      const reason = json.response?.incomplete_details?.reason || json.incomplete_details?.reason;
      throw new Error(reason
        ? `Responses API 流式响应未完成：${reason}`
        : 'Responses API 流式响应未完成');
    }

    const outputTextDelta = extractResponsesOutputTextDelta(type, json);
    if (outputTextDelta) {
      thinkingTagFilter.push(outputTextDelta);
    }

    const reasoningDelta = extractResponsesReasoningDelta(type, json);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      streamEmit.emit('reasoning', { text: reasoningDelta });
    }

    if (type === 'response.completed') {
      terminalEvent = type;
      usage = json.response?.usage || usage;
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  await streamEmit.wait();
  if (!terminalEvent) {
    throw new Error('Responses API 流式响应在 response.completed 前中断');
  }

  return {
    content,
    reasoning,
    usage,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function runOpenAiResponseToolCompletion(settings, messages, tools, executeTool, options = {}) {
  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const responseTools = convertToolsForOpenAiResponses(tools);
  const process = [];
  const toolCalls = [];
  let input = convertMessagesForOpenAiResponses(messages);
  let previousResponseId = '';
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;
  let finalResponse = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await providerFetch(settings, '/responses', {
      method: 'POST',
      body: JSON.stringify({
        ...responseExtraBody(settings, options),
        model: resolveProviderModel(settings, options),
        input,
        reasoning: buildOpenAiReasoning(settings, options),
        ...responseOutputLimit(options),
        tools: responseTools,
        tool_choice: convertToolChoiceForOpenAiResponses(resolveToolChoice(options.toolChoice, { round: round + 1, process, toolCalls })),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        stream: false
      }),
      signal: options.signal,
      requestTrace: options.requestTrace,
      timeoutMs: options.timeoutMs
    });
    const json = await readJsonResponse(response);
    finalResponse = json;
    usage = json.usage || usage;
    previousResponseId = json.id || previousResponseId;

    const parsedContent = splitThinkingTags(json.output_text || extractOpenAiOutputText(json));
    const reasoning = mergeReasoning(extractOpenAiReasoning(json), parsedContent.reasoning);
    const step = {
      round: round + 1,
      content: parsedContent.content,
      reasoning,
      tools: []
    };
    process.push(step);
    if (typeof options.onStep === 'function') await options.onStep(step);
    finalContent = parsedContent.content;
    finalReasoning = mergeReasoning(finalReasoning, reasoning);

    const calls = normalizeOpenAiResponseFunctionCalls(json.output);
    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        input = [{ role: 'user', content: String(nudge) }];
        continue;
      }
      break;
    }

    input = [];
    for (const call of calls) {
      const prepared = await executeProviderTool(
        executeTool,
        call.name,
        call.arguments,
        call,
        options.signal,
        tools,
        { database: options.database, userId: options.userId }
      );
      const result = prepared.result;
      const log = {
        name: call.name,
        arguments: call.arguments,
        policy: prepared.policy,
        result
      };
      step.tools.push(log);
      appendProcessTool(step, step.tools.length - 1);
      toolCalls.push(log);
      if (typeof options.onToolCall === 'function') {
        await options.onToolCall({ round: step.round, ...log });
      }
      input.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: prepared.content
      });
      if (prepared.stop) {
        return buildOpenAiResponseToolResult({
          settings,
          content: finalContent,
          reasoning: finalReasoning,
          response: finalResponse,
          usage,
          toolCalls,
          process
        });
      }
    }
  }

  return buildOpenAiResponseToolResult({
    settings,
    content: finalContent,
    reasoning: finalReasoning,
    response: finalResponse,
    usage,
    toolCalls,
    process
  });
}

export async function streamOpenAiResponseToolCompletion(settings, messages, tools, executeTool, emit, signal, options = {}) {
  const streamEmit = createStreamEmitQueue(emit);
  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const responseTools = convertToolsForOpenAiResponses(tools);
  const process = [];
  const toolCalls = [];
  let input = convertMessagesForOpenAiResponses(messages);
  let previousResponseId = '';
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;
  let finalResponse = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const step = { round: round + 1, content: '', reasoning: '', tools: [] };
    process.push(step);
    if (typeof options.onStep === 'function') {
      await options.onStep(step);
    } else {
      await streamEmit.emit('step', step);
    }

    const response = await providerFetch(settings, '/responses', {
      method: 'POST',
      body: JSON.stringify({
        ...responseExtraBody(settings, options),
        model: resolveProviderModel(settings, options),
        input,
        reasoning: buildOpenAiReasoning(settings, options),
        ...responseOutputLimit(options),
        tools: responseTools,
        tool_choice: convertToolChoiceForOpenAiResponses(resolveToolChoice(options.toolChoice, {
          round: round + 1, process, toolCalls
        })),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        stream: true
      }),
      signal,
      requestTrace: options.requestTrace,
      timeoutMs: options.timeoutMs
    });
    if (!response.ok) {
      throw new Error(await responseErrorText(response));
    }

    const streamed = await streamOpenAiResponseToolRound(response, step, streamEmit, signal);
    finalContent = step.content;
    finalReasoning = mergeReasoning(finalReasoning, step.reasoning);
    usage = streamed.usage || usage;
    previousResponseId = streamed.responseId || previousResponseId;
    finalResponse = streamed.response;

    if (!streamed.calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        await streamEmit.emit('nudge', { round: step.round, text: String(nudge) });
        input = [{ role: 'user', content: String(nudge) }];
        continue;
      }
      await streamEmit.wait();
      return buildOpenAiResponseToolResult({
        settings, content: finalContent, reasoning: finalReasoning,
        response: finalResponse, usage, toolCalls, process
      });
    }

    input = [];
    for (const call of streamed.calls) {
      const prepared = await executeProviderTool(
        executeTool,
        call.name,
        call.arguments,
        call,
        signal,
        tools,
        { database: options.database, userId: options.userId }
      );
      const log = {
        name: call.name,
        arguments: call.arguments,
        policy: prepared.policy,
        result: prepared.result
      };
      step.tools.push(log);
      appendProcessTool(step, step.tools.length - 1);
      toolCalls.push(log);
      const event = { round: step.round, ...log };
      if (typeof options.onToolCall === 'function') {
        await options.onToolCall(event);
      } else {
        await streamEmit.emit('tool', event);
      }
      input.push({
        type: 'function_call_output',
        call_id: call.callId,
        output: prepared.content
      });
      if (prepared.stop) {
        await streamEmit.wait();
        return buildOpenAiResponseToolResult({
          settings, content: finalContent, reasoning: finalReasoning,
          response: finalResponse, usage, toolCalls, process
        });
      }
    }
  }

  await streamEmit.wait();
  return buildOpenAiResponseToolResult({
    settings, content: finalContent, reasoning: finalReasoning,
    response: finalResponse, usage, toolCalls, process
  });
}

async function streamOpenAiResponseToolRound(response, step, streamEmit, signal) {
  if (isJsonProviderResponse(response)) {
    const json = await readJsonResponse(response);
    const parsedContent = splitThinkingTags(json.output_text || extractOpenAiOutputText(json));
    const reasoning = mergeReasoning(extractOpenAiReasoning(json), parsedContent.reasoning);
    step.content = parsedContent.content;
    step.reasoning = reasoning;
    appendProcessContent(step, step.content);
    if (step.reasoning) await streamEmit.emit('reasoning', { round: step.round, text: step.reasoning });
    if (step.content) await streamEmit.emit('content', { round: step.round, text: step.content });
    await streamEmit.wait();
    const calls = normalizeOpenAiResponseFunctionCalls(json.output);
    const responseId = json.id || '';
    return {
      calls,
      responseId,
      usage: json.usage || null,
      response: json
    };
  }
  let terminalEvent = '';
  let responseId = '';
  let usage = null;
  const calls = new Map();
  const thinkingTagFilter = createThinkingTagFilter({
    onContent(text) {
      step.content += text;
      appendProcessContent(step, text);
      void streamEmit.emit('content', { round: step.round, text });
    },
    onReasoning(text) {
      step.reasoning += text;
      void streamEmit.emit('reasoning', { round: step.round, text });
    }
  });

  for await (const event of parseSse(response.body)) {
    if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
    const json = parseJson(event.data, null);
    if (!json) continue;
    const type = json.type || event.event;
    if (hasProviderStreamError(json, event.event) || type === 'response.failed') {
      throw new Error(providerStreamErrorMessage(json, 'Responses API 流式响应失败'));
    }
    if (type === 'response.incomplete') {
      const reason = json.response?.incomplete_details?.reason || json.incomplete_details?.reason;
      throw new Error(reason ? `Responses API 流式响应未完成：${reason}` : 'Responses API 流式响应未完成');
    }
    responseId = json.response?.id || json.id || responseId;
    const outputTextDelta = extractResponsesOutputTextDelta(type, json);
    if (outputTextDelta) thinkingTagFilter.push(outputTextDelta);
    const reasoningDelta = extractResponsesReasoningDelta(type, json);
    if (reasoningDelta) {
      step.reasoning += reasoningDelta;
      await streamEmit.emit('reasoning', { round: step.round, text: reasoningDelta });
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = json.item;
      if (item?.type === 'function_call') {
        const key = item.id || item.call_id || item.item_id;
        if (key) {
          const existing = calls.get(key) || { id: item.id || key, callId: item.call_id || key, name: '', arguments: '' };
          if (item.name) existing.name = item.name;
          if (item.call_id) existing.callId = item.call_id;
          if (item.arguments) existing.arguments = item.arguments;
          calls.set(key, existing);
        }
      }
    }
    if (type === 'response.function_call_arguments.delta') {
      const key = json.item_id || json.call_id || '';
      const existing = calls.get(key) || { id: key, callId: json.call_id || key, name: '', arguments: '' };
      existing.arguments += String(json.delta || '');
      calls.set(key, existing);
    }
    if (type === 'response.function_call_arguments.done') {
      const key = json.item_id || json.call_id || '';
      const existing = calls.get(key) || { id: key, callId: json.call_id || key, name: '', arguments: '' };
      existing.arguments = String(json.arguments || existing.arguments || '{}');
      calls.set(key, existing);
    }
    if (type === 'response.completed') {
      terminalEvent = type;
      responseId = json.response?.id || responseId;
      usage = json.response?.usage || json.usage || usage;
      if (Array.isArray(json.response?.output)) {
        for (const item of json.response.output) {
          if (item?.type !== 'function_call') continue;
          const key = item.id || item.call_id;
          if (!key) continue;
          const existing = calls.get(key) || { id: item.id || key, callId: item.call_id || key, name: '', arguments: '' };
          existing.name = item.name || existing.name;
          existing.callId = item.call_id || existing.callId;
          existing.arguments = item.arguments || existing.arguments;
          calls.set(key, existing);
        }
      }
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  await streamEmit.wait();
  if (!terminalEvent) throw new Error('Responses API 流式响应在 response.completed 前中断');
  const normalizedCalls = [];
  for (const call of calls.values()) {
    if (!call.name) continue;
    normalizedCalls.push({
      ...call,
      arguments: parseJson(call.arguments || '{}', {})
    });
  }
  return {
    calls: normalizedCalls,
    responseId,
    usage,
    response: { id: responseId, output: normalizedCalls.map(call => ({
      type: 'function_call', id: call.id, call_id: call.callId, name: call.name,
      arguments: JSON.stringify(call.arguments)
    })) }
  };
}

function isJsonProviderResponse(response) {
  const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
  return contentType.includes('application/json') || contentType.includes('+json');
}

function convertMessagesForOpenAiResponses(messages = []) {
  const converted = [];
  if (!messages || typeof messages[Symbol.iterator] !== 'function') {
    return converted;
  }
  for (const message of messages) {
    converted.push({
      ...message,
      content: convertContentForOpenAiResponses(message?.content)
    });
  }
  return converted;
}

function convertToolsForOpenAiResponses(tools = []) {
  const converted = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const fn = tool?.function || {};
    if (!fn.name) continue;
    converted.push({
      type: 'function',
      name: fn.name,
      description: fn.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} }
    });
  }
  return converted;
}

function convertToolChoiceForOpenAiResponses(toolChoice) {
  if (!toolChoice || toolChoice === 'auto') return 'auto';
  if (toolChoice === 'none' || toolChoice === 'required') return toolChoice;
  if (typeof toolChoice === 'string') return { type: 'function', name: toolChoice };
  const name = toolChoice?.function?.name || toolChoice?.name;
  return name ? { type: 'function', name } : 'auto';
}

function normalizeOpenAiResponseFunctionCalls(output = []) {
  const calls = [];
  for (const item of Array.isArray(output) ? output : []) {
    if (item?.type !== 'function_call' || !item.name) continue;
    calls.push({
      id: item.id || item.call_id || '',
      callId: item.call_id || item.id || '',
      name: item.name,
      arguments: parseJson(item.arguments || '{}', {}),
      raw: item
    });
  }
  return calls;
}

function buildOpenAiResponseToolResult({ settings, content, reasoning, response, usage, toolCalls, process }) {
  return {
    content,
    reasoning,
    message: response,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, response?.model || settings.model)
  };
}

function convertContentForOpenAiResponses(content) {
  if (!Array.isArray(content)) {
    return content;
  }
  const parts = [];
  for (const item of content) {
    if (item?.type === 'image_url') {
      const imageUrl = item.image_url?.url || item.url || '';
      if (imageUrl) {
        parts.push({ type: 'input_image', image_url: imageUrl });
      }
      continue;
    }
    const text = extractText(item?.text || item?.content || item);
    if (text) {
      parts.push({ type: 'input_text', text });
    }
  }
  return parts.length ? parts : '';
}

function extractOpenAiOutputText(json) {
  if (!Array.isArray(json.output)) {
    return '';
  }

  let text = '';
  for (const item of json.output) {
    const content = item?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      text += contentItem?.text || '';
    }
  }
  return text;
}

function extractOpenAiReasoning(json) {
  let reasoning = '';
  if (Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item?.type !== 'reasoning') {
        continue;
      }
      reasoning = appendReasoning(reasoning, extractText(item.summary || ''));
      reasoning = appendReasoning(reasoning, extractText(item.content || ''));
      reasoning = appendReasoning(
        reasoning,
        extractText(item.text || item.reasoning || item.reasoning_content || '')
      );
    }
  }

  return appendReasoning(reasoning, extractText(json.reasoning || json.response?.reasoning || ''));
}

export function extractResponsesReasoningDelta(type, json = {}) {
  const eventType = String(type || '');
  if (
    eventType === 'response.reasoning_text.delta'
    || eventType === 'response.reasoning_summary_text.delta'
  ) {
    return extractText(json.delta || json.text || json.reasoning || json.reasoning_content || json.summary || json.output_text || '');
  }
  return '';
}

export function extractResponsesOutputTextDelta(type, json = {}) {
  const eventType = String(type || '');
  if (eventType === 'response.output_text.delta' && typeof json.delta === 'string') {
    return json.delta;
  }
  return '';
}

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}

export function buildOpenAiReasoning(settings = {}, options = {}) {
  const hasExplicitLevel = options.thinkingLevel !== undefined && options.thinkingLevel !== null && String(options.thinkingLevel).trim() !== '';
  const extraReasoning = settings.extraBody?.reasoning;
  if (!hasExplicitLevel && extraReasoning && typeof extraReasoning === 'object') {
    return extraReasoning;
  }

  if (hasExplicitLevel) {
    const control = resolveThinkingControl(settings.providerType, settings.model, true);
    const fallback = options.thinkingEnabled === false ? 'off' : control.defaultLevel;
    const level = resolveSupportedThinkingLevel(
      normalizeThinkingLevel(options.thinkingLevel, fallback),
      control,
      fallback
    );
    const effort = mapResponsesEffort(level, settings.providerType);
    if (extraReasoning && typeof extraReasoning === 'object') {
      return { ...extraReasoning, effort };
    }
    if (settings.providerType === 'xai') {
      return { effort };
    }
    return { effort, summary: 'auto' };
  }

  if (settings.providerType === 'xai') {
    return {
      effort: options.thinkingEnabled === false ? 'none' : 'high'
    };
  }
  return {
    effort: options.thinkingEnabled === false ? 'low' : 'medium',
    summary: 'auto'
  };
}

function mapResponsesEffort(level, providerType) {
  if (providerType === 'xai') {
    if (level === 'max' || level === 'xhigh') return 'xhigh';
    if (level === 'off' || level === 'minimal') return 'low';
    return level;
  }
  if (level === 'off') return 'none';
  return level;
}
