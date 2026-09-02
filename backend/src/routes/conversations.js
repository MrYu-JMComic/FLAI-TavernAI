import { Router } from 'express';
import {
  getCharacter,
  touchCharacter
} from '../modules/characters.js';
import {
  hasStatusBarBlueprint,
  normalizeAdvancedSettings
} from '../modules/advancedSettings.js';
import {
  upsertStatusBar
} from '../modules/statusBars.js';
import { renderPromptVariables } from '../services/promptVariables.js';
import { ensureConversationProtagonist } from '../services/cast/commands/memberCommands.js';
import { withSavepoint } from '../modules/savepoint.js';
import {
  createConversationMessage,
  emptyUsageSummary,
  getConversationForUser,
  getConversationUsageSummaries,
  toConversation,
  normalizeIdList
} from './helpers.js';
import { createConversationEconomyRouter } from './conversationEconomy.js';
import { createConversationGenerationRouter } from './conversationGeneration.js';
import { createConversationGameplayRouter } from './conversationGameplay.js';
import { createConversationMessagesRouter } from './conversationMessages.js';
import { createConversationSceneRouter } from './conversationScenes.js';
import { createConversationCastRouter } from './conversationCast.js';
import { createConversationMultiRoleRouter } from './conversationMultiRole.js';
import { createConversationSettingsRouter } from './conversationSettings.js';
import { createConversationSavesRouter } from './conversationSaves.js';
import {
  bulkDeleteSchema,
  conversationListQuerySchema,
  createConversationSchema,
  validate
} from '../validations/schemas.js';
import { listConversationRows } from '../repositories/conversationRepository.js';

export { createSavesRouter } from './conversationSaves.js';

export function createConversationsRouter(ctx) {
  const { db, requireAuth, newId, nowIso } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
  const router = Router();

  // ── Conversation List ──

  router.get('/', requireAuth, validate(conversationListQuerySchema, 'query'), (request, response) => {
    const query = request.validatedQuery;
    const page = listConversationRows(db, request.auth.user.id, query);
    const usageSummaries = query.pagination === 'cursor'
      ? getConversationUsageSummaries(db, request.auth.user.id, page.rows.map((row) => row.id))
      : getConversationUsageSummaries(db, request.auth.user.id);
    const items = page.rows.map((row) => ({
        ...toConversation(row, db, request.auth.user.id),
        usage: usageSummaries.get(row.id) || emptyUsageSummary()
      }));
    if (query.pagination === 'cursor') {
      response.setHeader('X-Next-Cursor', page.nextCursor);
      response.json({ items, nextCursor: page.nextCursor });
      return;
    }
    response.json(items);
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
    const conversation = withSavepoint(db, 'sp_create_conversation', () => {
      db.prepare(
        `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(conversationId, request.auth.user.id, character.id, `${character.name} 的故事`, timestamp, timestamp);

      ensureConversationProtagonist(db, request.auth.user.id, conversationId);
      const statusBarBlueprint = normalizeAdvancedSettings(character.authorAdvancedSettings || {}).statusBarBlueprint;
      if (hasStatusBarBlueprint(statusBarBlueprint)) {
        upsertStatusBar(db, request.auth.user.id, conversationId, {
          name: statusBarBlueprint.name || '状态栏',
          variables: statusBarBlueprint.variables,
          template: statusBarBlueprint.template
        });
      }

      if (character.openingMessage) {
        createConversationMessage(db, newId, nowIso, {
          userId: request.auth.user.id,
          conversationId,
          role: 'assistant',
          content: renderPromptVariables(character.openingMessage, request.auth.user),
          reasoning: '',
          usage: null
        });
      }

      touchCharacter(db, request.auth.user.id, character.id);
      return getConversation(request.auth.user.id, conversationId);
    });
    response.status(201).json(conversation);
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteConversation(request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json({ ok: true, deletedId: request.params.id });
  });

  router.use('/:id', createConversationGenerationRouter(ctx));
  router.use('/:id', createConversationMessagesRouter(ctx));
  router.use('/:id', createConversationSettingsRouter(ctx));
  router.use('/:id/economy', createConversationEconomyRouter(ctx));
  router.use('/:id/gameplay', createConversationGameplayRouter(ctx));
  router.use('/:id/saves', createConversationSavesRouter(ctx));
  router.use('/:id', createConversationSceneRouter(ctx));
  router.use('/:id', createConversationCastRouter(ctx));
  router.use('/:id', createConversationMultiRoleRouter(ctx));

  // ── Internal helpers ──

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

  return router;
}
