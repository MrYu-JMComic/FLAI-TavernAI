import { estimatePromptTokens } from './promptTokenBudget.js';
import {
  buildChatMessageContent,
  normalizeChatAttachments,
  resolveChatAttachmentsForModel,
  validateChatAttachmentsForUpload
} from './chatAttachments.js';

const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARACTERS = 32_000;
const MAX_MESSAGE_CHARACTERS = 12_000;
const MAX_CONTEXT_IMAGES = 4;

// The history stays ahead of the changing card snapshot so an appended turn can
// reuse the instruction/tool prefix and the already-seen conversation prefix.
export function buildCharacterContext({ system, tools = [], history = [], attachments = [], payload = {}, stablePrefix = false, database, userId }) {
  const source = (Array.isArray(history) ? history : []).filter((message) => (
    ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string'
      && (message.content.trim() || (message.role === 'user' && message.attachments?.length))
  ));
  const messages = [];
  const currentAttachments = modelAttachments(attachments, database, userId);
  // Stored model attachments may contain both asset URL and data URL; retain
  // their original asset identity before normalization strips storage fields.
  const imageKeys = new Set((Array.isArray(attachments) ? attachments : []).map(attachmentKey));
  let remainingImages = MAX_CONTEXT_IMAGES - currentAttachments.length;
  let historyImages = 0;
  const totalHistoryImages = source.reduce((total, message) => total + (message.role === 'user' && Array.isArray(message.attachments) ? message.attachments.length : 0), 0);
  let remaining = MAX_HISTORY_CHARACTERS;
  let truncatedMessages = 0;
  const recent = source.slice(-(stablePrefix ? MAX_HISTORY_MESSAGES : 12));
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const limit = Math.min(MAX_MESSAGE_CHARACTERS, stablePrefix ? remaining : MAX_MESSAGE_CHARACTERS);
    if (!limit && message.content) break;
    const content = message.content.slice(0, limit);
    if (content.length < message.content.length) truncatedMessages += 1;
    // Select by metadata before resolving asset bytes. Current input has priority;
    // the remaining image budget belongs to the newest distinct history images.
    const images = [];
    if (message.role === 'user' && Array.isArray(message.attachments)) {
      for (const attachment of message.attachments) {
        if (!remainingImages) break;
        const key = attachmentKey(attachment);
        if (imageKeys.has(key)) continue;
        const resolved = modelAttachments([attachment], database, userId, { strict: false });
        if (!resolved.length) continue;
        imageKeys.add(key);
        images.push(...resolved);
        remainingImages -= resolved.length;
      }
    }
    historyImages += images.length;
    if (!content.trim() && !images.length) continue;
    messages.unshift({ role: message.role, content: buildChatMessageContent(content, images) });
    remaining -= content.length;
  }
  const historyMessages = messages.length;
  const allMessages = [
    { role: 'system', content: system },
    ...messages,
    { role: 'user', content: buildChatMessageContent(JSON.stringify(payload, null, 2), currentAttachments) }
  ];
  const components = [
    component('instructions', '固定助手指令', system),
    { key: 'tools', label: '工具定义', estimatedTokens: estimatePromptTokens([], { tools }).tokens },
    { key: 'history', label: '近期对话', estimatedTokens: historyMessages ? estimatePromptTokens(messages).tokens : 0 },
    component('character', '当前角色卡', payload.currentCharacter),
    component('worldBooks', '世界书工作区', payload.worldBookContext),
    component('request', '本轮要求与执行范围', {
      ...payload, currentCharacter: undefined, worldBookContext: undefined
    }),
    ...(currentAttachments.length ? [{
      key: 'images', label: '本轮参考图片', imageCount: currentAttachments.length,
      estimatedTokens: estimatePromptTokens([{ role: 'user', content: buildChatMessageContent('', currentAttachments) }]).breakdown.imageTokens
    }] : [])
  ];
  return {
    messages: allMessages,
    context: {
      strategy: stablePrefix ? 'stable-prefix-v1' : 'legacy',
      components,
      estimatedTokens: estimatePromptTokens(allMessages, { tools }).tokens,
      estimated: true,
      historyMessages,
      droppedHistoryMessages: source.length - historyMessages,
      truncatedHistoryMessages: truncatedMessages,
      imageCount: currentAttachments.length + historyImages,
      droppedHistoryImages: totalHistoryImages - historyImages,
      limits: { historyMessages: MAX_HISTORY_MESSAGES, historyCharacters: MAX_HISTORY_CHARACTERS, images: MAX_CONTEXT_IMAGES },
      cache: characterContextCache(null)
    }
  };
}

function attachmentKey(attachment) {
  return String(attachment?.url || attachment?.dataUrl || '');
}

function modelAttachments(attachments = [], database, userId, { strict = true } = {}) {
  validateChatAttachmentsForUpload(attachments);
  const normalized = normalizeChatAttachments(attachments);
  const resolved = database && userId
    ? resolveChatAttachmentsForModel(database, userId, normalized)
    : normalized.filter(attachment => attachment.dataUrl);
  if (strict && resolved.length !== normalized.length) throw new Error('参考图片无效或不可访问');
  return resolved;
}

function component(key, label, value) {
  return {
    key,
    label,
    estimatedTokens: value == null ? 0 : estimatePromptTokens([
      { role: 'user', content: typeof value === 'string' ? value : JSON.stringify(value) }
    ]).breakdown.textTokens
  };
}

// These values are facts reported by the provider for its final request. They
// are never inferred from a repeated prompt, a local estimate, or elapsed time.
export function characterContextCache(usage) {
  const cachedTokens = firstTokenNumber(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.prompt_cache_hit_tokens,
    usage?.input_cache_hit_tokens,
    usage?.cache_read_input_tokens,
    usage?.promptTokensDetails?.cachedTokens,
    usage?.promptCacheHitTokens,
    usage?.inputCacheHitTokens
  );
  let inputTokens = firstTokenNumber(usage?.prompt_tokens, usage?.input_tokens, usage?.promptTokens, usage?.inputTokens);
  if (usage?.cache_read_input_tokens != null && inputTokens != null) {
    inputTokens += (firstTokenNumber(usage.cache_read_input_tokens) || 0)
      + (firstTokenNumber(usage.cache_creation_input_tokens) || 0);
  }
  return {
    strategy: 'provider-prefix',
    scope: 'last-provider-request',
    reported: cachedTokens != null,
    cachedTokens,
    inputTokens,
    hitRate: cachedTokens != null && inputTokens > 0 ? Math.min(1, cachedTokens / inputTokens) : null
  };
}

function firstTokenNumber(...values) {
  for (const value of values) {
    if (value == null || value === '' || typeof value === 'boolean') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}
