import { Router } from 'express';
import {
  applyRegexRules,
  getCharacter,
  getRegexRules
} from '../modules/characters.js';
import {
  deleteConversationMessage,
  deleteConversationMessagesFrom,
  getConversationForUser,
  getConversationMessage,
  listConversationMessagePage,
  listConversationMessages,
  updateConversationMessage
} from './helpers.js';
import { messageListQuerySchema, truncateMessagesSchema, updateMessageSchema, validate } from '../validations/schemas.js';
import { requestConversationStateRebuild } from '../services/conversationTimeline.js';
import { getConversationProcessingSummary } from '../services/jobs/jobQueue.js';
import { listAiToolPolicies } from '../services/toolRegistry.js';

export function createConversationMessagesRouter(ctx) {
  const { db, requireAuth, nowIso } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
  const router = Router({ mergeParams: true });
  router.get('/processing', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id, { includeUsage: false });
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    response.json({ conversationId: conversation.id, stateStatus: conversation.stateStatus, timelineRevision: conversation.timelineRevision,
      job: getConversationProcessingSummary(db, request.auth.user.id, conversation.id) });
  });
  router.post('/processing/rebuild', requireAuth, (request, response) => {
    const conversation = getConversationForUser(db, request.auth.user.id, request.params.id, { includeUsage: false });
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    response.json(requestConversationStateRebuild(db, request.auth.user.id, conversation.id, {
      confirmed: request.body?.confirmed === true, acceptCurrent: request.body?.acceptCurrent === true
    }));
  });
  router.get('/processing/tools', requireAuth, (request, response) => {
    if (!getConversationForUser(db, request.auth.user.id, request.params.id, { includeUsage: false })) {
      return response.status(404).json({ error: '对话不存在' });
    }
    const rows = db.prepare(`SELECT id, job_id, step_key, attempt, tool_name, domain, effect, idempotency, status, arguments_json, result_json, created_at
      FROM ai_tool_executions WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100`)
      .all(request.params.id, request.auth.user.id);
    response.json({ policies: listAiToolPolicies(), executions: rows });
  });

  router.get('/messages', requireAuth, validate(messageListQuerySchema, 'query'), (request, response) => {
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

    const query = request.validatedQuery;
    const paginated = query.limit !== undefined || Boolean(query.cursor);
    const page = paginated
      ? listConversationMessagePage(db, request.auth.user.id, request.params.id, query)
      : null;
    const sourceMessages = page?.messages
      || listConversationMessages(db, request.auth.user.id, request.params.id);
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

    if (page) response.setHeader('X-Next-Cursor', page.nextCursor);
    response.json({
      conversation,
      messages,
      ...(page ? { nextCursor: page.nextCursor } : {})
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

  router.post('/messages/truncate', requireAuth, validate(truncateMessagesSchema), (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const result = deleteConversationMessagesFrom(
      db, nowIso, request.auth.user.id, request.params.id, request.body.fromMessageId
    );
    if (!result) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }
    response.json({ ok: true, deletedIds: result.deletedIds, timeline: result.timeline });
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
      deletedReasoning: deletedMessage.deletedReasoning,
      timeline: deletedMessage.timeline
    });
  });

  return router;
}
