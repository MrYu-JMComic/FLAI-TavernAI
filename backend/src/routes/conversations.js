import { Router } from 'express';
import {
  applyRegexRules,
  getRegexRules
} from '../modules/characters.js';
import { getCharacter, touchCharacter } from '../modules/characters.js';
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
  createDefaultAdvancedSettings,
  normalizeAccessorySkills
} from '../modules/advancedSettings.js';
import {
  applyVariableUpdates,
  deleteStatusBar,
  extractVariablesFromText,
  getStatusBar,
  upsertStatusBar
} from '../modules/statusBars.js';
import {
  CURRENCY_TYPES,
  createConversationTransaction,
  detectTransactionIntents,
  getConversationEconomyState,
  getTransactionHistory,
  processTransactionIntents
} from '../modules/economy.js';
import {
  addNpcBehavior,
  addNpcMemory,
  buildNpcBehaviorPrompt,
  deleteNpcBehavior,
  deleteNpcMemory,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  scanNpcsFromMessages,
  updateNpcBehavior
} from '../modules/npcs.js';
import {
  createCharacterImage,
  deleteCharacterImage,
  detectSceneAndEmotion,
  findBestMatch,
  listCharacterImages
} from '../modules/characterImages.js';
import {
  buildUsageSnapshot,
  generateCompletion,
  streamCompletion,
  runToolCompletion,
  streamToolCompletion,
  summarizeUsageSnapshots
} from '../services/providers.js';
import { renderPromptVariables, resolvePromptUserName } from '../services/promptVariables.js';
import { saveConversationAppearance } from '../modules/conversationAppearance.js';
import { normalizeAdvancedSettings, mergeAdvancedSettings } from '../modules/advancedSettings.js';
import { getAccessorySkillsPayload, runAccessoryAgents } from '../services/accessoryAgents.js';
import { toConversation, toMessage, withConversationUsage, parseJson, normalizeIdList } from './helpers.js';
import { sendMessageSchema, updateMessageSchema, saveConversationSettingsSchema, saveStatusBarSchema, economyTransactionSchema, addNpcMemorySchema, addNpcBehaviorSchema, updateNpcBehaviorSchema, createSaveSchema, renameSaveSchema, createConversationSchema, bulkDeleteSchema, validate } from '../validations/schemas.js';

