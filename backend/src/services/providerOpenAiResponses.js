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
import { normalizeToolCompletionRounds } from './providerNumbers.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';
import {
  hasProviderStreamError,
  providerStreamErrorMessage
} from './providerStreamErrors.js';
import { executeProviderTool } from './providerToolResults.js';
import {
  normalizeThinkingLevel,
  resolveSupportedThinkingLevel,
  resolveThinkingControl
} from '../../../shared/providerThinking.js';

export function usesResponsesApi(settings = {}) {
  return Boolean(settings.supportsReasoning && ['openai', 'xai'].includes(settings.providerType));
}

export async function generateOpenAiResponse(settings, messages, options = {}) {
  const response = await providerFetch(settings, '/responses', {
    method: 'POST',
    body: JSON.stringify({
      ...normalizeProviderExtraBody(settings.extraBody),
      model: resolveProviderModel(settings, options),
      input: convertMessagesForOpenAiResponses(messages),
      reasoning: buildOpenAiReasoning(settings, options),
      stream: false
    }),
    signal: options.signal
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
      ...normalizeProviderExtraBody(settings.extraBody),
      model: resolveProviderModel(settings, options),
      input: convertMessagesForOpenAiResponses(messages),
      reasoning: buildOpenAiReasoning(settings, options),
      stream: true
    }),
    signal
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
        ...normalizeProviderExtraBody(settings.extraBody),
        model: resolveProviderModel(settings, options),
        input,
        reasoning: buildOpenAiReasoning(settings, options),
        tools: responseTools,
        tool_choice: convertToolChoiceForOpenAiResponses(options.toolChoice),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        stream: false
      }),
      signal: options.signal
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
        options.signal
      );
      const result = prepared.result;
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      step.tools.push(log);
      toolCalls.push(log);
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
  const result = await runOpenAiResponseToolCompletion(settings, messages, tools, executeTool, {
    ...options,
    signal
  });
  const streamEmit = createStreamEmitQueue(emit);
  for (const step of result.process || []) {
    await streamEmit.emit('step', step);
    if (step.reasoning) {
      await streamEmit.emit('reasoning', { round: step.round, text: step.reasoning });
    }
    for (const tool of step.tools || []) {
      await streamEmit.emit('tool', { round: step.round, ...tool });
    }
  }
  if (result.content) {
    const finalRound = result.process?.at(-1)?.round || 1;
    await streamEmit.emit('content', { round: finalRound, text: result.content });
  }
  await streamEmit.wait();
  return result;
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
