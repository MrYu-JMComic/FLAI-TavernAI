import { Router } from 'express';
import {
  applyRegexRules,
  getCharacter,
  getRegexRules
} from '../modules/characters.js';
import {
  deleteConversationMessage,
  getConversationForUser,
  getConversationMessage,
  listConversationMessages,
  updateConversationMessage
} from './helpers.js';
import { updateMessageSchema, validate } from '../validations/schemas.js';

export function createConversationMessagesRouter(ctx) {
  const { db, requireAuth, nowIso } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
  const router = Router({ mergeParams: true });

  router.get('/messages', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const rules = character ? getRegexRules(db, character.ownerId, character.id) : [];
    const displayRules = [];
    for (const rule of rules) {
      if (rule.enabled && rule.scope === 'display') {
        displayRules.push(rule);
      }
    }
    const macroContext = {
      userName: request.auth.user.displayName || request.auth.user.username || '用户',
      charName: character?.name || ''
    };

    const sourceMessages = listConversationMessages(db, request.auth.user.id, request.params.id);
    const messages = [];
    for (const message of sourceMessages) {
      if (!displayRules.length) {
        messages.push(message);
      } else {
        messages.push({
          ...message,
          content: applyRegexRules(message.content, displayRules, 'display', macroContext)
        });
      }
    }

    response.json({
      conversation,
      messages
    });
  });

  router.patch('/messages/:messageId', requireAuth, validate(updateMessageSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const message = getConversationMessage(db, request.auth.user.id, request.params.id, request.params.messageId);
    if (!message) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }

    const content = String(request.body?.content ?? '').trim();
    if (!content) {
      response.status(400).json({ error: '消息内容不能为空' });
      return;
    }

    response.json(updateConversationMessage(db, nowIso, request.auth.user.id, request.params.id, request.params.messageId, { content }));
  });

  router.delete('/messages/:messageId', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }

    const deletedMessage = deleteConversationMessage(db, nowIso, request.auth.user.id, request.params.id, request.params.messageId);
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

  return router;
}
