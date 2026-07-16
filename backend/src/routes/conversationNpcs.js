import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import {
  addNpcBehavior,
  addNpcMemory,
  deleteNpcBehavior,
  deleteNpcMemory,
  hideConversationNpc,
  hideEmptyConversationNpcs,
  listNpcAudit,
  listConversationNpcs,
  listNpcBehaviors,
  listNpcMemories,
  rollbackNpcAudit,
  updateConversationNpc,
  updateNpcBehavior,
  updateNpcMemory
} from '../modules/npcs.js';
import { completeNpcOrganization, streamNpcOrganization } from '../services/npcOrganizer.js';
import { completeSceneOrganization } from '../services/sceneOrganizer.js';
import { deleteSceneEntity, listActorItems, listSceneItemAudit, listSceneWorkspace, rollbackSceneItemAudit, upsertSceneItem, upsertSceneNode, upsertSceneRoute } from '../modules/scenes.js';
import {
  getChatProviderSettingsFromContext,
  getConversationForUser,
  withModelOverride,
  writeSse
} from './helpers.js';
import {
  addNpcBehaviorSchema,
  addNpcMemorySchema,
  npcOrganizerSchema,
  sceneItemSchema,
  sceneNodeSchema,
  sceneOrganizerSchema,
  sceneRouteSchema,
  updateNpcBehaviorSchema,
  updateNpcMemorySchema,
  updateNpcSchema,
  validate
} from '../validations/schemas.js';

