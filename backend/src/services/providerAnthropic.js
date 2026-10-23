import { parseJson } from '../utils/json.js';
import {
  createThinkingTagFilter,
  extractReasoningBlocks,
  extractText,
  mergeReasoning,
  splitThinkingTags
} from './providerContent.js';
import { normalizeProviderExtraBody } from './providerExtraBody.js';
import { providerFetch, readJsonResponse, responseErrorText } from './providerHttp.js';
import { cloneProviderMessages } from './providerMessages.js';
import { normalizeProviderModel } from './providerModels.js';
import {
  assignFiniteProviderNumber,
  firstPositiveProviderNumber,
  normalizeToolCompletionRounds
} from './providerNumbers.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';
import {
  hasProviderStreamError,
  providerStreamErrorMessage
} from './providerStreamErrors.js';
import { executeProviderTool } from './providerToolResults.js';
import { applyAnthropicThinkingSwitch } from './providerAnthropicThinking.js';
import { resolveToolChoice } from './providerToolChoice.js';
import { appendProcessContent, appendProcessTool } from './providerProcessActivity.js';

// Anthropic requires max_tokens on every request, so both branches below must
// produce a number. The two cases want opposite defaults: unlimited output asks
// for as much as the API will give, while a missing or invalid value falls back
// to a conservative cap rather than silently requesting a huge completion.
const UNLIMITED_OUTPUT_MAX_TOKENS = 128_000;
const INVALID_MAX_TOKENS_FALLBACK = 4_096;

export async function generateAnthropicMessage(settings, messages, options = {}) {
  const requestBody = buildAnthropicBody(settings, messages, false, options);
  const response = await providerFetch(settings, '/messages', {
    method: 'POST',
    body: JSON.stringify(requestBody),
    requestTrace: options.requestTrace,
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });

  const json = await readJsonResponse(response);
  const parsedContent = splitThinkingTags(extractText(json.content));
  const reasoning = mergeReasoning(extractReasoningBlocks(json.content), parsedContent.reasoning);
  return {
    content: parsedContent.content,
    reasoning,
    usage: json.usage || null,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, json.model || settings.model)
  };
}

