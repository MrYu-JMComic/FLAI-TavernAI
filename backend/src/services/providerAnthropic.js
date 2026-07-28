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
import { executeProviderTool } from './providerToolResults.js';

export async function generateAnthropicMessage(settings, messages, options = {}) {
  const requestBody = buildAnthropicBody(settings, messages, false, options);
  const response = await providerFetch(settings, '/messages', {
    method: 'POST',
    body: JSON.stringify(requestBody),
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
    signal
  });

  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }

  let content = '';
  let reasoning = '';
  let usage = null;
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

    if (json.type === 'content_block_delta') {
      const delta = json.delta || {};
      if (delta.type === 'text_delta' && delta.text) {
        thinkingTagFilter.push(delta.text);
      }
      if ((delta.type === 'thinking_delta' || delta.type === 'signature_delta') && delta.thinking) {
        reasoning += delta.thinking;
        streamEmit.emit('reasoning', { text: delta.thinking });
      }
      if (delta.type === 'input_json_delta' && delta.partial_json) {
        thinkingTagFilter.push(delta.partial_json);
      }
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
      break;
    }
    await streamEmit.wait();
  }
  thinkingTagFilter.flush();
  await streamEmit.wait();

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
  const extraBody = normalizeProviderExtraBody(settings.extraBody);
  const maxTokens = firstPositiveProviderNumber(
    [options.maxTokens, extraBody.max_tokens, extraBody.maxTokens],
    4096
  );
  const body = {
    ...extraBody,
    model: normalizeProviderModel(settings.providerType, settings.model),
    messages,
    stream,
    max_tokens: maxTokens
  };

  if (system) {
    body.system = system;
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
      toolChoice: options.toolChoice || 'auto',
      thinkingEnabled: options.thinkingEnabled ?? false
    });
    const response = await providerFetch(settings, '/messages', {
      method: 'POST',
      body: JSON.stringify(body),
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
    process.push(step);
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
  const result = await runAnthropicToolCompletion(settings, messages, tools, executeTool, {
    ...options,
    signal
  });
  const streamEmit = createStreamEmitQueue(emit);

  for (const step of result.process || []) {
    await streamEmit.emit('step', step);
    if (step.reasoning) {
      await streamEmit.emit('reasoning', { round: step.round, text: step.reasoning });
    }
    if (step.content) {
      await streamEmit.emit('content', { round: step.round, text: step.content });
    }
    for (const tool of step.tools || []) {
      await streamEmit.emit('tool', { round: step.round, ...tool });
    }
  }
  await streamEmit.wait();

  return result;
}

function applyAnthropicThinkingSwitch(body, settings = {}, options = {}) {
  if (!settings.supportsReasoning) {
    return;
  }
  if (options.thinkingEnabled === false) {
    delete body.thinking;
    return;
  }

  if (body.thinking && typeof body.thinking === 'object') {
    return;
  }

  if (usesAnthropicAdaptiveThinking(body.model)) {
    body.thinking = {
      type: 'adaptive',
      display: 'summarized'
    };
    body.output_config = {
      ...(body.output_config || {}),
      effort: body.output_config?.effort || 'high'
    };
    return;
  }

  const budgetTokens = Math.max(1024, Math.min(8192, Number(body.max_tokens) - 1024 || 2048));
  body.thinking = {
    type: 'enabled',
    budget_tokens: budgetTokens,
    display: 'summarized'
  };
  if (Number(body.max_tokens) <= budgetTokens) {
    body.max_tokens = budgetTokens + 1024;
  }
}

function usesAnthropicAdaptiveThinking(model) {
  const value = String(model || '').toLowerCase();
  return value.includes('claude-opus-4-7') ||
    value.includes('claude-opus-4-8') ||
    value.includes('claude-sonnet-4-6') ||
    value.includes('claude-opus-4-6') ||
    value.includes('claude-mythos');
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
  if (!toolChoice || toolChoice === 'auto') {
    return { type: 'auto' };
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
      arguments: item.input && typeof item.input === 'object' ? item.input : parseJson(item.input || '{}', {})
    });
  }
  return toolUses;
}

function newIdForToolUse(name) {
  return `tool-use-${String(name || 'call').replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}`;
}
