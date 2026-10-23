import { Router } from 'express';
import {
  createCharacterAssistantSession,
  deleteCharacterAssistantSession,
  getCharacterAssistantSession,
  listCharacterAssistantDraftVersions,
  listCharacterAssistantSessions,
  resetCharacterAssistantDraftFromCharacter,
  restoreCharacterAssistantDraftVersion,
  updateCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';

export function createCharacterAssistantSessionsRouter({ db, requireAuth }) {
  const router = Router();
  router.use(requireAuth);
  const handle = (callback) => (request, response, next) => {
    try { callback(request, response); } catch (error) {
      if (error.status) response.status(error.status).json({ error: error.message });
      else next(error);
    }
  };
  router.get('/', handle((request, response) => {
    response.json(listCharacterAssistantSessions(db, request.auth.user.id, {
      characterId: String(request.query.characterId || '').trim(),
      unbound: request.query.unbound === 'true'
    }));
  }));
  router.post('/', handle((request, response) => {
    response.status(201).json(createCharacterAssistantSession(db, request.auth.user.id, request.body || {}));
  }));
  router.get('/:id', handle((request, response) => {
    const session = getCharacterAssistantSession(db, request.auth.user.id, request.params.id);
    if (!session) return response.status(404).json({ error: '助手会话不存在。' });
    response.json(session);
  }));
  router.get('/:id/versions', handle((request, response) => {
    const versions = listCharacterAssistantDraftVersions(db, request.auth.user.id, request.params.id);
    if (!versions) return response.status(404).json({ error: '助手会话不存在。' });
    response.json(versions);
  }));
  router.post('/:id/versions/:versionId/restore', handle((request, response) => {
    const session = restoreCharacterAssistantDraftVersion(db, request.auth.user.id, request.params.id, request.params.versionId);
    if (!session) return response.status(404).json({ error: '助手会话不存在。' });
    response.json(session);
  }));
  router.post('/:id/reset-draft-from-character', handle((request, response) => {
    const result = resetCharacterAssistantDraftFromCharacter(db, request.auth.user.id, request.params.id);
    if (!result) return response.status(404).json({ error: '助手会话不存在。' });
    response.json(result);
  }));
  router.patch('/:id', handle((request, response) => {
    const session = updateCharacterAssistantSession(db, request.auth.user.id, request.params.id, request.body || {});
    if (!session) return response.status(404).json({ error: '助手会话不存在。' });
    response.json(session);
  }));
  router.delete('/:id', handle((request, response) => {
    if (!deleteCharacterAssistantSession(db, request.auth.user.id, request.params.id)) {
      return response.status(404).json({ error: '助手会话不存在。' });
    }
    response.json({ ok: true });
  }));
  return router;
}
