import { Router } from 'express';
import {
  normalizeAccessorySkills,
  normalizeAdvancedSettings
} from '../modules/advancedSettings.js';
import { saveConversationAppearance } from '../modules/conversationAppearance.js';
import {
  deleteStatusBar,
  getStatusBar,
  upsertStatusBar
} from '../modules/statusBars.js';
import { nowIso } from '../security.js';
import { getAccessorySkillsPayload } from '../services/accessoryAgents.js';
import { getConversationForUser, parseJson } from './helpers.js';
import { withSavepoint } from '../modules/savepoint.js';
import {
  saveConversationSettingsSchema,
  saveStatusBarSchema,
  validate
} from '../validations/schemas.js';

export function createConversationSettingsRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router({ mergeParams: true });
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);

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

  router.get('/settings', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(conversation.settings);
  });

  router.put('/settings', requireAuth, validate(saveConversationSettingsSchema), (request, response) => {
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
    response.json({ ...settings, chatLorebookId: updated?.chatLorebookId ?? null });
  });

  router.get('/accessory-skills', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(getAccessorySkillsPayload(conversation, getStatusBar(db, request.auth.user.id, request.params.id)));
  });

  router.put('/accessory-skills', requireAuth, (request, response) => {
    const payload = saveConversationAccessorySkills(request.auth.user.id, request.params.id, request.body || {});
    if (!payload) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(payload);
  });

  router.get('/status-bar', requireAuth, (request, response) => {
    const statusBar = getStatusBar(db, request.auth.user.id, request.params.id);
    if (!statusBar) {
      response.json(null);
      return;
    }
    response.json(statusBar);
  });

  router.put('/status-bar', requireAuth, validate(saveStatusBarSchema), (request, response) => {
    const statusBar = upsertStatusBar(db, request.auth.user.id, request.params.id, request.body || {});
    if (!statusBar) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(statusBar);
  });

  router.delete('/status-bar', requireAuth, (request, response) => {
    if (!deleteStatusBar(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '对话不存在或状态栏不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
