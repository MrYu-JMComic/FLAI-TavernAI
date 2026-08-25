import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import { completeSceneOrganization } from '../services/sceneOrganizer.js';
import {
  deleteSceneEntity,
  listSceneWorkspace,
  upsertSceneItem,
  upsertSceneNode,
  upsertSceneRoute
} from '../modules/scenes.js';
import {
  getChatProviderSettingsFromContext,
  getConversationForUser,
  withModelOverride
} from './helpers.js';
import {
  sceneNodeSchema,
  sceneItemSchema,
  sceneOrganizerSchema,
  sceneRouteSchema,
  validate
} from '../validations/schemas.js';

export function createConversationSceneRouter(ctx) {
  const { db, requireAuth, asyncRoute } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
  const getChatProviderSettings = (userId) => getChatProviderSettingsFromContext(ctx, userId);
  const router = Router({ mergeParams: true });

  router.get('/scenes', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.json(listSceneWorkspace(db, request.auth.user.id, request.params.id));
  });

  router.post('/scenes/nodes', requireAuth, validate(sceneNodeSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const node = upsertSceneNode(db, request.auth.user.id, request.params.id, request.body || {});
    if (!node) return response.status(400).json({ error: '场景节点无效' });
    response.status(201).json(node);
  });

  router.post('/scenes/items', requireAuth, validate(sceneItemSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.status(201).json(upsertSceneItem(
      db,
      request.auth.user.id,
      request.params.id,
      request.body || {}
    ));
  });

  router.put('/scenes/items/:itemId', requireAuth, validate(sceneItemSchema.partial()), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.json(upsertSceneItem(
      db,
      request.auth.user.id,
      request.params.id,
      { ...request.body, id: request.params.itemId }
    ));
  });

  router.put('/scenes/nodes/:nodeId', requireAuth, validate(sceneNodeSchema.partial()), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const node = upsertSceneNode(db, request.auth.user.id, request.params.id, { ...request.body, id: request.params.nodeId });
    if (!node) return response.status(404).json({ error: '场景节点不存在' });
    response.json(node);
  });

  router.post('/scenes/routes', requireAuth, validate(sceneRouteSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const route = upsertSceneRoute(db, request.auth.user.id, request.params.id, request.body || {});
    if (!route) return response.status(400).json({ error: '路线无效，请确认起点和终点存在' });
    response.status(201).json(route);
  });

  router.delete('/scenes/:type/:entityId', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const type = request.params.type === 'nodes'
      ? 'node'
      : request.params.type === 'items'
        ? 'item'
      : request.params.type === 'routes'
        ? 'route'
        : '';
    if (!type || !deleteSceneEntity(db, request.auth.user.id, request.params.id, type, request.params.entityId)) {
      return response.status(404).json({ error: '场景记录不存在' });
    }
    response.json({ ok: true });
  });

  router.post('/scenes/organize', requireAuth, validate(sceneOrganizerSchema), asyncRoute(async (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) return response.status(400).json({ error: settings.error });
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const messages = db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30')
      .all(request.params.id)
      .reverse();
    const result = await completeSceneOrganization(withModelOverride(settings.value, request.body?.modelOverride), {
      database: db,
      userId: request.auth.user.id,
      conversationId: request.params.id,
      conversation,
      character,
      requirement: request.body?.requirement || '',
      messages,
      signal: undefined
    });
    response.json(result);
  }));

  return router;
}

function requireConversation(request, response, getConversation) {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return null;
  }
  return conversation;
}
