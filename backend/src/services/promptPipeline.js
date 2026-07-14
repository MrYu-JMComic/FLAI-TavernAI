import { applyRegexRules, getRegexRules } from '../modules/characters.js';
import { normalizeAdvancedSettings, mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { getConversationEconomyState } from '../modules/economy.js';
import { buildModSystemPrompt, getEnabledModsForUser } from '../modules/mods.js';
import { buildNpcBehaviorPrompt } from '../modules/npcs.js';
import { getStatusBar } from '../modules/statusBars.js';
import { buildTalentSystemPrompt } from '../modules/talents.js';
import {
  buildWorldBookContext,
  injectAtDepthEntries,
  matchWorldBookEntries
} from '../modules/worldBooks.js';
import { buildConversationMemoryContext } from '../modules/conversationMemories.js';
import { getAccessorySkillsPayload } from './accessoryAgents.js';
import { buildContextDirectorPrompt } from './chatContextDirector.js';
import { renderPromptVariables, resolvePromptUserName } from './promptVariables.js';
import {
  buildWorldBookContextDiagnostics,
  findWorldBookExplanation
} from './worldBookMatchPreview.js';
import { parseJson } from '../utils/json.js';

export const PROMPT_PIPELINE_HISTORY_LIMIT = 20;
export const PROMPT_PIPELINE_DEFAULT_CONTEXT_BUDGET_CHARS = 32_000;

const WORLD_BOOK_MATCH_SUMMARY_LIMIT = 12;
const TOKEN_CHAR_DIVISOR = 4;
const MIN_CONTEXT_BUDGET_CHARS = 1_000;

export function buildPromptPipeline(database, options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const user = source.user || {};
  const conversation = normalizePipelineConversation(source.conversation);
  const character = source.character || {};
  const userText = String(source.content ?? source.message ?? '').trim();
  const rules = getRegexRules(database, character.ownerId, character.id);
  const macroContext = {
    userName: user.displayName || user.username || '用户',
    charName: character.name || ''
  };
  const processedUserText = applyRegexRules(userText, rules, 'input', macroContext);
  const history = normalizePipelineHistory(source.history);
  const recentTexts = buildRecentTexts(history, processedUserText);
  const statusBar = getStatusBar(database, user.id, conversation.id);
  const accessoryState = getAccessorySkillsPayload(conversation, statusBar);
  const contextBudgetCharacters = normalizeContextBudgetCharacters(
    source.contextBudgetCharacters ?? source.contextBudgetChars ?? source.contextBudget
  );
  const worldBookEntries = matchWorldBookEntries(database, character.id, recentTexts, {
    conversationId: conversation.id,
    // Preview/dry-run callers pass false so sticky/cooldown/delay state stays untouched.
    persistState: source.persistWorldBookState !== false,
    contextSize: Math.ceil(contextBudgetCharacters / TOKEN_CHAR_DIVISOR)
  });
  const worldBookDiagnostics = buildWorldBookContextDiagnostics(database, {
    userId: user.id,
    characterId: character.id,
    conversationId: conversation.id,
    texts: recentTexts,
    matchedEntries: worldBookEntries
  });
  const worldBookContext = buildWorldBookContext(worldBookEntries);
  const memoryContext = buildConversationMemoryContext(database, user.id, conversation.id);
  const modSystemPrompt = buildModSystemPrompt(getEnabledModsForUser(database, user.id, { characterId: character.id }));
  const npcBehaviorPrompt = accessoryState.active.npcAgent ? buildNpcBehaviorPrompt(database, conversation.id) : '';
  const talentPrompt = accessoryState.active.talentPrompt ? buildTalentSystemPrompt(database, character.id) : '';
  const economyContext = accessoryState.active.economyAgent
    ? buildEconomyContext(database, user.id, conversation.id)
    : '';
  const sections = {
    worldBook: {
      entries: summarizeWorldBookMatches(worldBookEntries, worldBookDiagnostics),
      context: worldBookContext,
      diagnostics: worldBookDiagnostics
    },
    memory: {
      context: memoryContext
    },
    mods: {
      context: modSystemPrompt
    },
    npc: {
      active: Boolean(accessoryState.active.npcAgent),
      context: npcBehaviorPrompt
    },
    talent: {
      active: Boolean(accessoryState.active.talentPrompt),
      context: talentPrompt
    },
    economy: {
      active: Boolean(accessoryState.active.economyAgent),
      context: economyContext
    },
    statusBar: {
      active: Boolean(statusBar),
      variables: statusBar?.variables || []
    }
  };
  const rawModelMessages = buildPipelineMessages({
    character,
    user,
    history,
    userText: processedUserText,
    userAttachments: source.userAttachments,
    activePreset: source.activePreset,
    appendUserMessage: source.appendUserMessage !== false,
    continuationPrompt: source.continuationPrompt,
    sections,
    worldBookEntries,
    resolveAttachmentsForModel: source.resolveAttachmentsForModel
  });
  const budgetedPrompt = applyPromptBudget(
    rawModelMessages,
    contextBudgetCharacters
  );
  const modelMessages = budgetedPrompt.messages;

  return {
    conversation,
    character,
    rules,
    statusBar,
    accessoryState,
    input: {
      original: userText,
      processed: processedUserText
    },
    history,
    modelMessages,
    messages: modelMessages,
    sections,
    worldBookEntries,
    worldBookMatches: sections.worldBook.entries,
    priority: buildPriorityExplanation(sections),
    budget: budgetedPrompt.budget,
    diagnostics: {
      messageCount: modelMessages.length,
      historyCount: history.length,
      worldBookMatchCount: worldBookEntries.length,
      memoryEnabled: Boolean(memoryContext),
      imagePartCount: countPromptImages(modelMessages)
    }
  };
}

export function sanitizePromptMessagesForPreview(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const sanitized = [];
  for (const message of source) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const nextMessage = {
      role: message.role,
      content: sanitizePromptContent(message.content)
    };
    if (message.name) {
      nextMessage.name = message.name;
    }
    sanitized.push(nextMessage);
  }
  return sanitized;
}

