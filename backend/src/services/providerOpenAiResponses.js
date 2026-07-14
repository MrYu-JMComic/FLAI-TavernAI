import { parseJson } from '../utils/json.js';
import {
  appendReasoning,
  createThinkingTagFilter,
  extractReasoning,
  extractText,
  mergeReasoning,
  splitThinkingTags
} from './providerContent.js';
import { normalizeProviderExtraBody } from './providerExtraBody.js';
import { providerFetch, readJsonResponse, responseErrorText } from './providerHttp.js';
import { normalizeProviderModel } from './providerModels.js';
import { parseSse } from './providerSse.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';

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

    if (type === 'response.output_text.delta' && json.delta) {
      thinkingTagFilter.push(json.delta);
    }

    const reasoningDelta = extractResponsesReasoningDelta(type, json);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      streamEmit.emit('reasoning', { text: reasoningDelta });
    }

    if (type === 'response.completed') {
      usage = json.response?.usage || usage;
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
  const isReasoningEvent = /^response\.(reasoning|reasoning_summary|reasoning_summary_text|reasoning_text|reasoning_content)(\.|$)/.test(String(type || ''));
  if (isReasoningEvent) {
    return extractText(json.delta || json.text || json.reasoning || json.reasoning_content || json.summary || json.output_text || '');
  }
  return extractReasoning(json);
}

export function extractResponsesOutputTextDelta(type, json = {}) {
  const eventType = String(type || '');
  if (/^response\.output_text\.delta$/.test(eventType) && typeof json.delta === 'string') {
    return json.delta;
  }
  if (/^response\.(content|text|message|content_part)\.(added|delta|done)?$/.test(eventType)) {
    return extractText(json.delta || json.text || json.content || json.output_text || json.part || '');
  }
  if (/^response\.output_item\.(added|done)$/.test(eventType)) {
    return extractText(json.item?.content || json.item?.text || json.output_text || '');
  }
  return '';
}

function resolveProviderModel(settings = {}, options = {}) {
  return normalizeProviderModel(settings.providerType, settings.model);
}

function buildOpenAiReasoning(settings = {}, options = {}) {
  if (settings.extraBody?.reasoning && typeof settings.extraBody.reasoning === 'object') {
    return settings.extraBody.reasoning;
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
