import { parseJson } from '../utils/json.js';
import {
  collectChatCompletionStreamPayloads,
  collectRawToolCalls,
  extractChatMessage,
  extractStreamingContentDelta,
  extractStreamingDelta,
  extractStreamingReasoningDelta,
  extractStreamingUsage,
  isJsonResponse,
  normalizeStreamingToolCalls,
  normalizeToolCalls
} from './providerChatCompletions.js';
import {
  runAnthropicToolCompletion,
  streamAnthropicToolCompletion
} from './providerAnthropic.js';
import {
  createThinkingTagFilter,
  extractReasoning,
  extractText,
  mergeReasoning,
  splitThinkingTags
} from './providerContent.js';
import {
  providerFetch,
  readJsonResponse,
  readJsonResponseValue,
  responseErrorText
} from './providerHttp.js';
import { cloneProviderMessages } from './providerMessages.js';
import { streamMockCompletion } from './providerMock.js';
import { normalizeProviderModel } from './providerModels.js';
import { normalizeToolCompletionRounds } from './providerNumbers.js';
import { hasUsableProvider } from './providerReadiness.js';
import { buildProviderBody } from './providerRequestBody.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';

export async function runToolCompletion(settings, messages, tools, executeTool, options = {}) {
  options = options ?? {};
  if (!hasUsableProvider(settings)) {
    throw new Error('请先在用户页保存 API Key / SK，并确认网关和模型可用。');
  }

  if (settings.providerType === 'anthropic') {
    return runAnthropicToolCompletion(settings, messages, tools, executeTool, options);
  }

  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const nextMessages = cloneProviderMessages(messages);
  const toolCalls = [];
  const process = [];
  let finalMessage = null;
  let usage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await providerFetch(settings, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(
        buildProviderBody(settings, nextMessages, false, {
          ...options,
          tools,
          toolChoice: options.toolChoice || 'auto',
          thinkingEnabled: options.thinkingEnabled ?? false
        })
      ),
      signal: options.signal
    });
    const json = await readJsonResponse(response);
    usage = json.usage || usage;
    const message = extractChatMessage(json);
    finalMessage = message;
    const calls = normalizeToolCalls(message.tool_calls);
    const parsedContent = splitThinkingTags(extractText(message.content));
    const step = {
      round: round + 1,
      content: parsedContent.content,
      reasoning: mergeReasoning(extractReasoning(message), parsedContent.reasoning),
      tools: []
    };
    process.push(step);

    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        nextMessages.push({ role: 'assistant', content: step.content || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      break;
    }

    nextMessages.push({
      role: 'assistant',
      content: message.content || null,
      tool_calls: collectRawToolCalls(calls)
    });

    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments, call);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      step.tools.push(log);
      toolCalls.push(log);
      nextMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
      if (result?.stop === true) {
        return {
          content: step.content,
          reasoning: step.reasoning,
          message,
          usage,
          toolCalls,
          process
        };
      }
    }
  }

  const finalParsedContent = splitThinkingTags(extractText(finalMessage?.content));
  return {
    content: finalParsedContent.content,
    reasoning: mergeReasoning(extractReasoning(finalMessage || {}), finalParsedContent.reasoning),
    message: finalMessage,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}