export function summarizeWorldBookMatches(entries = [], diagnostics = null) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const matches = [];
  for (const entry of sourceEntries) {
    if (!entry?.id) {
      continue;
    }
    const explanation = findWorldBookExplanation(diagnostics, entry.id);
    matches.push({
      id: entry.id,
      name: entry.name || '未命名条目',
      worldBookId: entry.worldBookId || '',
      worldBookName: entry.worldBookName || '未命名世界书',
      position: entry.position || 'before_char',
      depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : 0,
      role: Number.isFinite(Number(entry.role)) ? Number(entry.role) : 0,
      status: explanation?.status || '',
      matchedKeys: Array.isArray(explanation?.matchedKeys) ? explanation.matchedKeys : [],
      alwaysActive: Boolean(explanation?.alwaysActive),
      regexMode: Boolean(explanation?.regexMode),
      selective: Boolean(explanation?.selective),
      selectivePassed: explanation?.selectivePassed !== false,
      useProbability: Boolean(explanation?.useProbability),
      probability: Number(explanation?.probability ?? 100),
      group: explanation?.group || '',
      groupWeight: Number(explanation?.groupWeight || 0),
      groupShare: explanation?.groupShare ?? null,
      groupPreviewWinner: Boolean(explanation?.groupPreviewWinner),
      statefulRules: Array.isArray(explanation?.statefulRules) ? explanation.statefulRules : []
    });
    if (matches.length >= WORLD_BOOK_MATCH_SUMMARY_LIMIT) {
      break;
    }
  }
  return matches;
}

export function estimatePromptBudget(messages = []) {
  let characters = 0;
  let imageParts = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    const estimate = estimatePromptContent(message?.content);
    characters += estimate.characters;
    imageParts += estimate.imageParts;
  }
  return {
    characters,
    imageParts,
    estimatedTokens: Math.ceil(characters / TOKEN_CHAR_DIVISOR),
    method: 'char-divisor-4'
  };
}