export function createConversationsRouter(ctx) {
  const { db, requireAuth, asyncRoute, newId, nowIso, withEtag, withListCache } = ctx;
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
         ORDER BY conversations.updated_at DESC`
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
    if (!userText) {
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
    recentTexts.push(processedUserText);
    const worldBookEntries = matchWorldBookEntries(db, character.id, recentTexts, { conversationId: conversation.id });
    const userMods = getEnabledModsForUser(db, request.auth.user.id);
    const accessoryState = getAccessorySkillsPayload(conversation, statusBar);
    const npcPrompt = accessoryState.active.npcAgent ? buildNpcBehaviorPrompt(db, conversation.id) : '';
    const talentPrompt = accessoryState.active.talentPrompt ? buildTalentSystemPrompt(db, character.id) : '';
    const activeAdvancedSettings = conversation.settings || createDefaultAdvancedSettings();
    const modelMessages = buildModelMessagesV2({
      character,
      history: getRecentMessages(request.auth.user.id, conversation.id),
      userText: processedUserText,
      user: request.auth.user,
      worldBookContext: buildWorldBookContext(worldBookEntries),
      worldBookEntries,
      presetSystemPrompt: activePreset?.systemPrompt || '',
      modSystemPrompt: buildModSystemPrompt(userMods),
      npcBehaviorPrompt: npcPrompt,
      talentPrompt,
      statusBar,
      authorAdvancedSettings: conversation.authorSettings || {},
      userAdvancedSettings: conversation.userSettings || {},
      statusBarPrompt: activeAdvancedSettings.statusBarPrompt || ''
    });

    const userMessage = insertMessage({
      userId: request.auth.user.id,
      conversationId: conversation.id,
      role: 'user',
      content: userText,
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
        thinkingEnabled: aiOptions.thinkingEnabled,
        completionOptions: aiOptions
      });
      return;
    }

    const result = await generateCompletion(settings.value, modelMessages, aiOptions);
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
    const skillResults = await runAccessoryAgents({
      db,
      userId: request.auth.user.id,
      conversation,
      character,
      assistantMessage,
      settings: settings.value,
      statusBar
    });

    response.json({
      userMessage,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      statusBar: getStatusBar(db, request.auth.user.id, conversation.id),
      skillResults
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
    const settings = saveConversationAppearance(db, request.auth.user.id, request.params.id, request.body || {});
    if (!settings) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    if (request.body?.chatLorebookId !== undefined) {
      const lorebookId = request.body.chatLorebookId ? String(request.body.chatLorebookId).trim() : null;
      if (lorebookId) {
        const book = db.prepare('SELECT id FROM world_books WHERE id = ? AND user_id = ?').get(lorebookId, request.auth.user.id);
        if (!book) {
          response.status(400).json({ error: '指定的世界书不存在' });
          return;
        }
      }
      db.prepare('UPDATE conversations SET chat_lorebook_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(lorebookId, nowIso(), request.params.id, request.auth.user.id);
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

  router.get('/:id/npcs/:npc/memories', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(listNpcMemories(db, request.auth.user.id, request.params.id, request.params.npc));
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

  router.delete('/:id/npcs/:npc/memories/:memoryId', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    if (!deleteNpcMemory(db, request.auth.user.id, request.params.id, request.params.memoryId)) {
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
    const behavior = updateNpcBehavior(db, request.auth.user.id, request.params.id, request.params.behaviorId, request.body || {});
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
    if (!deleteNpcBehavior(db, request.auth.user.id, request.params.id, request.params.behaviorId)) {
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
    return db
      .prepare(
        `SELECT * FROM messages
         WHERE user_id = ? AND conversation_id = ?
         ORDER BY created_at ASC`
      )
      .all(userId, conversationId)
      .map(toMessage);
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
    const deletedIds = [];
    const statement = db.prepare('DELETE FROM conversations WHERE user_id = ? AND id = ?');
    for (const id of ids) {
      const result = statement.run(userId, id);
      if (result.changes > 0) {
        deletedIds.push(id);
      }
    }
    return deletedIds;
  }

  function getRecentMessages(userId, conversationId) {
    return db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM messages
          WHERE user_id = ? AND conversation_id = ?
          ORDER BY created_at DESC
          LIMIT 20
        ) ORDER BY created_at ASC`
      )
      .all(userId, conversationId);
  }

  function insertMessage({ userId, conversationId, role, content, reasoning, usage }) {
    const id = newId();
    db.prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, conversationId, role, content, reasoning || '', usage ? JSON.stringify(usage) : null, nowIso());

    return toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id));
  }

  function updateConversationTimestamp(userId, conversationId) {
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').run(
      nowIso(),
      conversationId,
      userId
    );
  }

  function getChatProviderSettings(userId) {
    const { providerWithSecret, hasUsableProvider } = ctx;
    const settings = providerWithSecret(ctx.getProviderRow(userId));
    if (settings.apiKeyError) {
      return { ok: false, error: settings.apiKeyError };
    }
    if (!settings.apiKey) {
      return { ok: false, error: '请先在用户页保存 API Key / SK，再开始真实对话。' };
    }
    if (!hasUsableProvider(settings)) {
      return { ok: false, error: 'AI 供应商配置不完整，请检查网关地址、模型和 API Key。' };
    }
    return { ok: true, value: settings };
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

  function buildConversationTools(statusBar) {
    if (!statusBar || !Array.isArray(statusBar.variables) || statusBar.variables.length === 0) {
      return [];
    }

    return [
      {
        type: 'function',
        function: {
          name: 'update_status_bar',
          description: '更新当前对话的状态栏变量。仅在状态发生变化时调用，不要直接在正文中伪造状态栏。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', minLength: 1, maxLength: 40 },
                    value: { type: 'number' },
                    max: { type: 'number' },
                    color: { type: 'string' }
                  },
                  required: ['name', 'value']
                }
              }
            },
            required: ['variables']
          }
        }
      }
    ];
  }

  async function executeConversationTool({ toolName, toolArguments, userId, conversationId, statusBar }) {
    if (toolName !== 'update_status_bar') {
      return { ok: false, error: `不支持的工具：${toolName}` };
    }
    const currentStatusBar = getStatusBar(db, userId, conversationId) || statusBar;
    if (!currentStatusBar) {
      return { ok: false, error: '当前会话没有状态栏' };
    }

    const payload = normalizeStatusBarToolPayload(toolArguments);
    const currentMap = new Map((currentStatusBar.variables || []).map((item) => [String(item.name || '').toLowerCase(), { ...item }]));
    for (const update of payload.variables) {
      const key = String(update.name || '').toLowerCase();
      const existing = currentMap.get(key) || { name: update.name, value: 0, max: 100, color: '' };
      currentMap.set(key, {
        ...existing,
        name: update.name,
        value: Number.isFinite(Number(update.value)) ? Number(update.value) : existing.value,
        ...(update.max !== undefined && Number.isFinite(Number(update.max)) ? { max: Number(update.max) } : {}),
        ...(typeof update.color === 'string' && update.color.trim() ? { color: update.color.trim() } : {})
      });
    }

    const variables = [...currentMap.values()];
    const updated = upsertStatusBar(db, userId, conversationId, {
      name: currentStatusBar.name,
      variables,
      template: currentStatusBar.template
    });
    return {
      ok: true,
      statusBar: updated,
      updatedVariables: variables.length
    };
  }

  function normalizeStatusBarToolPayload(toolArguments) {
    if (!toolArguments) {
      return { variables: [] };
    }

    const payload = typeof toolArguments === 'string' ? parseJson(toolArguments, {}) : toolArguments;
    const variables = Array.isArray(payload.variables) ? payload.variables : Array.isArray(payload.updates) ? payload.updates : [];
    return {
      variables: variables
        .map((item) => ({
          name: String(item?.name || '').trim(),
          value: Number(item?.value),
          ...(item?.max !== undefined ? { max: Number(item.max) } : {}),
          ...(item?.color ? { color: String(item.color).trim() } : {})
        }))
        .filter((item) => item.name && Number.isFinite(item.value))
        .slice(0, 20)
    };
  }

  function buildModelMessagesV2({
    character,
    history,
    userText,
    user = {},
    userName = '',
    worldBookContext = '',
    worldBookEntries = [],
    presetSystemPrompt = '',
    modSystemPrompt = '',
    npcBehaviorPrompt = '',
    talentPrompt = '',
    statusBar = null,
    authorAdvancedSettings = {},
    userAdvancedSettings = {},
    statusBarPrompt = ''
  }) {
    const promptUserName = resolvePromptUserName(userName || user);
    const renderField = (value) => renderPromptVariables(value, promptUserName);
    const statusBarLines = Array.isArray(statusBar?.variables) && statusBar.variables.length
      ? [
          '[状态栏]',
          `名称：${statusBar.name || '状态栏'}`,
          ...statusBar.variables.map((item) => `- ${item.name}: ${Number(item.value || 0)}/${Number(item.max || 0)}`),
          '将这些变量视为当前状态上下文；不要调用工具，也不要在正文里手写状态栏表格。'
        ]
      : [];
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
      statusBarLines.length ? `\n${statusBarLines.join('\n')}` : '',
      '保持角色一致，用自然中文回复。不要伪造内部思考；如果模型接口返回思考内容，系统会单独展示。'
    ]
      .filter(Boolean)
      .join('\n');

    const systemMessages = [{ role: 'system', content: baseSystemPrompt }];
    if (presetSystemPrompt.trim()) {
      systemMessages.push({ role: 'system', content: presetSystemPrompt.trim() });
    }

    const participantName = normalizeModelName(user.displayName || userName) || normalizeModelName(user.accountName || user.username);
    const userMessage = (content) => ({
      role: 'user',
      content,
      ...(participantName ? { name: participantName } : {})
    });

    const messages = [
      ...systemMessages,
      ...history.map((message) => (
        message.role === 'assistant'
          ? { role: 'assistant', content: message.content }
          : userMessage(message.content)
      )),
      userMessage(userText)
    ];

    // Inject at_depth world book entries at their specified positions
    if (worldBookEntries.length) {
      injectAtDepthEntries(messages, worldBookEntries);
    }

    return messages;
  }

  function normalizeModelName(value) {
    const name = String(value || '').trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : '';
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
    statusBar = null,
    thinkingEnabled = true,
    completionOptions = {},
    tools = []
  }) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
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
    const emit = (event, data) => writeSse(response, event, data);
    emit('meta', {
      provider: settings.gatewayName,
      model: settings.model,
      reasoning: settings.supportsReasoning && thinkingEnabled
    });

    try {
      const result = await streamCompletion(settings, modelMessages, emit, controller.signal, { thinkingEnabled, ...completionOptions });
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
      const skillResults = await runAccessoryAgents({
        db,
        userId,
        conversation,
        character,
        assistantMessage,
        settings,
        statusBar,
        emit
      });
      emit('done', {
        assistantMessage,
        usage: assistantMessage.usage,
        provider: result.provider,
        statusBar: getStatusBar(db, userId, conversation.id),
        skillResults
      });
      response.end();
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || response.destroyed) {
        if (!response.destroyed) {
          response.end();
        }
        return;
      }

      if (!response.destroyed) {
        emit('error', { error: error?.message || '生成失败' });
        response.end();
      }
    }
  }

  function saveAssistantResult({ userId, conversation, character, rules, result, macroContext = {} }) {
    const content = applyRegexRules(result.content || '', rules, 'output', macroContext);
    const usage = buildUsageSnapshot(result.usage, result);
    const assistantMessage = insertMessage({
      userId,
      conversationId: conversation.id,
      role: 'assistant',
      content,
      reasoning: result.reasoning || '',
      usage
    });
    updateConversationTimestamp(userId, conversation.id);
    touchCharacter(db, userId, character.id);

    return assistantMessage;
  }

  function autoScanNpcFromReply(database, userId, conversationId, content, mainCharacterName) {
    if (!content) return;
    const npcNames = scanNpcsFromMessages([{ content }], mainCharacterName);
    for (const npcName of npcNames.slice(0, 5)) {
      const existing = database
        .prepare('SELECT id FROM npc_memories WHERE conversation_id = ? AND npc_name = ? LIMIT 1')
        .get(conversationId, npcName);
      if (!existing) {
        try {
          addNpcMemory(database, userId, conversationId, npcName, {
            memoryType: 'event',
            content: '首次出现在对话中'
          });
        } catch {
          const id = newId();
          const timestamp = nowIso();
          database
            .prepare(
              `INSERT INTO npc_memories (id, conversation_id, npc_name, memory_type, content, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(id, conversationId, npcName, 'event', '首次出现在对话中', timestamp);
        }
      }
    }
  }

  function writeSse(response, event, data) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
    response.flush?.();
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

  router.get('/:saveId', requireAuth, (request, response) => {
    const save = getSave(db, request.auth.user.id, request.params.saveId);
    if (!save) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json(save);
  });

  router.post('/:saveId/load', requireAuth, (request, response) => {
    const result = loadSave(db, request.auth.user.id, request.params.saveId);
    if (!result) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json({ ok: true, ...result });
  });

  router.put('/:saveId', requireAuth, validate(renameSaveSchema), (request, response) => {
    const save = updateSave(db, request.auth.user.id, request.params.saveId, request.body || {});
    if (!save) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json(save);
  });

  router.delete('/:saveId', requireAuth, (request, response) => {
    if (!deleteSave(db, request.auth.user.id, request.params.saveId)) {
      response.status(404).json({ error: '存档不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
