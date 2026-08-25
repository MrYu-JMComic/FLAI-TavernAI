import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import { getDefaultPreset, getPreset } from '../modules/presets.js';
import { getStatusBar } from '../modules/statusBars.js';
import { runAccessoryAgents } from '../services/accessoryAgents.js';
import {
  normalizeChatAttachments,
  prepareUserChatAttachmentsForStorage,
  validateChatAttachmentsForUpload,
  resolveChatAttachmentsForModel
} from '../services/chatAttachments.js';
import { createConversationAssistantResultService } from '../services/conversationAssistantResults.js';
import { recordAutomaticConversationMemories } from '../services/conversationMemoryExtraction.js';
import { projectConversationCast } from '../services/cast/castProjector.js';
import {
  createChatDiagnosticId,
  hasAssistantPayload,
  logAssistantPayloadFailure
} from '../services/conversationGenerationDiagnostics.js';
import { streamAssistantResponse } from '../services/conversationStreamResponse.js';
import { buildPromptPipeline } from '../services/promptPipeline.js';
import {
  generateCompletion,
  generateImage,
  isImageGenerationModel
} from '../services/providers.js';
import {
  createConversationMessage,
  getChatProviderSettingsFromContext,
  getConversationForUser,
  listRecentConversationMessageRows,
  updateConversationTimestamp,
  writeSse
} from './helpers.js';
import { continueMessageSchema, sendMessageSchema, validate } from '../validations/schemas.js';
import { normalizeThinkingLevel } from '../../../shared/providerThinking.js';

const CONTINUATION_PROMPT = [
  '从上一条 assistant 回复的末尾直接续写尚未完成的内容。',
  '保持相同的角色身份、叙事视角、时态、语气和场景连续性。',
  '不要复述、改写或总结已经输出的段落；不要添加“继续”“接下来”等说明，也不要把本指令写进剧情。'
].join('\n');