export function applyPromptBudget(messages = [], budgetLimit = PROMPT_PIPELINE_DEFAULT_CONTEXT_BUDGET_CHARS) {
  const limitCharacters = normalizeContextBudgetCharacters(budgetLimit);
  const working = clonePromptMessages(messages);
  const truncation = [];
  let currentBudget = estimatePromptBudget(working);

  if (currentBudget.characters <= limitCharacters) {
    return {
      messages: working,
      budget: {
        ...currentBudget,
        limitCharacters,
        truncated: false,
        truncation
      }
    };
  }

  omitHistoryMessagesForBudget(working, limitCharacters, truncation);
  currentBudget = estimatePromptBudget(working);
  if (currentBudget.characters > limitCharacters) {
    trimLargestPromptMessagesForBudget(working, limitCharacters, truncation);
    currentBudget = estimatePromptBudget(working);
  }

  return {
    messages: working,
    budget: {
      ...currentBudget,
      limitCharacters,
      truncated: truncation.length > 0,
      truncation
    }
  };
}

function buildPipelineMessages({
  character,
  user,
  history,
  userText,
  userAttachments = [],
  activePreset = null,
  appendUserMessage = true,
  continuationPrompt = '',
  sections,
  worldBookEntries,
  resolveAttachmentsForModel
}) {
  const promptUserName = resolvePromptUserName(user);
  const renderField = (value) => renderPromptVariables(value, promptUserName);
  const baseSystemPrompt = [
    `你正在扮演角色「${character.name}」。`,
    character.gender ? `性别：${character.gender}` : '',
    character.age ? `年龄：${character.age}` : '',
    character.background ? `背景：${renderField(character.background)}` : '',
    character.worldview ? `世界观：${renderField(character.worldview)}` : '',
    character.persona ? `人设与表达风格：${renderField(character.persona)}` : '',
    sections.worldBook.context ? `\n[世界书补充信息]\n${sections.worldBook.context}` : '',
    sections.memory.context ? `\n${sections.memory.context}` : '',
    sections.mods.context ? `\n[Mod 指令]\n${sections.mods.context}` : '',
    sections.npc.context || '',
    sections.economy.context ? `\n${sections.economy.context}` : '',
    sections.talent.context ? `\n${sections.talent.context}` : '',
    '保持角色一致，用自然中文回复。不要伪造内部思考；如果模型接口返回思考内容，系统会单独展示。'
  ].filter(Boolean).join('\n');
  const contextDirectorPrompt = buildContextDirectorPrompt({
    worldBookContext: sections.worldBook.context,
    worldBookEntries,
    memoryContext: sections.memory.context,
    modSystemPrompt: sections.mods.context,
    npcBehaviorPrompt: sections.npc.context,
    economyContext: sections.economy.context,
    talentPrompt: sections.talent.context
  });
  const messages = [
    { role: 'system', content: baseSystemPrompt },
    { role: 'system', content: contextDirectorPrompt }
  ];
  const presetSystemPrompt = String(activePreset?.systemPrompt || '').trim();
  if (presetSystemPrompt) {
    messages.push({ role: 'system', content: presetSystemPrompt });
  }

  const participantName = normalizeModelName(user.displayName) || normalizeModelName(user.accountName || user.username);
  for (const message of history) {
    if (message.role === 'assistant') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    messages.push(createUserMessage({
      content: message.content,
      attachments: resolvePipelineAttachments(message.attachments, resolveAttachmentsForModel),
      participantName
    }));
  }
  const transientContinuationPrompt = String(continuationPrompt || '').trim();
  if (appendUserMessage) {
    messages.push(createUserMessage({
      content: userText,
      attachments: normalizePipelineImageAttachments(userAttachments),
      participantName
    }));
  } else if (transientContinuationPrompt) {
    messages.push(createUserMessage({
      content: transientContinuationPrompt,
      attachments: [],
      participantName
    }));
  }

  if (worldBookEntries.length) {
    injectAtDepthEntries(messages, worldBookEntries);
  }
  return messages;
}

function normalizeContextBudgetCharacters(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return PROMPT_PIPELINE_DEFAULT_CONTEXT_BUDGET_CHARS;
  }
  return Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.floor(number));
}

function clonePromptMessages(messages = []) {
  const cloned = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    cloned.push({
      ...message,
      content: clonePromptContent(message.content)
    });
  }
  return cloned;
}

function clonePromptContent(content) {
  if (!Array.isArray(content)) {
    return content;
  }
  const cloned = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    cloned.push({
      ...part,
      image_url: part.image_url && typeof part.image_url === 'object'
        ? { ...part.image_url }
        : part.image_url
    });
  }
  return cloned;
}

