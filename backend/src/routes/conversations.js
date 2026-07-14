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
import { createConversationMessagesRouter } from './conversationMessages.js';
import { createConversationNpcRouter } from './conversationNpcs.js';
import { createConversationSettingsRouter } from './conversationSettings.js';
import { createConversationSavesRouter } from './conversationSaves.js';
import { createConversationSchema, bulkDeleteSchema, validate } from '../validations/schemas.js';

export { createSavesRouter } from './conversationSaves.js';

export function createConversationsRouter(ctx) {
  const { db, requireAuth, newId, nowIso } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
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

    const usageSummaries = getConversationUsageSummaries(db, request.auth.user.id);
    response.json(
      rows.map((row) => ({
        ...toConversation(row, db),
        usage: usageSummaries.get(row.id) || emptyUsageSummary()
      }))
    );
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
    response.status(201).json(getConversation(request.auth.user.id, conversationId));
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
  router.use('/:id/saves', createConversationSavesRouter(ctx));
  router.use('/:id', createConversationNpcRouter(ctx));

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