export async function streamToolCompletion(settings, messages, tools, executeTool, emit, signal, options = {}) {
  options = options ?? {};
  const streamEmit = createStreamEmitQueue(emit);
  if (!hasUsableProvider(settings)) {
    const result = await streamMockCompletion(messages, streamEmit.emit, settings);
    await streamEmit.wait();
    return result;
  }

  if (settings.providerType === 'anthropic') {
    return streamAnthropicToolCompletion(settings, messages, tools, executeTool, emit, signal, options);
  }

  const maxRounds = normalizeToolCompletionRounds(options.maxRounds);
  const nextMessages = cloneProviderMessages(messages);
  const toolCalls = [];
  const process = [];
  let finalContent = '';
  let finalReasoning = '';
  let usage = null;

  for (let round = 0; round < maxRounds; round += 1) {
    const step = {
      round: round + 1,
      content: '',
      reasoning: '',
      tools: []
    };
    process.push(step);
    await streamEmit.emit('step', step);

    const response = await providerFetch(settings, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(
        buildProviderBody(settings, nextMessages, true, {
          ...options,
          tools,
          toolChoice: options.toolChoice || 'auto',
          thinkingEnabled: options.thinkingEnabled ?? false
        })
      ),
      signal
    });

    if (!response.ok) {
      throw new Error(await responseErrorText(response));
    }

    let roundContent = '';
    const pendingToolCalls = new Map();
    const consumeToolPayload = (payload, event = {}) => {
      usage = extractStreamingUsage(payload, usage);
      const delta = extractStreamingDelta(payload);
      const reasoningDelta = extractStreamingReasoningDelta(payload, delta);
      const contentDelta = extractStreamingContentDelta(payload, delta, event);
      if (reasoningDelta) {
        finalReasoning += reasoningDelta;
        step.reasoning += reasoningDelta;
        streamEmit.emit('reasoning', { round: step.round, text: reasoningDelta });
      }
      if (contentDelta) {
        thinkingTagFilter.push(contentDelta);
      }

      const deltaToolCalls = normalizeStreamingToolCalls(delta.tool_calls);
      for (const call of deltaToolCalls) {
        const existing = pendingToolCalls.get(call.index) || {
          id: call.id,
          name: '',
          arguments: ''
        };
        if (call.id) existing.id = call.id;
        if (call.name) existing.name = call.name;
        if (call.arguments) existing.arguments += call.arguments;
        pendingToolCalls.set(call.index, existing);
      }
    };
    const thinkingTagFilter = createThinkingTagFilter({
      onContent(text) {
        roundContent += text;
        finalContent += text;
        step.content += text;
        streamEmit.emit('content', { round: step.round, text });
      },
      onReasoning(text) {
        finalReasoning += text;
        step.reasoning += text;
        streamEmit.emit('reasoning', { round: step.round, text });
      }
    });

    if (isJsonResponse(response)) {
      const json = await readJsonResponseValue(response, { allowArray: true });
      for (const payload of collectChatCompletionStreamPayloads(json)) {
        consumeToolPayload(payload);
        await streamEmit.wait();
      }
    } else {
      for await (const event of parseSse(response.body)) {
        if (event.data === '[DONE]') {
          break;
        }

        const json = parseJson(event.data, null);
        if (!json) {
          continue;
        }

        for (const payload of collectChatCompletionStreamPayloads(json)) {
          consumeToolPayload(payload, event);
        }
        await streamEmit.wait();
      }
    }
    thinkingTagFilter.flush();
    await streamEmit.wait();

    const calls = [];
    let callIndex = 0;
    for (const call of pendingToolCalls.values()) {
      if (!call.name) {
        continue;
      }
      const id = call.id || `tool-call-${round}-${callIndex}`;
      calls.push({
        id,
        name: call.name,
        arguments: parseJson(call.arguments || '{}', {}),
        raw: {
          id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.arguments || '{}'
          }
        }
      });
      callIndex += 1;
    }

    if (!calls.length) {
      const nudge = typeof options.onNoToolCall === 'function'
        ? options.onNoToolCall({ round: round + 1, content: step.content, process, toolCalls })
        : '';
      if (nudge && round + 1 < maxRounds) {
        await streamEmit.emit('nudge', { round: step.round, text: String(nudge) });
        nextMessages.push({ role: 'assistant', content: roundContent || '' });
        nextMessages.push({ role: 'user', content: String(nudge) });
        continue;
      }
      return {
        content: finalContent,
        reasoning: finalReasoning,
        usage,
        toolCalls,
        process,
        provider: settings.gatewayName,
        providerType: settings.providerType,
        model: normalizeProviderModel(settings.providerType, settings.model)
      };
    }

    nextMessages.push({
      role: 'assistant',
      content: roundContent || null,
      tool_calls: collectRawToolCalls(calls)
    });

    for (const call of calls) {
      const result = await executeTool(call.name, call.arguments, call);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result
      };
      toolCalls.push(log);
      step.tools.push(log);
      await streamEmit.emit('tool', { round: step.round, ...log });
      nextMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result)
      });
    }
  }

  return {
    content: finalContent,
    reasoning: finalReasoning,
    usage,
    toolCalls,
    process,
    provider: settings.gatewayName,
    providerType: settings.providerType,
    model: normalizeProviderModel(settings.providerType, settings.model)
  };
}