function omitHistoryMessagesForBudget(messages, limitCharacters, truncation) {
  const protectedMessages = buildBudgetProtectedMessages(messages);
  for (let index = 0; index < messages.length; index += 1) {
    if (estimatePromptBudget(messages).characters <= limitCharacters) {
      return;
    }
    const message = messages[index];
    if (protectedMessages.has(message)) {
      continue;
    }
    const removedCharacters = estimatePromptContent(message?.content).characters;
    truncation.push({
      index,
      role: message?.role || 'unknown',
      reason: 'history_omitted',
      originalCharacters: removedCharacters,
      keptCharacters: 0,
      excerpt: excerptPromptContent(message?.content)
    });
    messages.splice(index, 1);
    index -= 1;
  }
}

function trimLargestPromptMessagesForBudget(messages, limitCharacters, truncation) {
  let safety = 0;
  while (estimatePromptBudget(messages).characters > limitCharacters && safety < messages.length + 4) {
    safety += 1;
    const currentBudget = estimatePromptBudget(messages);
    const overage = currentBudget.characters - limitCharacters;
    const targetIndex = findLargestTrimmableMessageIndex(messages);
    if (targetIndex < 0) {
      return;
    }
    const message = messages[targetIndex];
    const originalCharacters = estimatePromptContent(message.content).characters;
    const keptCharacters = Math.max(200, originalCharacters - overage - 48);
    if (keptCharacters >= originalCharacters) {
      return;
    }
    message.content = truncatePromptContent(message.content, keptCharacters);
    truncation.push({
      index: targetIndex,
      role: message.role || 'unknown',
      reason: 'content_truncated',
      originalCharacters,
      keptCharacters: estimatePromptContent(message.content).characters,
      excerpt: excerptPromptContent(message.content)
    });
  }
}

function buildBudgetProtectedMessages(messages = []) {
  const protectedMessages = new WeakSet();
  let lastUserMessage = null;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'system') {
      protectedMessages.add(messages[index]);
    }
    if (messages[index]?.role === 'user') {
      lastUserMessage = messages[index];
    }
  }
  if (lastUserMessage) {
    protectedMessages.add(lastUserMessage);
  }
  return protectedMessages;
}

function findLargestTrimmableMessageIndex(messages = []) {
  let bestIndex = -1;
  let bestCharacters = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const characters = estimatePromptContent(messages[index]?.content).characters;
    if (characters > bestCharacters && characters > 240) {
      bestIndex = index;
      bestCharacters = characters;
    }
  }
  return bestIndex;
}

function truncatePromptContent(content, targetCharacters) {
  if (!Array.isArray(content)) {
    return truncateText(String(content || ''), targetCharacters);
  }
  let remaining = targetCharacters;
  const nextParts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type !== 'text') {
      nextParts.push(part);
      continue;
    }
    const text = String(part.text || '');
    const nextText = truncateText(text, remaining);
    remaining -= nextText.length;
    nextParts.push({ ...part, text: nextText });
    if (remaining <= 0) {
      break;
    }
  }
  return nextParts;
}

function truncateText(text, targetCharacters) {
  const limit = Math.max(0, Math.floor(Number(targetCharacters) || 0));
  if (text.length <= limit) {
    return text;
  }
  if (limit <= 24) {
    return text.slice(0, limit);
  }
  return `${text.slice(0, limit)}\n[context truncated]`;
}

function excerptPromptContent(content) {
  const text = promptContentPlainText(content).slice(0, 180).trim();
  return text || '[non-text content]';
}

function promptContentPlainText(content) {
  if (!Array.isArray(content)) {
    return String(content || '');
  }
  let text = '';
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'text') {
      text += text ? `\n${String(part.text || '')}` : String(part.text || '');
    } else if (part.type === 'image_url') {
      text += text ? '\n[image]' : '[image]';
    }
  }
  return text;
}

function createUserMessage({ content, attachments, participantName }) {
  return {
    role: 'user',
    content: buildUserMessageContent(content, attachments),
    ...(participantName ? { name: participantName } : {})
  };
}

function buildUserMessageContent(content, attachments = []) {
  const text = String(content || '').trim();
  const normalizedAttachments = normalizePipelineImageAttachments(attachments);
  if (!normalizedAttachments.length) {
    return text;
  }

  const parts = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  for (const attachment of normalizedAttachments) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: attachment.dataUrl || attachment.url
      }
    });
  }
  return parts;
}