export function createConversationNpcRouter(ctx) {
  const { db, requireAuth, asyncRoute } = ctx;
  const getConversation = (userId, conversationId) => getConversationForUser(db, userId, conversationId);
  const getChatProviderSettings = (userId) => getChatProviderSettingsFromContext(ctx, userId);
  const router = Router({ mergeParams: true });

  router.get('/scenes', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.json(listSceneWorkspace(db, request.auth.user.id, request.params.id));
  });

  router.get('/items', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.json(listActorItems(
      db,
      request.auth.user.id,
      request.params.id,
      request.query.ownerType || 'protagonist',
      request.query.ownerName || ''
    ));
  });

  router.get('/items/audit', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    response.json(listSceneItemAudit(
      db,
      request.auth.user.id,
      request.params.id,
      request.query.ownerType || 'protagonist',
      request.query.ownerName || '',
      { limit: request.query.limit, offset: request.query.offset }
    ));
  });

  router.post('/items/audit/:auditId/rollback', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const result = rollbackSceneItemAudit(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.auditId,
      { actor: 'manual' }
    );
    if (!result) return response.status(404).json({ error: '物品审计记录无法回滚' });
    response.json(result);
  });

  router.post('/scenes/nodes', requireAuth, validate(sceneNodeSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const node = upsertSceneNode(db, request.auth.user.id, request.params.id, request.body || {});
    if (!node) return response.status(400).json({ error: '场景节点无效' });
    response.status(201).json(node);
  });

  router.put('/scenes/nodes/:nodeId', requireAuth, validate(sceneNodeSchema.partial()), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const node = upsertSceneNode(db, request.auth.user.id, request.params.id, { ...request.body, id: request.params.nodeId });
    if (!node) return response.status(404).json({ error: '场景节点不存在' });
    response.json(node);
  });

  router.post('/scenes/items', requireAuth, validate(sceneItemSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const item = upsertSceneItem(db, request.auth.user.id, request.params.id, request.body || {});
    if (!item) return response.status(400).json({ error: '物品无效，请确认世界物品有地点、NPC 物品有持有者名称' });
    response.status(201).json(item);
  });

  router.put('/scenes/items/:itemId', requireAuth, validate(sceneItemSchema.partial()), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const item = upsertSceneItem(db, request.auth.user.id, request.params.id, { ...request.body, id: request.params.itemId });
    if (!item) return response.status(404).json({ error: '场景物品不存在' });
    response.json(item);
  });

  router.post('/scenes/routes', requireAuth, validate(sceneRouteSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const route = upsertSceneRoute(db, request.auth.user.id, request.params.id, request.body || {});
    if (!route) return response.status(400).json({ error: '路线无效，请确认起点和终点存在' });
    response.status(201).json(route);
  });

  router.delete('/scenes/:type/:entityId', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) return;
    const type = request.params.type === 'nodes' ? 'node' : request.params.type === 'items' ? 'item' : request.params.type === 'routes' ? 'route' : '';
    if (!type || !deleteSceneEntity(db, request.auth.user.id, request.params.id, type, request.params.entityId)) return response.status(404).json({ error: '场景记录不存在' });
    response.json({ ok: true });
  });

  router.post('/scenes/organize', requireAuth, validate(sceneOrganizerSchema), asyncRoute(async (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) return response.status(404).json({ error: '对话不存在' });
    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) return response.status(400).json({ error: settings.error });
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const messages = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30').all(request.params.id).reverse();
    const result = await completeSceneOrganization(withModelOverride(settings.value, request.body?.modelOverride), {
      database: db, userId: request.auth.user.id, conversationId: request.params.id,
      conversation, character, requirement: request.body?.requirement || '', messages, signal: undefined
    });
    response.json(result);
  }));

  router.get('/npcs', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    response.json(listConversationNpcs(db, request.auth.user.id, request.params.id, character?.name || ''));
  });

  router.delete('/npcs-empty', requireAuth, (request, response) => {
    const conversation = getConversation(request.auth.user.id, request.params.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const character = getCharacter(db, request.auth.user.id, conversation.characterId);
    const result = hideEmptyConversationNpcs(db, request.auth.user.id, request.params.id, character?.name || '');
    response.json({ ok: true, ...result });
  });

  router.post('/npcs/organize', requireAuth, validate(npcOrganizerSchema), asyncRoute(async (request, response) => {
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
      selectedActorType: request.body?.selectedActorType || '',
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

  router.get('/npcs/:npc/memories', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    response.json(listNpcMemories(db, request.auth.user.id, request.params.id, request.params.npc));
  });

  router.put('/npcs/:npc', requireAuth, validate(updateNpcSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation, 'Conversation not found')) {
      return;
    }
    const npc = updateConversationNpc(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    if (!npc) {
      response.status(400).json({ error: 'Invalid NPC name' });
      return;
    }
    response.json(npc);
  });

  router.delete('/npcs/:npc', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    const hidden = hideConversationNpc(db, request.auth.user.id, request.params.id, request.params.npc);
    if (!hidden) {
      response.status(400).json({ error: 'NPC 名称无效' });
      return;
    }
    response.json({ ok: true, hidden });
  });

  router.get('/npcs/:npc/audit', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    response.json(listNpcAudit(db, request.auth.user.id, request.params.id, request.params.npc, {
      limit: request.query.limit,
      offset: request.query.offset
    }));
  });

  router.post('/npcs/:npc/audit/:auditId/rollback', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    const result = rollbackNpcAudit(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.npc,
      request.params.auditId,
      { actor: 'manual' }
    );
    if (!result) {
      response.status(404).json({ error: '审计记录不存在' });
      return;
    }
    response.json(result);
  });

  router.post('/npcs/:npc/memories', requireAuth, validate(addNpcMemorySchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    const memory = addNpcMemory(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    response.status(201).json(memory);
  });

  router.put('/npcs/:npc/memories/:memoryId', requireAuth, validate(updateNpcMemorySchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
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

  router.delete('/npcs/:npc/memories/:memoryId', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    if (!deleteNpcMemory(db, request.auth.user.id, request.params.id, request.params.memoryId, request.params.npc)) {
      response.status(404).json({ error: '记忆不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.get('/npcs/:npc/behaviors', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    response.json(listNpcBehaviors(db, request.auth.user.id, request.params.id, request.params.npc));
  });

  router.post('/npcs/:npc/behaviors', requireAuth, validate(addNpcBehaviorSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    const behavior = addNpcBehavior(db, request.auth.user.id, request.params.id, request.params.npc, request.body || {});
    response.status(201).json(behavior);
  });

  router.put('/npcs/:npc/behaviors/:behaviorId', requireAuth, validate(updateNpcBehaviorSchema), (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
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

  router.delete('/npcs/:npc/behaviors/:behaviorId', requireAuth, (request, response) => {
    if (!requireConversation(request, response, getConversation)) {
      return;
    }
    if (!deleteNpcBehavior(db, request.auth.user.id, request.params.id, request.params.behaviorId, request.params.npc)) {
      response.status(404).json({ error: '行为规则不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}

function requireConversation(request, response, getConversation, error = '对话不存在') {
  const conversation = getConversation(request.auth.user.id, request.params.id);
  if (!conversation) {
    response.status(404).json({ error });
    return null;
  }
  return conversation;
}

function normalizeNpcOrganizerError(error) {
  const message = String(error?.message || 'AI NPC 整理失败，请稍后重试。');
  if (/terminated|ECONNRESET|socket|fetch failed|network/i.test(message)) {
    return 'AI 服务连接中断，请检查网关地址、网络或稍后重试。';
  }
  return message;
}
