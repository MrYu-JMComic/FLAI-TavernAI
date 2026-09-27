import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import { getDefaultPreset, getPreset } from '../modules/presets.js';
import { getStatusBar } from '../modules/statusBars.js';
import {
  normalizeChatAttachments,
  prepareUserChatAttachmentsForStorage,
  validateChatAttachmentsForUpload,
  resolveChatAttachmentsForModel
} from '../services/chatAttachments.js';
import { createConversationAssistantResultService } from '../services/conversationAssistantResults.js';
import { beginConversationGeneration, endConversationGeneration, enqueueConversationPostprocessing } from '../services/conversationTimeline.js';
import {
  createChatDiagnosticId,
  hasAssistantPayload,
  logAssistantPayloadFailure
} from '../services/conversationGenerationDiagnostics.js';
import { streamAssistantResponse } from '../services/conversationStreamResponse.js';
import { buildPromptPipeline } from '../services/promptPipeline.js';
import {
  buildConversationCompletionOptions,
  resolveConversationThinkingLevel
} from '../services/conversationContextBudget.js';
import { tryCreatePromptTrace, finishPromptTrace } from '../services/promptTrace.js';
import {
  generateCompletion,
  generateImage
} from '../services/providers.js';
import {
  createConversationMessage,
  getChatProviderSettingsFromContext,
  getConversationForUser,
  listRecentConversationMessageRows,
  updateConversationTimestamp,
  writeSse
} from './helpers.js';
import { continueMessageSchema, regenerateMessageSchema, sendMessageSchema, validate } from '../validations/schemas.js';
import { routeErrorPayload } from './errorResponse.js';
import { withSavepoint } from '../modules/savepoint.js';

const CONTINUATION_PROMPT = [
  '从上一条 assistant 回复的末尾直接续写尚未完成的内容。',
  '保持相同的角色身份、叙事视角、时态、语气和场景连续性。',
  '不要复述、改写或总结已经输出的段落；不要添加“继续”“接下来”等说明，也不要把本指令写进剧情。'
].join('\n');