function resolvePipelineAttachments(attachments = [], resolver) {
  const normalized = normalizePipelineImageAttachments(attachments);
  if (typeof resolver !== 'function') {
    return normalized;
  }
  const resolved = resolver(normalized);
  return normalizePipelineImageAttachments(resolved);
}

function normalizePipelineImageAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const normalized = [];
  for (const attachment of source) {
    const dataUrl = String(attachment?.dataUrl || '').trim();
    const url = String(attachment?.url || '').trim();
    if (!dataUrl && !url) {
      continue;
    }
    normalized.push({
      type: 'image',
      dataUrl,
      url,
      mimeType: String(attachment.mimeType || '').trim(),
      name: String(attachment.name || '').trim(),
      alt: String(attachment.alt || attachment.name || '').trim(),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0
    });
  }
  return normalized;
}

function normalizePipelineHistory(history = []) {
  const source = Array.isArray(history) ? history : [];
  const normalized = [];
  for (const message of source) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    if (message.role === 'assistant' && !String(message.content || '').trim() && !String(message.reasoning || '').trim()) {
      continue;
    }
    normalized.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content || ''),
      attachments: Array.isArray(message.attachments)
        ? message.attachments
        : parseJson(message.attachments_json, [])
    });
  }
  return normalized;
}

function buildRecentTexts(history, processedUserText) {
  const texts = [];
  for (const message of history) {
    texts.push(message.content);
  }
  if (processedUserText) {
    texts.push(processedUserText);
  }
  return texts;
}

function normalizePipelineConversation(conversation = {}) {
  const source = conversation && typeof conversation === 'object' ? conversation : {};
  const authorSettings = normalizeAdvancedSettings(source.authorSettings || {});
  const userSettings = normalizeAdvancedSettings(source.userSettings || {});
  return {
    ...source,
    authorSettings,
    userSettings,
    settings: source.settings || mergeAdvancedSettings(authorSettings, userSettings)
  };
}

function buildEconomyContext(database, userId, conversationId) {
  const state = getConversationEconomyState(database, userId, conversationId, { ensureDefaultAccount: false });
  if (!state?.accounts?.length) {
    return '';
  }
  let text = '[Economy state]\n';
  for (const account of state.accounts) {
    text += `- ${account.currencyType}: ${account.balance}\n`;
  }
  return text.trimEnd();
}

function buildPriorityExplanation(sections) {
  const activeContext = [];
  if (sections.worldBook.entries.length) {
    activeContext.push('world_book');
  }
  if (sections.memory.context) {
    activeContext.push('long_term_memory');
  }
  if (sections.npc.context) {
    activeContext.push('npc');
  }
  if (sections.economy.context) {
    activeContext.push('economy');
  }
  if (sections.talent.context) {
    activeContext.push('talent');
  }
  if (sections.mods.context) {
    activeContext.push('mods');
  }
  return {
    order: [
      'explicit_user_instruction',
      'character_card',
      'world_book',
      'long_term_memory',
      'npc_status_economy_talent',
      'recent_conversation',
      'mods'
    ],
    activeContext
  };
}

function sanitizePromptContent(content) {
  if (!Array.isArray(content)) {
    return content;
  }
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'image_url') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: redactDataUrl(part.image_url?.url)
        }
      });
    } else if (part.type === 'text') {
      parts.push({ type: 'text', text: String(part.text || '') });
    }
  }
  return parts;
}

function redactDataUrl(value) {
  const text = String(value || '').trim();
  const match = /^(data:image\/(?:png|jpeg|webp);base64,)/i.exec(text);
  return match ? `${match[1]}[redacted]` : text;
}

function estimatePromptContent(content) {
  if (!Array.isArray(content)) {
    return {
      characters: String(content || '').length,
      imageParts: 0
    };
  }
  let characters = 0;
  let imageParts = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'text') {
      characters += String(part.text || '').length;
    } else if (part.type === 'image_url') {
      imageParts += 1;
      characters += 64;
    }
  }
  return { characters, imageParts };
}

function countPromptImages(messages = []) {
  let count = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    count += estimatePromptContent(message?.content).imageParts;
  }
  return count;
}

function normalizeModelName(value) {
  const name = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : '';
}
