import { Router } from 'express';
import {
  createSave,
  deleteSave,
  getSave,
  listSaves,
  loadSave,
  updateSave
} from '../modules/saves.js';
import { createSaveSchema, renameSaveSchema, validate } from '../validations/schemas.js';

export function createConversationSavesRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router({ mergeParams: true });

  function hasConversationAccess(request, response) {
    const conversation = db
      .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
      .get(request.params.id, request.auth.user.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return false;
    }
    return true;
  }

  router.get('/', requireAuth, (request, response) => {
    if (!hasConversationAccess(request, response)) {
      return;
    }
    response.json(listSaves(db, request.auth.user.id, request.params.id));
  });

  router.post('/', requireAuth, validate(createSaveSchema), (request, response) => {
    if (!hasConversationAccess(request, response)) {
      return;
    }
    const save = createSave(db, request.auth.user.id, request.params.id, request.body || {});
    response.status(201).json(save);
  });

  return router;
}

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