export function createConversationGenerationRouter(ctx) {
  const { db, requireAuth, asyncRoute, newId, nowIso } = ctx;
  const getChatProviderSettings = (userId) => getChatProviderSettingsFromContext(ctx, userId);
  // Generation only needs authorization + settings; skip the O(messages) usage scan.
  const getConversation = (userId, conversationId) =>
    getConversationForUser(db, userId, conversationId, { includeUsage: false });
  const router = Router({ mergeParams: true });
  const assistantResults = createConversationAssistantResultService({
    db,
    newId,
    nowIso,
    createConversationMessage,
    updateConversationTimestamp
  });
  // Single-process server: an in-memory set is enough to serialize generation
  // per conversation and avoid interleaved assistant messages.
  const generatingConversations = new Set();

  function tryLockGeneration(conversationId, response) {
    if (generatingConversations.has(conversationId)) {
      response.status(409).json({ error: '该对话正在生成回复，请等待完成后再试', accepted: false });
      return false;
    }
    generatingConversations.add(conversationId);
    return true;
  }

  function unlockGeneration(conversationId) {
    generatingConversations.delete(conversationId);
  }

  router.post('/messages', requireAuth, validate(sendMessageSchema), asyncRoute(async (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    if (!tryLockGeneration(conversation.id, response)) {
      return;
    }
    try {
      await handleSendMessage(request, response, conversation, character);
    } finally {
      unlockGeneration(conversation.id);
    }
  }));

  async function handleSendMessage(request, response, conversation, character) {
    const userText = String(request.body?.content || request.body?.message || '').trim();
    try {
      validateChatAttachmentsForUpload(request.body?.attachments);
    } catch (error) {
      response.status(400).json({ error: error?.message || '聊天图片附件无效' });
      return;
    }
    const userAttachmentCandidates = normalizeChatAttachments(request.body?.attachments);
    if (!userText && !userAttachmentCandidates.length) {
      response.status(400).json({ error: '消息不能为空' });
      return;
    }

    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error, accepted: false });
      return;
    }

    const presetId = String(request.body?.presetId || '').trim();
    const activePreset = presetId
      ? getPreset(db, request.auth.user.id, presetId)
      : getDefaultPreset(db, request.auth.user.id);

    let preparedUserAttachments;
    try {
      preparedUserAttachments = prepareUserChatAttachmentsForStorage(
        db,
        request.auth.user.id,
        conversation.id,
        userAttachmentCandidates
      );
    } catch (error) {
      response.status(400).json({ error: error?.message || '聊天图片附件无效' });
      return;
    }
    if (!userText && !preparedUserAttachments.storedAttachments.length) {
      response.status(400).json({ error: '消息不能为空' });
      return;
    }

    const promptPipeline = buildPromptPipeline(db, {
      character,
      conversation,
      user: request.auth.user,
      content: userText,
      history: listRecentConversationMessageRows(db, request.auth.user.id, conversation.id),
      userAttachments: preparedUserAttachments.modelAttachments,
      activePreset,
      resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(db, request.auth.user.id, attachments)
    });
    const rules = promptPipeline.rules;
    const processedUserText = promptPipeline.input.processed;
    const worldBookMatches = promptPipeline.worldBookMatches;
    const modelMessages = promptPipeline.modelMessages;
    const statusBar = promptPipeline.statusBar;

    const userMessage = createConversationMessage(db, newId, nowIso, {
      userId: request.auth.user.id,
      conversationId: conversation.id,
      role: 'user',
      content: userText,
      attachments: preparedUserAttachments.storedAttachments,
      reasoning: '',
      usage: null
    });
    updateConversationTimestamp(db, nowIso, request.auth.user.id, conversation.id);
    const aiOptions = buildAiOptions(request.body || {}, activePreset);

    if (shouldUseImageGeneration(request.body, settings.value, aiOptions)) {
      let result;
      try {
        result = await generateImage(settings.value, processedUserText || userText, aiOptions);
      } catch (error) {
        response.status(400).json({
          error: error?.message || '生图模型调用失败',
          accepted: true,
          userMessage,
          worldBookMatches
        });
        return;
      }
      const assistantMessage = assistantResults.saveAssistantImageResult({
        userId: request.auth.user.id,
        conversation,
        character,
        result
      });
      if (!assistantMessage) {
        response.status(502).json({
          error: '生图模型没有返回可保存的图片',
          accepted: true,
          userMessage,
          provider: result.provider,
          worldBookMatches
        });
        return;
      }
      response.json({
        userMessage,
        assistantMessage,
        usage: assistantMessage.usage,
        provider: result.provider,
        worldBookMatches,
        statusBar: getStatusBar(db, request.auth.user.id, conversation.id),
        accessoryBackground: false
      });
      return;
    }

    const completionOptions = aiOptions;

    if (request.body?.stream !== false) {
      await streamAssistantResponse({
        request,
        response,
        userId: request.auth.user.id,
        conversation,
        character,
        rules,
        modelMessages,
        settings: settings.value,
        userMessage,
        statusBar,
        worldBookMatches,
        thinkingEnabled: completionOptions.thinkingEnabled,
        completionOptions,
        writeSse,
        getStatusBar: () => getStatusBar(db, request.auth.user.id, conversation.id),
        saveAssistantResult: assistantResults.saveAssistantResult,
        saveInterruptedAssistantResult: assistantResults.saveInterruptedAssistantResult,
        startAccessoryAgentsInBackground: (options) => startAccessoryAgentsInBackground({ db, ...options })
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, completionOptions);
    if (!hasAssistantPayload(result)) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'provider-empty',
        mode: 'json',
        request,
        conversation,
        character,
        settings: settings.value,
        result,
        modelMessages,
        worldBookMatches
      });
      response.status(502).json({
        error: '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。',
        diagnosticId,
        accepted: true,
        userMessage,
        provider: result.provider,
        worldBookMatches
      });
      return;
    }
    const assistantMessage = assistantResults.saveAssistantResult({
      userId: request.auth.user.id,
      conversation,
      character,
      rules,
      result,
      macroContext: {
        userName: request.auth.user.displayName || request.auth.user.username || '用户',
        charName: character.name || ''
      }
    });
    if (!assistantMessage) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'postprocess-empty',
        mode: 'json',
        request,
        conversation,
        character,
        settings: settings.value,
        result,
        modelMessages,
        worldBookMatches
      });
      response.status(502).json({
        error: '模型回复被处理后为空，请检查输出正则或重试。',
        diagnosticId,
        accepted: true,
        userMessage,
        provider: result.provider,
        worldBookMatches
      });
      return;
    }
    const latestStatusBar = getStatusBar(db, request.auth.user.id, conversation.id);
    response.json({
      userMessage,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      worldBookMatches,
      statusBar: latestStatusBar,
      accessoryBackground: true
    });

    startAccessoryAgentsInBackground({
      db,
      userId: request.auth.user.id,
      conversation,
      character,
      userMessage,
      assistantMessage,
      settings: settings.value,
      statusBar: latestStatusBar || statusBar
    });
  }

  router.post('/messages/continue', requireAuth, validate(continueMessageSchema), asyncRoute(async (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    if (!tryLockGeneration(conversation.id, response)) {
      return;
    }
    try {
      await handleContinueMessage(request, response, conversation, character);
    } finally {
      unlockGeneration(conversation.id);
    }
  }));

  async function handleContinueMessage(request, response, conversation, character) {
    const history = listRecentConversationMessageRows(db, request.auth.user.id, conversation.id);
    if (!hasContinuableAssistant(history)) {
      response.status(400).json({ error: '没有可继续的回复' });
      return;
    }

    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error, accepted: false });
      return;
    }

    const presetId = String(request.body?.presetId || '').trim();
    const activePreset = presetId
      ? getPreset(db, request.auth.user.id, presetId)
      : getDefaultPreset(db, request.auth.user.id);
    const aiOptions = buildAiOptions(request.body || {}, activePreset);
    const promptPipeline = buildPromptPipeline(db, {
      character,
      conversation,
      user: request.auth.user,
      content: '',
      history,
      activePreset,
      appendUserMessage: false,
      continuationPrompt: CONTINUATION_PROMPT,
      resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(db, request.auth.user.id, attachments)
    });
    const rules = promptPipeline.rules;
    const worldBookMatches = promptPipeline.worldBookMatches;
    const modelMessages = promptPipeline.modelMessages;
    const statusBar = promptPipeline.statusBar;
    const completionOptions = aiOptions;

    if (request.body?.stream !== false) {
      await streamAssistantResponse({
        request,
        response,
        userId: request.auth.user.id,
        conversation,
        character,
        rules,
        modelMessages,
        settings: settings.value,
        userMessage: null,
        statusBar,
        worldBookMatches,
        thinkingEnabled: completionOptions.thinkingEnabled,
        completionOptions,
        writeSse,
        getStatusBar: () => getStatusBar(db, request.auth.user.id, conversation.id),
        saveAssistantResult: assistantResults.saveAssistantResult,
        saveInterruptedAssistantResult: assistantResults.saveInterruptedAssistantResult,
        startAccessoryAgentsInBackground: (options) => startAccessoryAgentsInBackground({ db, ...options })
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, completionOptions);
    if (!hasAssistantPayload(result)) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'provider-empty',
        mode: 'continue-json',
        request,
        conversation,
        character,
        settings: settings.value,
        result,
        modelMessages,
        worldBookMatches
      });
      response.status(502).json({
        error: '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。',
        diagnosticId,
        accepted: true,
        userMessage: null,
        provider: result.provider,
        worldBookMatches
      });
      return;
    }
    const assistantMessage = assistantResults.saveAssistantResult({
      userId: request.auth.user.id,
      conversation,
      character,
      rules,
      result,
      macroContext: {
        userName: request.auth.user.displayName || request.auth.user.username || '用户',
        charName: character.name || ''
      }
    });
    if (!assistantMessage) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'postprocess-empty',
        mode: 'continue-json',
        request,
        conversation,
        character,
        settings: settings.value,
        result,
        modelMessages,
        worldBookMatches
      });
      response.status(502).json({
        error: '模型回复被处理后为空，请检查输出正则或重试。',
        diagnosticId,
        accepted: true,
        userMessage: null,
        provider: result.provider,
        worldBookMatches
      });
      return;
    }
    const latestStatusBar = getStatusBar(db, request.auth.user.id, conversation.id);
    response.json({
      userMessage: null,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      worldBookMatches,
      statusBar: latestStatusBar,
      accessoryBackground: true
    });

    startAccessoryAgentsInBackground({
      db,
      userId: request.auth.user.id,
      conversation,
      character,
      userMessage: null,
      assistantMessage,
      settings: settings.value,
      statusBar: latestStatusBar || statusBar
    });
  }

  function startAccessoryAgentsInBackground(options) {
    queueMicrotask(() => {
      try {
        recordAutomaticConversationMemories(options.db, options.userId, options.conversation.id, {
          userMessage: options.userMessage,
          assistantMessage: options.assistantMessage
        });
      } catch (error) {
        console.warn('[conversation-memory] automatic extraction failed:', error?.message || error);
      }
      runAccessoryAgents(options).catch((error) => {
        console.warn('[accessory-agents] background update failed:', error?.message || error);
      });
      projectConversationCast({
        database: options.db,
        userId: options.userId,
        conversation: options.conversation,
        userMessage: options.userMessage,
        assistantMessage: options.assistantMessage,
        settings: options.settings
      }).catch((error) => {
        console.warn('[cast-sync] background update failed:', error?.message || error);
      });
    });
  }

  function buildAiOptions(body = {}, activePreset = null) {
    const hasThinkingLevel = body?.thinkingLevel !== undefined && body?.thinkingLevel !== null;
    const thinkingLevel = hasThinkingLevel
      ? normalizeThinkingLevel(body.thinkingLevel, body?.thinkingEnabled === false ? 'off' : 'high')
      : '';
    const aiOptions = {
      thinkingEnabled: thinkingLevel ? thinkingLevel !== 'off' : body?.thinkingEnabled !== false
    };
    if (thinkingLevel) {
      aiOptions.thinkingLevel = thinkingLevel;
    }

    if (activePreset) {
      aiOptions.temperature = activePreset.temperature;
      aiOptions.maxTokens = activePreset.maxTokens;
      aiOptions.topP = activePreset.topP;
      aiOptions.frequencyPenalty = activePreset.frequencyPenalty;
      aiOptions.presencePenalty = activePreset.presencePenalty;
    }
    return aiOptions;
  }

  function hasContinuableAssistant(history = []) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      const hasPayload = Boolean(String(message?.content || '').trim() || String(message?.reasoning || '').trim());
      if (!hasPayload) {
        continue;
      }
      return message.role === 'assistant';
    }
    return false;
  }

  function shouldUseImageGeneration(body = {}, settings = {}, aiOptions = {}) {
    if (body?.imageGeneration === true) {
      return true;
    }
    if (body?.imageGeneration === false) {
      return false;
    }
    return isImageGenerationModel(settings, aiOptions);
  }

  return router;
}