export async function streamAnthropicMessage(settings, messages, emit, signal, options = {}) {
  const requestBody = buildAnthropicBody(settings, messages, true, options);
  const response = await providerFetch(settings, '/messages', {
    method: 'POST',
    body: JSON.stringify(requestBody),
    requestTrace: options.requestTrace,
    timeoutMs: options.timeoutMs,
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;
  let sawMessageStop = false;
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
    if (!json) {
      continue;
    }
    if (hasProviderStreamError(json, event.event)) {
      throw new Error(providerStreamErrorMessage(json, 'Anthropic 流式响应失败'));
    }

    if (json.type === 'content_block_delta') {
      const delta = json.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        thinkingTagFilter.push(delta.text);
      }
      if (delta.type === 'thinking_delta' && delta.thinking) {
        reasoning += delta.thinking;
        streamEmit.emit('reasoning', { text: delta.thinking });
      }
      // input_json_delta is tool input, not assistant-visible text.
    }

    if (json.type === 'message_start' && json.message?.usage) {
      usage = {
        ...json.message.usage,
        ...(usage || {})
      };
    }
    if (json.type === 'message_delta' && json.usage) {
      usage = {
        ...(usage || {}),
        ...json.usage
      };
    }
    if (json.type === 'message_stop') {
      sawMessageStop = true;
      break;
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  await streamEmit.wait();
  if (!sawMessageStop) {
    throw new Error('Anthropic 流式响应在 message_stop 前中断');
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

export function buildAnthropicBody(settings, messages, stream, options = {}) {
  const converted = convertMessagesForAnthropic(messages);
  return buildAnthropicRequestBody(settings, converted.system, converted.messages, stream, options);
}

function buildAnthropicRequestBody(settings, system, messages, stream, options = {}) {
  options = options ?? {};
  const extraBody = sanitizeAnthropicExtraBody(settings.extraBody, options);
  const maxTokens = options.unlimitedOutput
    ? firstPositiveProviderNumber(
      [extraBody.max_tokens, extraBody.maxTokens],
      UNLIMITED_OUTPUT_MAX_TOKENS
    )
    : firstPositiveProviderNumber(
      [options.maxTokens, extraBody.max_tokens, extraBody.maxTokens],
      INVALID_MAX_TOKENS_FALLBACK
    );
  const body = {
    ...extraBody,
    model: normalizeProviderModel(settings.providerType, settings.model),
    messages,
    stream,
    max_tokens: maxTokens
  };

  if (system) {
    body.system = options.cacheAssistantPrefix === true
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;
  }
  assignFiniteProviderNumber(body, 'temperature', options.temperature);
  assignFiniteProviderNumber(body, 'top_p', options.topP);
  const anthropicTools = convertToolsForAnthropic(options.tools);
  if (anthropicTools.length) {
    body.tools = anthropicTools;
    body.tool_choice = convertToolChoiceForAnthropic(options.toolChoice);
  }

  applyAnthropicThinkingSwitch(body, settings, options);
  return body;
}

function sanitizeAnthropicExtraBody(value, options = {}) {
  const extraBody = normalizeProviderExtraBody(value);
  if (!options.unlimitedOutput) return extraBody;
  const sanitized = { ...extraBody };
  delete sanitized.max_tokens;
  delete sanitized.max_output_tokens;
  delete sanitized.max_completion_tokens;
  delete sanitized.maxTokens;
  delete sanitized.maxOutputTokens;
  delete sanitized.maxCompletionTokens;
  return sanitized;
}

export async function runAnthropicToolCompletion(settings, messages, tools, executeTool, options = {}) {
  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const converted = convertMessagesForAnthropic(messages);
  const nextMessages = cloneProviderMessages(converted.messages);
  const toolCalls = [];
  const process = [];
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;
  let finalMessage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const body = buildAnthropicRequestBody(settings, converted.system, nextMessages, false, {
      ...options,
      tools,
      toolChoice: resolveToolChoice(options.toolChoice, { round: round + 1, process, toolCalls }),
      thinkingEnabled: options.thinkingEnabled ?? false
    });
    const response = await providerFetch(settings, '/messages', {
      method: 'POST',
      body: JSON.stringify(body),
      requestTrace: options.requestTrace,
      timeoutMs: options.timeoutMs,
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    finalMessage = json;
    usage = json.usage || usage;

    const parsedContent = splitThinkingTags(extractText(json.content));
    const reasoning = mergeReasoning(extractReasoningBlocks(json.content), parsedContent.reasoning);
    const step = {
      round: round + 1,
      content: parsedContent.content,
      reasoning,
      tools: []
    };
    appendProcessContent(step, step.content);
    process.push(step);
    if (typeof options.onStep === 'function') await options.onStep(step);
    finalContent += parsedContent.content;
    finalReasoning = mergeReasoning(finalReasoning, reasoning);

    const calls = normalizeAnthropicToolUses(json.content);
    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        nextMessages.push({ role: 'assistant', content: json.content || step.content || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      break;
    }

    nextMessages.push({
      role: 'assistant',
      content: json.content || []
    });

    const toolResults = [];
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
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: prepared.content
      });
      if (prepared.stop) {
        return {
          content: finalContent,
          reasoning: finalReasoning,
          message: finalMessage,
          usage,
          toolCalls,
          process,
          provider: settings.gatewayName,
          providerType: settings.providerType,
          model: normalizeProviderModel(settings.providerType, settings.model)
        };
      }
    }

    nextMessages.push({
      role: 'user',
      content: toolResults
    });
  }

  return {
    content: finalContent,
    reasoning: finalReasoning,
    message: finalMessage,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamAnthropicToolCompletion(settings, messages, tools, executeTool, emit, signal, options = {}) {
  const streamEmit = createStreamEmitQueue(emit);
  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const converted = convertMessagesForAnthropic(messages);
  const nextMessages = cloneProviderMessages(converted.messages);
  const toolCalls = [];
  const process = [];
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;
  let finalMessage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const step = { round: round + 1, content: '', reasoning: '', tools: [] };
    process.push(step);
    if (typeof options.onStep === 'function') {
      await options.onStep(step);
    } else {
      await streamEmit.emit('step', step);
    }

    const body = buildAnthropicRequestBody(settings, converted.system, nextMessages, true, {
      ...options,
      tools,
      toolChoice: resolveToolChoice(options.toolChoice, { round: round + 1, process, toolCalls }),
      thinkingEnabled: options.thinkingEnabled ?? false
    });
    const response = await providerFetch(settings, '/messages', {
      method: 'POST',
      body: JSON.stringify(body),
      requestTrace: options.requestTrace,
      timeoutMs: options.timeoutMs,
      signal
    });
    if (!response.ok) {
      throw new Error(await responseErrorText(response));
    }

    const streamed = await streamAnthropicToolRound(response, step, streamEmit, signal);
    usage = streamed.usage || usage;
    finalMessage = streamed.message;
    finalContent = streamed.content;
    finalReasoning = mergeReasoning(finalReasoning, streamed.reasoning);
    const calls = normalizeAnthropicToolUses(streamed.contentBlocks);

    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        await streamEmit.emit('nudge', { round: step.round, text: String(nudge) });
        nextMessages.push({ role: 'assistant', content: streamed.contentBlocks || step.content || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      await streamEmit.wait();
      return {
        content: finalContent,
        reasoning: finalReasoning,
        message: finalMessage,
        usage,
        toolCalls,
        process,
        provider: settings.gatewayName,
        providerType: settings.providerType,
        model: normalizeProviderModel(settings.providerType, settings.model)
      };
    }

    nextMessages.push({ role: 'assistant', content: streamed.contentBlocks });
    const toolResults = [];
    for (const call of calls) {
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
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: prepared.content
      });
      if (prepared.stop) {
        await streamEmit.wait();
        return {
          content: finalContent,
          reasoning: finalReasoning,
          message: finalMessage,
          usage,
          toolCalls,
          process,
          provider: settings.gatewayName,
          providerType: settings.providerType,
          model: normalizeProviderModel(settings.providerType, settings.model)
        };
      }
    }
    nextMessages.push({ role: 'user', content: toolResults });
  }

  await streamEmit.wait();
  const result = {
    content: finalContent,
    reasoning: finalReasoning,
    message: finalMessage,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
  return result;
}

async function streamAnthropicToolRound(response, step, streamEmit, signal) {
  if (isJsonProviderResponse(response)) {
    const json = await readJsonResponse(response);
    const parsedContent = splitThinkingTags(extractText(json.content));
    const reasoning = mergeReasoning(extractReasoningBlocks(json.content), parsedContent.reasoning);
    step.content = parsedContent.content;
    step.reasoning = reasoning;
    appendProcessContent(step, step.content);
    if (step.reasoning) await streamEmit.emit('reasoning', { round: step.round, text: step.reasoning });
    if (step.content) await streamEmit.emit('content', { round: step.round, text: step.content });
    await streamEmit.wait();
    return {
      content: step.content,
      reasoning: step.reasoning,
      usage: json.usage || null,
      contentBlocks: Array.isArray(json.content) ? json.content : [],
      message: json
    };
  }
  let usage = null;
  let sawMessageStop = false;
  const blocks = new Map();
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
    if (hasProviderStreamError(json, event.event)) {
      throw new Error(providerStreamErrorMessage(json, 'Anthropic 流式响应失败'));
    }
    if (json.type === 'message_start' && json.message?.usage) {
      usage = { ...json.message.usage, ...(usage || {}) };
    }
    if (json.type === 'content_block_start') {
      const source = json.content_block && typeof json.content_block === 'object'
        ? { ...json.content_block }
        : { type: 'text', text: '' };
      if (source.type === 'tool_use') {
        source.input = source.input && typeof source.input === 'object' ? { ...source.input } : {};
        source._inputJson = '';
      } else if (source.type === 'text') {
        source.text = String(source.text || '');
      } else if (source.type === 'thinking') {
        source.thinking = String(source.thinking || '');
      }
      const sourceIndex = Number(json.index);
      blocks.set(Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : blocks.size, source);
    }
    if (json.type === 'content_block_delta') {
      const index = Number(json.index);
      const block = blocks.get(index) || { type: json.delta?.type === 'input_json_delta' ? 'tool_use' : 'text' };
      const delta = json.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        block.text = `${block.text || ''}${delta.text}`;
        thinkingTagFilter.push(delta.text);
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        block.thinking = `${block.thinking || ''}${delta.thinking}`;
        step.reasoning += delta.thinking;
        await streamEmit.emit('reasoning', { round: step.round, text: delta.thinking });
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        block.type = 'tool_use';
        block._inputJson = `${block._inputJson || ''}${delta.partial_json}`;
      } else if (delta.type === 'signature_delta' && delta.signature) {
        block.signature = `${block.signature || ''}${delta.signature}`;
      }
      blocks.set(index, block);
    }
    if (json.type === 'message_delta' && json.usage) {
      usage = { ...(usage || {}), ...json.usage };
    }
    if (json.type === 'message_stop') {
      sawMessageStop = true;
      break;
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  for (const block of blocks.values()) {
    if (block.type !== 'tool_use') continue;
    if (block._inputJson) block.input = parseJson(block._inputJson, block.input || {});
    delete block._inputJson;
  }
  await streamEmit.wait();
  if (!sawMessageStop) throw new Error('Anthropic 流式响应在 message_stop 前中断');
  const contentBlocks = [...blocks.values()];
  return {
    content: step.content,
    reasoning: step.reasoning,
    usage,
    contentBlocks,
    message: { role: 'assistant', content: contentBlocks }
  };
}

function isJsonProviderResponse(response) {
  const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
  return contentType.includes('application/json') || contentType.includes('+json');
}

function convertMessagesForAnthropic(messages = []) {
  messages = messages && typeof messages[Symbol.iterator] === 'function' ? messages : [];
  const system = [];
  const converted = [];

  for (const message of messages) {
    const role = message?.role;
    const content = convertContentForAnthropic(message?.content);
    if (!hasMessageContent(content)) {
      continue;
    }
    if (role === 'system') {
      system.push(extractText(content));
      continue;
    }
    if (role === 'user' || role === 'assistant') {
      converted.push({ role, content });
    }
  }

  return {
    system: system.join('\n\n'),
    messages: converted.length ? converted : [{ role: 'user', content: '' }]
  };
}

function convertContentForAnthropic(content) {
  if (!Array.isArray(content)) {
    return extractText(content);
  }
  const parts = [];
  for (const item of content) {
    if (item?.type === 'image_url') {
      const source = dataUrlToAnthropicSource(item.image_url?.url || item.url || '');
      if (source) {
        parts.push({ type: 'image', source });
      }
      continue;
    }
    const text = extractText(item?.text || item?.content || item);
    if (text) {
      parts.push({ type: 'text', text });
    }
  }
  return parts.length ? parts : '';
}

function dataUrlToAnthropicSource(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  return {
    type: 'base64',
    media_type: match[1].toLowerCase(),
    data: match[2]
  };
}

function hasMessageContent(content) {
  return Boolean(Array.isArray(content) ? content.length : String(content || '').trim());
}

function convertToolsForAnthropic(tools = []) {
  if (!Array.isArray(tools)) {
    return [];
  }

  const converted = [];
  for (const tool of tools) {
    const fn = tool?.function || {};
    const name = fn.name || tool?.name;
    if (!name) {
      continue;
    }
    converted.push({
      name,
      description: fn.description || tool?.description || '',
      input_schema: fn.parameters || tool?.input_schema || {
        type: 'object',
        properties: {}
      }
    });
  }
  return converted;
}

function convertToolChoiceForAnthropic(toolChoice) {
  const objectType = toolChoice && typeof toolChoice === 'object'
    ? String(toolChoice.type || '').trim().toLowerCase()
    : '';
  if (objectType === 'required' || objectType === 'any') {
    return { type: 'any' };
  }
  if (objectType === 'none') {
    return { type: 'none' };
  }
  if (objectType === 'auto') {
    return { type: 'auto' };
  }
  if (!toolChoice || toolChoice === 'auto') {
    return { type: 'auto' };
  }
  if (toolChoice === 'required' || toolChoice === 'any') {
    return { type: 'any' };
  }
  if (toolChoice === 'none') {
    return { type: 'none' };
  }
  if (typeof toolChoice === 'string') {
    return { type: 'tool', name: toolChoice };
  }
  const name = toolChoice?.function?.name || toolChoice?.name;
  return name ? { type: 'tool', name } : { type: 'auto' };
}

function normalizeAnthropicToolUses(content = []) {
  if (!Array.isArray(content)) {
    return [];
  }

  const toolUses = [];
  for (const item of content) {
    if (item?.type !== 'tool_use' || !item.name) {
      continue;
    }
    toolUses.push({
      id: item.id || newIdForToolUse(item.name),
      name: item.name,
      arguments: item.input && typeof item.input === 'object' ? item.input : parseJson(item.input || '{}', {}),
      raw: item
    });
  }
  return toolUses;
}

function newIdForToolUse(name) {
  return `tool-use-${String(name || 'call').replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}`;
}
