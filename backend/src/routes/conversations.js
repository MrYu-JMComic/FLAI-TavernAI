import { Router } from 'express';
import {
  applyRegexRules,
  getCharacter,
  getRegexRules,
  touchCharacter
} from '../modules/characters.js';
import {
  buildWorldBookContext,
  matchWorldBookEntries,
  injectAtDepthEntries
} from '../modules/worldBooks.js';
import {
  createSave,
  deleteSave,
  getSave,
  listSaves,
  loadSave,
  updateSave
} from '../modules/saves.js';
import { getDefaultPreset, getPreset } from '../modules/presets.js';
import { buildModSystemPrompt, getEnabledModsForUser } from '../modules/mods.js';
import { buildTalentSystemPrompt } from '../modules/talents.js';
import {
  hasStatusBarBlueprint,
  normalizeAdvancedSettings,
  normalizeAccessorySkills
} from '../modules/advancedSettings.js';
import {
  deleteStatusBar,
  getStatusBar,
  upsertStatusBar
} from '../modules/statusBars.js';
import {
  createConversationTransaction,
  getConversationEconomyState,
  getTransactionHistory,
} from '../modules/economy.js';
import {
  addNpcBehavior,
  addNpcMemory,
  buildNpcBehaviorPrompt,
  deleteNpcBehavior,
  deleteNpcMemory,
  hideConversationNpc,
  hideEmptyConversationNpcs,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  updateConversationNpc,
  updateNpcMemory,
  updateNpcBehavior
} from '../modules/npcs.js';
import {
  buildUsageSnapshot,
  generateCompletion,
  generateImage,
  streamCompletion
} from '../services/providers.js';
import { renderPromptVariables, resolvePromptUserName } from '../services/promptVariables.js';
import { saveConversationAppearance } from '../modules/conversationAppearance.js';
import { withSavepoint } from '../modules/savepoint.js';
import { getAccessorySkillsPayload, runAccessoryAgents } from '../services/accessoryAgents.js';
import { completeNpcOrganization, streamNpcOrganization } from '../services/npcOrganizer.js';
import {
  getChatProviderSettingsFromContext,
  toConversation,
  toMessage,
  withConversationUsage,
  parseJson,
  normalizeIdList,
  withModelOverride,
  writeSse
} from './helpers.js';
import { sendMessageSchema, updateMessageSchema, saveConversationSettingsSchema, saveStatusBarSchema, economyTransactionSchema, addNpcMemorySchema, updateNpcMemorySchema, addNpcBehaviorSchema, updateNpcBehaviorSchema, updateNpcSchema, npcOrganizerSchema, createSaveSchema, renameSaveSchema, createConversationSchema, bulkDeleteSchema, validate } from '../validations/schemas.js';

const CHAT_STREAM_HEARTBEAT_MS = 15_000;