export function createConversationGenerationRouter(ctx) {
  const { db, requireAuth, asyncRoute, newId, nowIso } = ctx;
  const config = ctx.config || {};
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
    updateConversationTimestamp,
    onAssistantSaved: ({ userId, conversation, assistantMessage, ticket }) => {
      finishPromptTrace(ticket?.requestTrace, { status: 'completed', assistantMessageId: assistantMessage.id, usage: assistantMessage.usage });
      return enqueueConversationPostprocessing(db, userId, conversation.id, assistantMessage.id, {
        thinkingLevel: ticket?.thinkingLevel,
        thinkingEnabled: ticket?.thinkingEnabled,
      });
    }
  });

  function rememberGenerationThinking(ticket, settings, completionOptions) {
    if (!ticket) return;
    ticket.thinkingLevel = resolveConversationThinkingLevel(settings, completionOptions);
    ticket.thinkingEnabled = ticket.thinkingLevel !== 'off';
  }

  function tryLockGeneration(userId, conversationId, response) {
    try {
      return beginConversationGeneration(db, userId, conversationId, { backgroundSafe: true });
    } catch (error) {
      if (error.status !== 409) throw error;
      response.status(409).json({ error: error.message, code: error.code, jobId: error.jobId || '', accepted: false });
      return null;
    }
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

    const ticket = tryLockGeneration(request.auth.user.id, conversation.id, response);
    if (!ticket) {
      return;
    }
    try {
      await handleSendMessage(request, response, conversation, character, ticket);
    } catch (error) {
      finishFailedTrace(ticket, error);
      throw error;
    } finally {
      finishFailedTrace(ticket);
      endConversationGeneration(db, ticket);
    }
  }));

  async function handleSendMessage(request, response, conversation, character, ticket) {
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

    const modelUserAttachments = resolveChatAttachmentsForModel(db, request.auth.user.id, userAttachmentCandidates);
    if (modelUserAttachments.length !== userAttachmentCandidates.length) {
      response.status(400).json({ error: '聊天图片附件无效或不可访问', accepted: false });
      return;
    }

    const aiOptions = { ...buildConversationCompletionOptions(settings.value, conversation.contextBudget, request.body || {}, activePreset), signal: ticket.signal };
    rememberGenerationThinking(ticket, settings.value, aiOptions);
    let commitWorldBookState;
    const promptPipeline = buildPromptPipeline(db, {
      character,
      conversation,
      user: request.auth.user,
      content: userText,
      history: listRecentConversationMessageRows(db, request.auth.user.id, conversation.id),
      userAttachments: modelUserAttachments,
      activePreset,
      providerSettings: settings.value,
      tokenBudget: { ...conversation.contextBudget, reservedOutputTokens: aiOptions.maxTokens },
      tools: settings.value.extraBody?.tools,
      deferWorldBookStateCommit: (commit) => { commitWorldBookState = commit; },
      resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(db, request.auth.user.id, attachments)
    });
    if (!shouldUseImageGeneration(request.body) && rejectBudgetOverflow(response, promptPipeline)) return;
    const rules = promptPipeline.rules;
    const processedUserText = promptPipeline.input.processed;
    const worldBookMatches = promptPipeline.worldBookMatches;
    const modelMessages = promptPipeline.modelMessages;
    const statusBar = promptPipeline.statusBar;

    let userMessage;
    try {
      userMessage = withSavepoint(db, 'sp_accept_chat_input', () => {
        const prepared = prepareUserChatAttachmentsForStorage(db, request.auth.user.id, conversation.id, userAttachmentCandidates);
        const message = createConversationMessage(db, newId, nowIso, {
          userId: request.auth.user.id, conversationId: conversation.id, role: 'user', content: userText,
          attachments: prepared.storedAttachments, reasoning: '', usage: null
        });
        updateConversationTimestamp(db, nowIso, request.auth.user.id, conversation.id);
        commitWorldBookState?.();
        return message;
      });
    } catch (error) {
      const publicError = routeErrorPayload(error, { status: 400, isProduction: config.isProduction, fallback: '消息未保存，请重试。' });
      response.status(publicError.normalized.status).json({ error: publicError.error, code: publicError.code, accepted: false });
      return;
    }

    if (shouldUseImageGeneration(request.body)) {
      let result;
      try {
        result = await generateImage(settings.value, processedUserText || userText, {
          ...aiOptions,
          imageModel: request.body?.imageModel,
          database: db,
          userId: request.auth.user.id
        });
      } catch (error) {
        const publicError = routeErrorPayload(error, {
          status: Number.isInteger(error?.status) ? error.status : 400,
          isProduction: config.isProduction,
          fallback: '生图模型调用失败'
        });
        response.status(publicError.normalized.status).json({
          error: publicError.error,
          code: publicError.code,
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
        result,
        ticket
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

    ticket.requestTrace = tryCreatePromptTrace(db, {
      userId: request.auth.user.id, conversationId: conversation.id, ticket,
      pipeline: promptPipeline, settings: settings.value, sourceMessageId: userMessage.id, operation: 'send'
    });
    const completionOptions = { ...aiOptions, requestTrace: ticket.requestTrace };

    if (request.body?.stream !== false) {
      await streamAssistantResponse({
        request,
        response,
        userId: request.auth.user.id,
        database: db,
        config,
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
        saveAssistantResult: (options) => assistantResults.saveAssistantResult({ ...options, ticket }),
        saveInterruptedAssistantResult: (options) => assistantResults.saveInterruptedAssistantResult({ ...options, ticket })
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, {
      ...completionOptions,
      database: db,
      userId: request.auth.user.id
    });
    if (!hasAssistantPayload(result)) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'PROVIDER_EMPTY' });
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
      ticket,
      macroContext: {
        userName: request.auth.user.displayName || request.auth.user.username || '用户',
        charName: character.name || ''
      }
    });
    if (!assistantMessage) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'POSTPROCESS_EMPTY' });
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

    const ticket = tryLockGeneration(request.auth.user.id, conversation.id, response);
    if (!ticket) {
      return;
    }
    try {
      await handleContinueMessage(request, response, conversation, character, ticket);
    } catch (error) {
      finishFailedTrace(ticket, error);
      throw error;
    } finally {
      finishFailedTrace(ticket);
      endConversationGeneration(db, ticket);
    }
  }));

  async function handleContinueMessage(request, response, conversation, character, ticket) {
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
    const aiOptions = { ...buildConversationCompletionOptions(settings.value, conversation.contextBudget, request.body || {}, activePreset), signal: ticket.signal };
    rememberGenerationThinking(ticket, settings.value, aiOptions);
    let commitWorldBookState;
    const promptPipeline = buildPromptPipeline(db, {
      character,
      conversation,
      user: request.auth.user,
      content: '',
      history,
      activePreset,
      providerSettings: settings.value,
      tokenBudget: { ...conversation.contextBudget, reservedOutputTokens: aiOptions.maxTokens },
      tools: settings.value.extraBody?.tools,
      deferWorldBookStateCommit: (commit) => { commitWorldBookState = commit; },
      appendUserMessage: false,
      continuationPrompt: CONTINUATION_PROMPT,
      resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(db, request.auth.user.id, attachments)
    });
    const rules = promptPipeline.rules;
    const worldBookMatches = promptPipeline.worldBookMatches;
    const modelMessages = promptPipeline.modelMessages;
    const statusBar = promptPipeline.statusBar;
    if (rejectBudgetOverflow(response, promptPipeline)) return;
    commitWorldBookState?.();
    ticket.requestTrace = tryCreatePromptTrace(db, {
      userId: request.auth.user.id, conversationId: conversation.id, ticket,
      pipeline: promptPipeline, settings: settings.value,
      sourceMessageId: history.findLast((message) => message.role === 'assistant')?.id || '', operation: 'continue'
    });
    const completionOptions = { ...aiOptions, requestTrace: ticket.requestTrace };

    if (request.body?.stream !== false) {
      await streamAssistantResponse({
        request,
        response,
        userId: request.auth.user.id,
        database: db,
        config,
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
        saveAssistantResult: (options) => assistantResults.saveAssistantResult({ ...options, ticket }),
        saveInterruptedAssistantResult: (options) => assistantResults.saveInterruptedAssistantResult({ ...options, ticket })
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, {
      ...completionOptions,
      database: db,
      userId: request.auth.user.id
    });
    if (!hasAssistantPayload(result)) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'PROVIDER_EMPTY' });
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
      ticket,
      macroContext: {
        userName: request.auth.user.displayName || request.auth.user.username || '用户',
        charName: character.name || ''
      }
    });
    if (!assistantMessage) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'POSTPROCESS_EMPTY' });
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

  }

  router.post('/messages/:messageId/regenerate', requireAuth, validate(regenerateMessageSchema), asyncRoute(async (request, response) => {
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

    const ticket = tryLockGeneration(request.auth.user.id, conversation.id, response);
    if (!ticket) {
      return;
    }
    try {
      await handleRegenerateMessage(request, response, conversation, character, ticket);
    } catch (error) {
      finishFailedTrace(ticket, error);
      throw error;
    } finally {
      finishFailedTrace(ticket);
      endConversationGeneration(db, ticket);
    }
  }));

  async function handleRegenerateMessage(request, response, conversation, character, ticket) {
    const fullHistory = listRecentConversationMessageRows(db, request.auth.user.id, conversation.id);
    const targetId = String(request.params.messageId || '').trim();
    const targetIndex = fullHistory.findIndex((message) => message.id === targetId);
    const target = targetIndex >= 0 ? fullHistory[targetIndex] : null;
    if (!target || target.role !== 'assistant') {
      response.status(404).json({ error: '要重新生成的回复不存在', accepted: false });
      return;
    }
    if (targetIndex !== fullHistory.length - 1) {
      response.status(400).json({ error: '只能重新生成最后一条回复。要修改更早的回复，请先创建分支或删除后续消息。', code: 'REGENERATE_NOT_LATEST', accepted: false });
      return;
    }
    const history = fullHistory.slice(0, targetIndex);
    if (!history.some((message) => message.role === 'user')) {
      response.status(400).json({ error: '开场白没有对应的用户输入，无法重新生成。', code: 'REGENERATE_NO_USER_TURN', accepted: false });
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
    const aiOptions = { ...buildConversationCompletionOptions(settings.value, conversation.contextBudget, request.body || {}, activePreset), signal: ticket.signal };
    rememberGenerationThinking(ticket, settings.value, aiOptions);
    let commitWorldBookState;
    const promptPipeline = buildPromptPipeline(db, {
      character,
      conversation,
      user: request.auth.user,
      content: '',
      history,
      activePreset,
      providerSettings: settings.value,
      tokenBudget: { ...conversation.contextBudget, reservedOutputTokens: aiOptions.maxTokens },
      tools: settings.value.extraBody?.tools,
      deferWorldBookStateCommit: (commit) => { commitWorldBookState = commit; },
      appendUserMessage: false,
      resolveAttachmentsForModel: (attachments) => resolveChatAttachmentsForModel(db, request.auth.user.id, attachments)
    });
    const rules = promptPipeline.rules;
    const worldBookMatches = promptPipeline.worldBookMatches;
    const modelMessages = promptPipeline.modelMessages;
    const statusBar = promptPipeline.statusBar;
    if (rejectBudgetOverflow(response, promptPipeline)) return;
    commitWorldBookState?.();
    ticket.requestTrace = tryCreatePromptTrace(db, {
      userId: request.auth.user.id, conversationId: conversation.id, ticket,
      pipeline: promptPipeline, settings: settings.value, sourceMessageId: target.id, operation: 'regenerate'
    });
    const completionOptions = { ...aiOptions, requestTrace: ticket.requestTrace };
    const macroContext = {
      userName: request.auth.user.displayName || request.auth.user.username || '用户',
      charName: character.name || ''
    };
    const saveRegenerated = (options) => {
      const assistantMessage = assistantResults.saveRegeneratedAssistantResult({ ...options, ticket, targetMessageId: target.id });
      if (assistantMessage) {
        finishPromptTrace(ticket.requestTrace, { status: 'completed', assistantMessageId: assistantMessage.id, usage: assistantMessage.usage });
      }
      return assistantMessage;
    };

    if (request.body?.stream !== false) {
      await streamAssistantResponse({
        request,
        response,
        userId: request.auth.user.id,
        database: db,
        config,
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
        saveAssistantResult: saveRegenerated,
        // An interrupted regeneration leaves the previous reply untouched.
        saveInterruptedAssistantResult: () => null
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, {
      ...completionOptions,
      database: db,
      userId: request.auth.user.id
    });
    if (!hasAssistantPayload(result)) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'PROVIDER_EMPTY' });
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId, stage: 'provider-empty', mode: 'regenerate-json', request, conversation, character,
        settings: settings.value, result, modelMessages, worldBookMatches
      });
      response.status(502).json({
        error: '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。',
        diagnosticId, accepted: true, userMessage: null, provider: result.provider, worldBookMatches
      });
      return;
    }
    const assistantMessage = saveRegenerated({ userId: request.auth.user.id, conversation, character, rules, result, macroContext });
    if (!assistantMessage) {
      finishPromptTrace(ticket.requestTrace, { status: 'empty', usage: result.usage, errorCode: 'POSTPROCESS_EMPTY' });
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId, stage: 'postprocess-empty', mode: 'regenerate-json', request, conversation, character,
        settings: settings.value, result, modelMessages, worldBookMatches
      });
      response.status(502).json({
        error: '模型回复被处理后为空，请检查输出正则或重试。',
        diagnosticId, accepted: true, userMessage: null, provider: result.provider, worldBookMatches
      });
      return;
    }
    response.json({
      userMessage: null,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      worldBookMatches,
      statusBar: getStatusBar(db, request.auth.user.id, conversation.id),
      accessoryBackground: true
    });
  }

  function rejectBudgetOverflow(response, pipeline) {
    if (!pipeline.budget.overTokenBudget) return false;
    response.status(400).json({
      error: pipeline.budget.overContextWindow
        ? '系统提示词、对话与预留回复合计超过模型上下文窗口，请减少上下文或调整窗口配置。'
        : '当前输入与最近完整对话超过对话 Token 上限，请提高对话上限或缩短草稿后重试。',
      code: 'CONTEXT_BUDGET_EXCEEDED', accepted: false, budget: pipeline.budget
    });
    return true;
  }

  function finishFailedTrace(ticket, error) {
    const code = error?.code || ticket.signal?.reason?.code || '';
    const status = code === 'CONVERSATION_TIMELINE_CHANGED' ? 'stale'
      : ticket.signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed';
    finishPromptTrace(ticket.requestTrace, { status, errorCode: code });
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

  function shouldUseImageGeneration(body = {}) {
    return body?.imageGeneration === true;
  }

  return router;
}