export function createConversationsRouter(ctx) {
  const { db, requireAuth, asyncRoute, newId, nowIso, withEtag, withListCache } = ctx;
  const getChatProviderSettings = (userId) => getChatProviderSettingsFromContext(ctx, userId);
  const router = Router();

  // ── Conversation List ──

  router.get('/', requireAuth, (request, response) => {
    const characterId = String(request.query.characterId || '').trim();
    const params = [request.auth.user.id];
    let where = 'WHERE conversations.user_id = ?';
    if (characterId) {
      where += ' AND conversations.character_id = ?';
      params.push(characterId);
    }

    const rows = db
      .prepare(
        `SELECT conversations.*, characters.name AS character_name, characters.avatar_url
         FROM conversations
         JOIN characters ON characters.id = conversations.character_id
         ${where}
         ORDER BY conversations.updated_at DESC, conversations.rowid DESC`
      )
      .all(...params);

    response.json(rows.map((row) => withConversationUsage(toConversation(row, db), request.auth.user.id, db)));
  });

  router.post('/bulk-delete', requireAuth, validate(bulkDeleteSchema), (request, response) => {
    const ids = normalizeIdList(request.body?.ids);
    if (!ids.length) {
      response.status(400).json({ error: '请选择要删除的会话' });
      return;
    }

    const deletedIds = deleteConversations(request.auth.user.id, ids);
    response.json({ ok: true, deletedIds });
  });

  router.post('/', requireAuth, validate(createConversationSchema), (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.body?.characterId);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    const conversationId = newId();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(conversationId, request.auth.user.id, character.id, `${character.name} 的故事`, timestamp, timestamp);

    const statusBarBlueprint = normalizeAdvancedSettings(character.authorAdvancedSettings || {}).statusBarBlueprint;
    if (hasStatusBarBlueprint(statusBarBlueprint)) {
      upsertStatusBar(db, request.auth.user.id, conversationId, {
        name: statusBarBlueprint.name || '状态栏',
        variables: statusBarBlueprint.variables,
        template: statusBarBlueprint.template
      });
    }

    if (character.openingMessage) {
      insertMessage({
        userId: request.auth.user.id,
        conversationId,
        role: 'assistant',
        content: renderPromptVariables(character.openingMessage, request.auth.user),
        reasoning: '',
        usage: null
      });
    }

    touchCharacter(db, request.auth.user.id, character.id);
    response.status(201).json(getConversation(request.auth.user.id, conversationId));
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteConversation(request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json({ ok: true, deletedId: request.params.id });
  });

  // ── Messages ──

  router.get('/:id/messages', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const rules = character ? getRegexRules(db, character.ownerId, character.id) : [];
    const displayRules = rules.filter(r => r.enabled && r.scope === 'display');
    const macroContext = {
      userName: request.auth.user.displayName || request.auth.user.username || '用户',
      charName: character?.name || ''
    };

    const messages = getMessages(request.auth.user.id, request.params.id).map(msg => {
      if (displayRules.length === 0) return msg;
      return {
        ...msg,
        content: applyRegexRules(msg.content, displayRules, 'display', macroContext)
      };
    });

    response.json({
      conversation,
      messages
    });
  });

  router.post('/:id/messages', requireAuth, validate(sendMessageSchema), asyncRoute(async (request, response) => {
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

    const userText = String(request.body?.content || request.body?.message || '').trim();
    const userAttachments = normalizeChatAttachments(request.body?.attachments);
    if (!userText && !userAttachments.length) {
      response.status(400).json({ error: '消息不能为空' });
      return;
    }

    const rules = getRegexRules(db, character.ownerId, character.id);
    const statusBar = getStatusBar(db, request.auth.user.id, conversation.id);
    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error, accepted: false });
      return;
    }

    const presetId = String(request.body?.presetId || '').trim();
    const activePreset = presetId
      ? getPreset(db, request.auth.user.id, presetId)
      : getDefaultPreset(db, request.auth.user.id);

    const macroContext = {
      userName: request.auth.user.displayName || request.auth.user.username || '用户',
      charName: character.name || ''
    };
    const processedUserText = applyRegexRules(userText, rules, 'input', macroContext);
    // Collect recent messages for scan_depth matching
    const recentForWI = getRecentMessages(request.auth.user.id, conversation.id);
    const recentTexts = recentForWI.map((m) => m.content);
    if (processedUserText) {
      recentTexts.push(processedUserText);
    }
    const worldBookEntries = matchWorldBookEntries(db, character.id, recentTexts, { conversationId: conversation.id });
    const worldBookMatches = summarizeWorldBookMatches(worldBookEntries);
    const userMods = getEnabledModsForUser(db, request.auth.user.id, { characterId: character.id });
    const accessoryState = getAccessorySkillsPayload(conversation, statusBar);
    const npcPrompt = accessoryState.active.npcAgent ? buildNpcBehaviorPrompt(db, conversation.id) : '';
    const talentPrompt = accessoryState.active.talentPrompt ? buildTalentSystemPrompt(db, character.id) : '';
    const modelMessages = buildModelMessagesV2({
      character,
      history: getRecentMessages(request.auth.user.id, conversation.id),
      userText: processedUserText,
      userAttachments,
      user: request.auth.user,
      worldBookContext: buildWorldBookContext(worldBookEntries),
      worldBookEntries,
      presetSystemPrompt: activePreset?.systemPrompt || '',
      modSystemPrompt: buildModSystemPrompt(userMods),
      npcBehaviorPrompt: npcPrompt,
      talentPrompt,
      authorAdvancedSettings: conversation.authorSettings || {},
      userAdvancedSettings: conversation.userSettings || {}
    });

    const userMessage = insertMessage({
      userId: request.auth.user.id,
      conversationId: conversation.id,
      role: 'user',
      content: userText,
      attachments: userAttachments,
      reasoning: '',
      usage: null
    });
    updateConversationTimestamp(request.auth.user.id, conversation.id);
    const aiOptions = {
      thinkingEnabled: request.body?.thinkingEnabled !== false
    };

    if (activePreset) {
      aiOptions.temperature = activePreset.temperature;
      aiOptions.maxTokens = activePreset.maxTokens;
      aiOptions.topP = activePreset.topP;
      aiOptions.frequencyPenalty = activePreset.frequencyPenalty;
      aiOptions.presencePenalty = activePreset.presencePenalty;
    }

    if (request.body?.imageGeneration) {
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
      const assistantMessage = saveAssistantImageResult({
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
        thinkingEnabled: aiOptions.thinkingEnabled,
        completionOptions: aiOptions
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, aiOptions);
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
    const assistantMessage = saveAssistantResult({
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
    response.json({
      userMessage,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      worldBookMatches,
      statusBar: getStatusBar(db, request.auth.user.id, conversation.id),
      accessoryBackground: true
    });

    startAccessoryAgentsInBackground({
      db,
      userId: request.auth.user.id,
      conversation,
      character,
      assistantMessage,
      settings: settings.value,
      statusBar: getStatusBar(db, request.auth.user.id, conversation.id) || statusBar
    });
  }));

  router.patch('/:id/messages/:messageId', requireAuth, validate(updateMessageSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const message = getMessage(request.auth.user.id, request.params.id, request.params.messageId);
    if (!message) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }

    const content = String(request.body?.content ?? '').trim();
    if (!content) {
      response.status(400).json({ error: '消息内容不能为空' });
      return;
    }

    response.json(updateMessage(request.auth.user.id, request.params.id, request.params.messageId, { content }));
  });

  router.delete('/:id/messages/:messageId', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const deletedMessage = deleteMessage(request.auth.user.id, request.params.id, request.params.messageId);
    if (!deletedMessage) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }

    response.json({
      ok: true,
      deletedId: deletedMessage.deletedId,
      deletedReasoning: deletedMessage.deletedReasoning
    });
  });

  // ── Conversation Settings ──

  router.get('/:id/settings', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(conversation.settings);
  });

  router.put('/:id/settings', requireAuth, validate(saveConversationSettingsSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const requestedLorebookId = request.body?.chatLorebookId !== undefined
      ? request.body.chatLorebookId ? String(request.body.chatLorebookId).trim() : null
      : undefined;
    if (requestedLorebookId) {
      const book = db.prepare('SELECT id FROM world_books WHERE id = ? AND user_id = ?').get(requestedLorebookId, request.auth.user.id);
      if (!book) {
        response.status(400).json({ error: '指定的世界书不存在' });
        return;
      }
    }

    const settings = withSavepoint(db, 'sp_save_conversation_settings', () => {
      const savedSettings = saveConversationAppearance(db, request.auth.user.id, request.params.id, request.body || {});
      if (!savedSettings) {
        return null;
      }
      if (requestedLorebookId !== undefined) {
        db.prepare('UPDATE conversations SET chat_lorebook_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(requestedLorebookId, nowIso(), request.params.id, request.auth.user.id);
      }
      return savedSettings;
    });
    if (!settings) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const updated = getConversation(request.auth.user.id, request.params.id);
    response.json({ ...(updated?.settings || settings), chatLorebookId: updated?.chatLorebookId ?? null });
  });

  router.get('/:id/accessory-skills', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(getAccessorySkillsPayload(conversation, getStatusBar(db, request.auth.user.id, request.params.id)));
  });

  router.put('/:id/accessory-skills', requireAuth, (request, response) => {
    const payload = saveConversationAccessorySkills(request.auth.user.id, request.params.id, request.body || {});
    if (!payload) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(payload);
  });

  // ── Status Bar ──

  router.get('/:id/status-bar', requireAuth, (request, response) => {
    const statusBar = getStatusBar(db, request.auth.user.id, request.params.id);
    if (!statusBar) {
      response.json(null);
      return;
    }
    response.json(statusBar);
  });

  router.put('/:id/status-bar', requireAuth, validate(saveStatusBarSchema), (request, response) => {
    const statusBar = upsertStatusBar(db, request.auth.user.id, request.params.id, request.body || {});
    if (!statusBar) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(statusBar);
  });

  router.delete('/:id/status-bar', requireAuth, (request, response) => {
    if (!deleteStatusBar(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '对话不存在或状态栏不存在' });
      return;
    }
    response.json({ ok: true });
  });

  // ── Economy ──

  router.get('/:id/economy', requireAuth, (request, response) => {
    const ensureDefaultAccount = !['0', 'false', 'no'].includes(String(request.query.ensure || '').toLowerCase());
    const state = getConversationEconomyState(db, request.auth.user.id, request.params.id, { ensureDefaultAccount });
    if (!state) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(state);
  });

  router.post('/:id/economy/transaction', requireAuth, validate(economyTransactionSchema), (request, response) => {
    try {
      const result = createConversationTransaction(db, request.auth.user.id, request.params.id, request.body || {});
      if (!result) {
        response.status(404).json({ error: '对话不存在' });
        return;
      }
      response.status(201).json(result);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.get('/:id/economy/history', requireAuth, (request, response) => {
    const history = getTransactionHistory(db, request.auth.user.id, request.params.id, {
      currencyType: request.query.currencyType,
      limit: request.query.limit,
      offset: request.query.offset
    });
    if (!history) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(history);
  });

  // ── NPC Agent Engine ──

  router.get('/:id/npcs', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    response.json(listConversationNpcs(db, request.auth.user.id, request.params.id, character?.name || ''));
  });

  router.delete('/:id/npcs-empty', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const result = hideEmptyConversationNpcs(db, request.auth.user.id, request.params.id, character?.name || '');
    response.json({ ok: true, ...result });
  });

  router.post('/:id/npcs/organize', requireAuth, validate(npcOrganizerSchema), asyncRoute(async (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }

    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const effectiveSettings = withModelOverride(settings.value, request.body?.modelOverride);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('AI NPC 整理请求超时，请稍后重试。')), 300000);
    request.on('aborted', () => controller.abort(new Error('客户端已取消 AI NPC 整理请求。')));

    const organizerRequest = {
      database: db,
      userId: request.auth.user.id,
      conversationId: request.params.id,
      conversation,
      character,
      requirement: request.body?.requirement || '',
      selectedNpc: request.body?.selectedNpc || '',
      signal: controller.signal
    };

    try {
      if (request.body?.stream === true) {
        request.socket?.setTimeout?.(0);
        response.socket?.setTimeout?.(0);
        response.setTimeout?.(0);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Content-Encoding': 'identity',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        response.flushHeaders?.();
        const heartbeat = setInterval(() => writeSse(response, 'ping', { at: Date.now() }), 15000);
        try {
          const result = await streamNpcOrganization(effectiveSettings, {
            ...organizerRequest,
            emit: (event, data) => writeSse(response, event, data)
          });
          writeSse(response, 'done', result);
          response.end();
        } catch (error) {
          if (!request.aborted && !response.destroyed) {
            const message = controller.signal.aborted
              ? controller.signal.reason?.message || 'AI NPC 整理请求已中断，请重试。'
              : normalizeNpcOrganizerError(error);
            writeSse(response, 'error', { error: message });
            response.end();
          }
        } finally {
          clearInterval(heartbeat);
        }
        return;
      }

      response.json(await completeNpcOrganization(effectiveSettings, organizerRequest));
    } catch (error) {
      if (request.aborted || response.destroyed) {
        return;
      }
      const message = controller.signal.aborted
        ? controller.signal.reason?.message || 'AI NPC 整理请求已中断，请重试。'
        : normalizeNpcOrganizerError(error);
      response.status(controller.signal.aborted ? 504 : 400).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  }));

  router.get('/:id/npcs/:npc/memories', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(listNpcMemories(db, request.auth.user.id, request.params.id, request.params.npc));
  });

  router.put('/:id/npcs/:npc', requireAuth, validate(updateNpcSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const npc = updateConversationNpc(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    if (!npc) {
      response.status(400).json({ error: 'Invalid NPC name' });
      return;
    }
    response.json(npc);
  });

  router.delete('/:id/npcs/:npc', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const hidden = hideConversationNpc(db, request.auth.user.id, request.params.id, request.params.npc);
    if (!hidden) {
      response.status(400).json({ error: 'NPC 名称无效' });
      return;
    }
    response.json({ ok: true, hidden });
  });

  router.post('/:id/npcs/:npc/memories', requireAuth, validate(addNpcMemorySchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const memory = addNpcMemory(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    response.status(201).json(memory);
  });

  router.put('/:id/npcs/:npc/memories/:memoryId', requireAuth, validate(updateNpcMemorySchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const memory = updateNpcMemory(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memoryId,
      request.body || {},
      request.params.npc
    );
    if (!memory) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json(memory);
  });

  router.delete('/:id/npcs/:npc/memories/:memoryId', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    if (!deleteNpcMemory(db, request.auth.user.id, request.params.id, request.params.memoryId, request.params.npc)) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.get('/:id/npcs/:npc/behaviors', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(listNpcBehaviors(db, request.auth.user.id, request.params.id, request.params.npc));
  });

  router.post('/:id/npcs/:npc/behaviors', requireAuth, validate(addNpcBehaviorSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const behavior = addNpcBehavior(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    response.status(201).json(behavior);
  });

  router.put('/:id/npcs/:npc/behaviors/:behaviorId', requireAuth, validate(updateNpcBehaviorSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const behavior = updateNpcBehavior(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.behaviorId,
      request.body || {},
      request.params.npc
    );
    if (!behavior) {
      response.status(404).json({ error: '行为规则不存在' });
      return;
    }
    response.json(behavior);
  });

  router.delete('/:id/npcs/:npc/behaviors/:behaviorId', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    if (!deleteNpcBehavior(db, request.auth.user.id, request.params.id, request.params.behaviorId, request.params.npc)) {
      response.status(404).json({ error: '行为规则不存在' });
      return;
    }
    response.json({ ok: true });
  });

  // ── Saves ──

  router.get('/:id/saves', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(listSaves(db, request.auth.user.id, request.params.id));
  });

  router.post('/:id/saves', requireAuth, validate(createSaveSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const save = createSave(db, request.auth.user.id, request.params.id, request.body || {});
    response.status(201).json(save);
  });

  // ── Internal helpers ──

  function getConversation(userId, conversationId) {
    const row = db
      .prepare(
        `SELECT conversations.*, characters.name AS character_name, characters.avatar_url, characters.author_advanced_settings
         FROM conversations
         JOIN characters ON characters.id = conversations.character_id
         WHERE conversations.user_id = ? AND conversations.id = ?`
      )
      .get(userId, conversationId);
    return row ? withConversationUsage(toConversation(row, db), userId, db) : null;
  }

  function getMessages(userId, conversationId) {
    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND conversation_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(userId, conversationId);
    const messages = [];
    for (const row of rows) {
      if (isDisplayableMessageRow(row)) {
        messages.push(toMessage(row));
      }
    }
    return messages;
  }

  function getMessage(userId, conversationId, messageId) {
    const row = db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND conversation_id = ? AND id = ?`
      )
      .get(userId, conversationId, messageId);
    return row ? toMessage(row) : null;
  }

  function updateMessage(userId, conversationId, messageId, payload) {
    db.prepare(
      `UPDATE messages
       SET content = ?
       WHERE user_id = ? AND conversation_id = ? AND id = ?`
    ).run(payload.content, userId, conversationId, messageId);
    updateConversationTimestamp(userId, conversationId);
    return getMessage(userId, conversationId, messageId);
  }

  function deleteMessage(userId, conversationId, messageId) {
    const existing = getMessage(userId, conversationId, messageId);
    if (!existing) {
      return null;
    }

    const result = db
      .prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND id = ?')
      .run(userId, conversationId, messageId);
    if (result.changes > 0) {
      updateConversationTimestamp(userId, conversationId);
    }
    return result.changes > 0
      ? { deletedId: messageId, deletedReasoning: Boolean(existing.reasoning) }
      : null;
  }

  function deleteConversation(userId, conversationId) {
    const result = db
      .prepare('DELETE FROM conversations WHERE user_id = ? AND id = ?')
      .run(userId, conversationId);
    return result.changes > 0;
  }

  function deleteConversations(userId, ids) {
    const placeholders = ids.map(() => '?').join(', ');
    // First, find which IDs actually belong to this user
    const existing = db
      .prepare(`SELECT id FROM conversations WHERE user_id = ? AND id IN (${placeholders})`)
      .all(userId, ...ids)
      .map((r) => r.id);
    if (!existing.length) {
      return [];
    }
    const existingPlaceholders = existing.map(() => '?').join(', ');
    db.prepare(`DELETE FROM conversations WHERE user_id = ? AND id IN (${existingPlaceholders})`).run(userId, ...existing);
    return existing;
  }

  function getRecentMessages(userId, conversationId) {
    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND conversation_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 20`
      )
      .all(userId, conversationId);
    const recentMessages = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (isDisplayableMessageRow(row)) {
        recentMessages.push(row);
      }
    }
    return recentMessages;
  }

  function insertMessage({ userId, conversationId, role, content, attachments = [], reasoning, usage }) {
    const id = newId();
    const normalizedAttachments = normalizeChatAttachments(attachments);
    db.prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      conversationId,
      role,
      content,
      JSON.stringify(normalizedAttachments),
      reasoning || '',
      usage ? JSON.stringify(usage) : null,
      nowIso()
    );

    return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
  }

  function updateConversationTimestamp(userId, conversationId) {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(
      nowIso(),
      conversationId,
      userId
    );
  }

  function saveConversationAccessorySkills(userId, conversationId, payload = {}) {
    const row = db
      .prepare('SELECT user_advanced_settings FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId);
    if (!row) {
      return null;
    }

    const existing = parseJson(row.user_advanced_settings, {});
    const accessorySkills = normalizeAccessorySkills(payload.accessorySkills ?? payload.skills ?? payload);
    db
      .prepare('UPDATE conversations SET user_advanced_settings = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(
        JSON.stringify(normalizeAdvancedSettings({ ...existing, accessorySkills })),
        nowIso(),
        conversationId,
        userId
      );

    const conversation = getConversation(userId, conversationId);
    return getAccessorySkillsPayload(conversation, getStatusBar(db, userId, conversationId));
  }

  function startAccessoryAgentsInBackground(options) {
    queueMicrotask(() => {
      runAccessoryAgents(options).catch((error) => {
        console.warn('[accessory-agents] background update failed:', error?.message || error);
      });
    });
  }

  function buildModelMessagesV2({
    character,
    history,
    userText,
    userAttachments = [],
    user = {},
    userName = '',
    worldBookContext = '',
    worldBookEntries = [],
    presetSystemPrompt = '',
    modSystemPrompt = '',
    npcBehaviorPrompt = '',
    talentPrompt = '',
    authorAdvancedSettings = {},
    userAdvancedSettings = {}
  }) {
    const promptUserName = resolvePromptUserName(userName || user);
    const renderField = (value) => renderPromptVariables(value, promptUserName);
    const baseSystemPrompt = [
      `你正在扮演角色「${character.name}」。`,
      character.gender ? `性别：${character.gender}` : '',
      character.age ? `年龄：${character.age}` : '',
      character.background ? `背景：${renderField(character.background)}` : '',
      character.worldview ? `世界观：${renderField(character.worldview)}` : '',
      character.persona ? `人设与表达风格：${renderField(character.persona)}` : '',
      worldBookContext ? `\n[世界书补充信息]\n${worldBookContext}` : '',
      modSystemPrompt ? `\n[Mod 指令]\n${modSystemPrompt}` : '',
      npcBehaviorPrompt ? npcBehaviorPrompt : '',
      talentPrompt ? `\n${talentPrompt}` : '',
      '保持角色一致，用自然中文回复。不要伪造内部思考；如果模型接口返回思考内容，系统会单独展示。'
    ]
      .filter(Boolean)
      .join('\n');

    const systemMessages = [{ role: 'system', content: baseSystemPrompt }];
    if (presetSystemPrompt.trim()) {
      systemMessages.push({ role: 'system', content: presetSystemPrompt.trim() });
    }

    const participantName = normalizeModelName(user.displayName || userName) || normalizeModelName(user.accountName || user.username);
    const userMessage = (content, attachments = []) => ({
      role: 'user',
      content: buildUserMessageContent(content, attachments),
      ...(participantName ? { name: participantName } : {})
    });

    const messages = [
      ...systemMessages,
      ...history.map((message) => (
        message.role === 'assistant'
          ? { role: 'assistant', content: message.content }
          : userMessage(message.content, message.attachments || parseJson(message.attachments_json, []))
      )),
      userMessage(userText, userAttachments)
    ];

    // Inject at_depth world book entries at their specified positions
    if (worldBookEntries.length) {
      injectAtDepthEntries(messages, worldBookEntries);
    }

    return messages;
  }

  const WORLD_BOOK_MATCH_SUMMARY_LIMIT = 12;

  function summarizeWorldBookMatches(entries = []) {
    const sourceEntries = Array.isArray(entries) ? entries : [];
    const matches = [];
    for (const entry of sourceEntries) {
      if (!entry?.id) {
        continue;
      }
      matches.push({
        id: entry.id,
        name: entry.name || '未命名条目',
        worldBookId: entry.worldBookId || '',
        worldBookName: entry.worldBookName || '未命名世界书',
        position: entry.position || 'before_char',
        depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : 0,
        role: Number.isFinite(Number(entry.role)) ? Number(entry.role) : 0
      });
      if (matches.length >= WORLD_BOOK_MATCH_SUMMARY_LIMIT) {
        break;
      }
    }
    return matches;
  }

  function normalizeModelName(value) {
    const name = String(value || '').trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : '';
  }

  function buildUserMessageContent(content, attachments = []) {
    const text = String(content || '').trim();
    const normalizedAttachments = normalizeChatAttachments(attachments);
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

  function normalizeChatAttachments(attachments = []) {
    const source = Array.isArray(attachments) ? attachments : [];
    const normalized = [];
    for (const attachment of source) {
      const normalizedAttachment = normalizeChatImageAttachment(attachment);
      if (!normalizedAttachment) {
        continue;
      }
      normalized.push(normalizedAttachment);
      if (normalized.length >= 4) {
        break;
      }
    }
    return normalized;
  }

  function normalizeChatImageAttachment(attachment = {}) {
    const dataUrl = String(attachment.dataUrl || attachment.url || '').trim();
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed || parsed.size > 4 * 1024 * 1024) {
      return null;
    }
    return {
      type: 'image',
      dataUrl,
      mimeType: parsed.mimeType,
      name: String(attachment.name || '').trim().slice(0, 120),
      alt: String(attachment.alt || attachment.name || '').trim().slice(0, 200),
      size: parsed.size
    };
  }

  function parseImageDataUrl(value) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(String(value || '').trim());
    if (!match) {
      return null;
    }
    const base64 = match[2];
    return {
      mimeType: match[1].toLowerCase(),
      size: Math.floor((base64.length * 3) / 4) - countBase64Padding(base64)
    };
  }

  function countBase64Padding(value) {
    let padding = 0;
    for (let index = value.length - 1; index >= 0 && value[index] === '='; index -= 1) {
      padding += 1;
    }
    return padding;
  }

  async function streamAssistantResponse({
    request,
    response,
    userId,
    conversation,
    character,
    rules,
    modelMessages,
    settings,
    userMessage,
    statusBar = null,
    worldBookMatches = [],
    thinkingEnabled = true,
    completionOptions = {}
  }) {
    request.socket?.setTimeout?.(0);
    response.socket?.setTimeout?.(0);
    response.setTimeout?.(0);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    response.flushHeaders?.();

    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    response.on('close', () => {
      if (!response.writableEnded) {
        controller.abort();
      }
    });

    // Server-side timeout: abort if AI provider hangs for 5 minutes
    const serverTimeout = setTimeout(() => {
      if (!response.destroyed) {
        controller.abort(new Error('服务端生成超时，请重试。'));
      }
    }, 300_000);

    const partialAssistant = {
      content: '',
      reasoning: ''
    };
    const emit = (event, data) => {
      captureAssistantStreamText(partialAssistant, event, data);
      writeSse(response, event, data);
    };
    emit('user_message', { userMessage });
    emit('meta', {
      provider: settings.gatewayName,
      model: settings.model,
      reasoning: settings.supportsReasoning && thinkingEnabled,
      worldBookMatches
    });
    const heartbeat = setInterval(() => writeSse(response, 'ping', { at: Date.now() }), CHAT_STREAM_HEARTBEAT_MS);

    try {
      const result = await streamCompletion(settings, modelMessages, emit, controller.signal, { thinkingEnabled, ...completionOptions });
      if (!hasAssistantPayload(result)) {
        const diagnosticId = createChatDiagnosticId();
        logAssistantPayloadFailure({
          diagnosticId,
          stage: 'provider-empty',
          mode: 'stream',
          request,
          conversation,
          character,
          settings,
          result,
          partialAssistant,
          modelMessages,
          worldBookMatches
        });
        emit('error', { error: '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。', diagnosticId });
        response.end();
        return;
      }

      const assistantMessage = saveAssistantResult({
        userId,
        conversation,
        character,
        rules,
        result,
        macroContext: {
          userName: request.auth?.user?.displayName || request.auth?.user?.username || '用户',
          charName: character.name || ''
        }
      });
      if (!assistantMessage) {
        const diagnosticId = createChatDiagnosticId();
        logAssistantPayloadFailure({
          diagnosticId,
          stage: 'postprocess-empty',
          mode: 'stream',
          request,
          conversation,
          character,
          settings,
          result,
          partialAssistant,
          modelMessages,
          worldBookMatches
        });
        emit('error', { error: '模型回复被处理后为空，请检查输出正则或重试。', diagnosticId });
        response.end();
        return;
      }
      emit('done', {
        userMessage,
        assistantMessage,
        usage: assistantMessage.usage,
        provider: result.provider,
        worldBookMatches,
        statusBar: getStatusBar(db, userId, conversation.id),
        accessoryBackground: true
      });
      response.end();
      startAccessoryAgentsInBackground({
        db,
        userId,
        conversation,
        character,
        assistantMessage,
        settings,
        statusBar: getStatusBar(db, userId, conversation.id) || statusBar
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || response.destroyed) {
        saveInterruptedAssistantResult({
          userId,
          conversation,
          character,
          rules,
          partialAssistant,
          macroContext: {
            userName: request.auth?.user?.displayName || request.auth?.user?.username || '用户',
            charName: character.name || ''
          }
        });
        if (!response.destroyed) {
          response.end();
        }
        return;
      }

      if (!response.destroyed) {
        emit('error', { error: error?.message || '生成失败' });
        response.end();
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(serverTimeout);
    }
  }

  function captureAssistantStreamText(target, event, data) {
    if (!target || !data || typeof data.text !== 'string') {
      return;
    }
    if (event === 'content') {
      target.content += data.text;
    } else if (event === 'reasoning') {
      target.reasoning += data.text;
    }
  }

  function saveInterruptedAssistantResult({ userId, conversation, character, rules, partialAssistant, macroContext = {} }) {
    if (!hasAssistantPayload(partialAssistant)) {
      return null;
    }
    return saveAssistantResult({
      userId,
      conversation,
      character,
      rules,
      result: {
        content: partialAssistant.content,
        reasoning: partialAssistant.reasoning,
        usage: null,
        provider: 'interrupted'
      },
      macroContext
    });
  }

  function saveAssistantResult({ userId, conversation, character, rules, result, macroContext = {} }) {
    const content = applyRegexRules(result.content || '', rules, 'output', macroContext);
    const reasoning = result.reasoning || '';
    if (!String(content || '').trim() && !String(reasoning || '').trim()) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    const assistantMessage = insertMessage({
      userId,
      conversationId: conversation.id,
      role: 'assistant',
      content,
      reasoning,
      usage
    });
    updateConversationTimestamp(userId, conversation.id);
    touchCharacter(db, userId, character.id);

    return assistantMessage;
  }

  function saveAssistantImageResult({ userId, conversation, character, result }) {
    const attachments = normalizeChatAttachments(result.attachments);
    if (!attachments.length) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    const assistantMessage = insertMessage({
      userId,
      conversationId: conversation.id,
      role: 'assistant',
      content: String(result.content || '已生成图片').trim() || '已生成图片',
      attachments,
      reasoning: '',
      usage
    });
    updateConversationTimestamp(userId, conversation.id);
    touchCharacter(db, userId, character.id);

    return assistantMessage;
  }

  function hasAssistantPayload(result = {}) {
    return Boolean(String(result.content || '').trim() || String(result.reasoning || '').trim());
  }

  function isDisplayableMessageRow(row = {}) {
    if (row.role !== 'assistant') {
      return true;
    }
    return Boolean(String(row.content || '').trim() || String(row.reasoning || '').trim());
  }

  function createChatDiagnosticId() {
    return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function logAssistantPayloadFailure({
    diagnosticId,
    stage,
    mode,
    request,
    conversation,
    character,
    settings,
    result,
    partialAssistant,
    modelMessages,
    worldBookMatches
  }) {
    try {
      console.warn('[chat] assistant payload missing', {
        diagnosticId,
        stage,
        mode,
        userId: request?.auth?.user?.id || '',
        conversationId: conversation?.id || '',
        characterId: character?.id || conversation?.characterId || conversation?.character_id || '',
        providerType: settings?.providerType || '',
        gatewayName: settings?.gatewayName || '',
        model: settings?.model || '',
        baseUrlHost: safeUrlHost(settings?.baseUrl),
        supportsReasoning: Boolean(settings?.supportsReasoning),
        messageCount: countIterable(modelMessages),
        worldBookMatchCount: countIterable(worldBookMatches),
        resultKeys: listOwnKeys(result),
        resultProvider: result?.provider || '',
        resultProviderType: result?.providerType || '',
        resultModel: result?.model || '',
        contentLength: String(result?.content || '').length,
        reasoningLength: String(result?.reasoning || '').length,
        partialContentLength: String(partialAssistant?.content || '').length,
        partialReasoningLength: String(partialAssistant?.reasoning || '').length,
        usageKeys: listOwnKeys(result?.usage),
        providerDiagnostics: result?.diagnostics || null
      });
    } catch (error) {
      console.warn('[chat] assistant payload missing; failed to build diagnostics', diagnosticId, error?.message || error);
    }
  }

  function safeUrlHost(value) {
    try {
      return value ? new URL(String(value)).host : '';
    } catch {
      return '';
    }
  }

  function countIterable(value) {
    if (!value || typeof value[Symbol.iterator] !== 'function') {
      return 0;
    }
    let count = 0;
    for (const _item of value) {
      count += 1;
    }
    return count;
  }

  function listOwnKeys(value, limit = 12) {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const keys = [];
    for (const key of Object.keys(value)) {
      keys.push(key);
      if (keys.length >= limit) {
        break;
      }
    }
    return keys;
  }

  function normalizeNpcOrganizerError(error) {
    const message = String(error?.message || 'AI NPC 整理失败，请稍后重试。');
    if (/terminated|ECONNRESET|socket|fetch failed|network/i.test(message)) {
      return 'AI 服务连接中断，请检查网关地址、网络或稍后重试。';
    }
    return message;
  }

  function isAbortError(error) {
    const message = String(error?.message || '');
    return error?.name === 'AbortError' || /aborted|abort/i.test(message);
  }

  return router;
}

// ── Saves sub-routes (mounted separately at /api/saves) ──

export function createSavesRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  function readRequiredConversationId(request, response) {
    const conversationId = String(request.body?.conversationId || '').trim();
    if (!conversationId) {
      response.status(400).json({ error: 'conversationId is required' });
      return '';
    }
    return conversationId;
  }

  router.get('/:saveId', requireAuth, (request, response) => {
    const save = getSave(db, request.auth.user.id, request.params.saveId);
    if (!save) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json(save);
  });

  router.post('/:saveId/load', requireAuth, (request, response) => {
    const conversationId = readRequiredConversationId(request, response);
    if (!conversationId) {
      return;
    }
    const result = loadSave(db, request.auth.user.id, request.params.saveId, conversationId);
    if (!result) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json({ ok: true, ...result });
  });

  router.put('/:saveId', requireAuth, validate(renameSaveSchema), (request, response) => {
    const save = updateSave(
      db,
      request.auth.user.id,
      request.params.saveId,
      request.body || {},
      request.body.conversationId
    );
    if (!save) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json(save);
  });

  router.delete('/:saveId', requireAuth, (request, response) => {
    const conversationId = readRequiredConversationId(request, response);
    if (!conversationId) {
      return;
    }
    if (!deleteSave(db, request.auth.user.id, request.params.saveId, conversationId)) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
