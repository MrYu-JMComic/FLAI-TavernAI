import { Router } from 'express';
import { getCharacter } from '../modules/characters.js';
import {
  cleanupEmptyCastMembers,
  createCastBehavior,
  createCastMember,
  createCastMemory,
  deleteCastBehaviorEntry,
  deleteCastMemberItem,
  deleteCastMemoryEntry,
  rollbackCastAuditEvent,
  transferCastItem,
  updateCastBehaviorEntry,
  updateCastMemberAppearance,
  updateCastMemberProfile,
  updateCastMemoryEntry,
  upsertCastMemberItem,
} from '../services/cast/castCommandService.js';
import {
  getCastAudit,
  getCastBehaviorEntry,
  getCastBehaviors,
  getCastItemEntry,
  getCastItems,
  getCastMemberDetail,
  getCastMemories,
  getCastMemoryEntry,
  getCastRoster,
} from '../services/cast/castQueryService.js';
import { organizeConversationCast } from '../services/cast/castOrganizer.js';
import { listRecentConversationEvidenceMessages } from '../repositories/castRepository.js';
import {
  getLatestCastSyncStatus,
  subscribeCastSyncStatus,
} from '../services/cast/castSyncStatus.js';
import { serializeCastPlanError } from '../services/cast/castPlanGenerator.js';
import {
  getChatProviderSettingsFromContext,
  getConversationForUser,
  writeSse,
} from './helpers.js';
import {
  castAppearanceUpdateSchema,
  castAuditListQuerySchema,
  castBehaviorCreateSchema,
  castBehaviorUpdateSchema,
  castCleanupSchema,
  castItemCreateSchema,
  castItemListQuerySchema,
  castItemTransferSchema,
  castItemUpdateSchema,
  castMemberCreateSchema,
  castMemberUpdateSchema,
  castMemoryCreateSchema,
  castMemoryListQuerySchema,
  castMemoryUpdateSchema,
  castOrganizerSchema,
  castRevisionBodySchema,
  castRosterQuerySchema,
  validate,
} from '../validations/schemas.js';

export function createConversationCastRouter(ctx) {
  const { db, requireAuth } = ctx;
  const organizeCast = ctx.organizeConversationCast || organizeConversationCast;
  const asyncRoute = ctx.asyncRoute || ((handler) => (
    (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
  ));
  const router = Router({ mergeParams: true });
  for (const name of ['memberId', 'memoryId', 'behaviorId', 'itemId', 'eventId']) {
    router.param(name, validateCastResourceId);
  }

  router.get('/cast', requireAuth, validate(castRosterQuerySchema, 'query'), (request, response) => {
    response.json(getCastRoster(db, request.auth.user.id, request.params.id, {
      includeHidden: request.validatedQuery.includeHidden !== false,
    }));
  });

  router.post('/cast', requireAuth, validate(castMemberCreateSchema), (request, response) => {
    const member = createCastMember(db, request.auth.user.id, request.params.id, request.body);
    response.status(201).json(member);
  });

  router.post('/cast/cleanup', requireAuth, validate(castCleanupSchema), (request, response) => {
    response.json(cleanupEmptyCastMembers(db, request.auth.user.id, request.params.id));
  });

  router.get('/cast/sync-events', requireAuth, (request, response) => {
    getCastRoster(db, request.auth.user.id, request.params.id);
    request.socket?.setTimeout?.(0);
    response.socket?.setTimeout?.(0);
    response.setTimeout?.(0);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders?.();
    const latest = getLatestCastSyncStatus(request.params.id);
    if (latest) void writeSse(response, 'cast-sync', latest);
    const unsubscribe = subscribeCastSyncStatus(request.params.id, (status) => {
      void writeSse(response, 'cast-sync', status);
    });
    const heartbeat = setInterval(() => {
      void writeSse(response, 'ping', { at: Date.now() });
    }, 15_000);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.once('aborted', close);
    response.once('close', close);
  });

  router.post(
    '/cast/organize',
    requireAuth,
    validate(castOrganizerSchema),
    asyncRoute(async (request, response) => {
      const conversation = getConversationForUser(
        db,
        request.auth.user.id,
        request.params.id,
        { includeUsage: false }
      );
      if (!conversation) return response.status(404).json({ error: '对话不存在' });
      const settings = getChatProviderSettingsFromContext(ctx, request.auth.user.id);
      if (!settings.ok) return response.status(400).json({ error: settings.error });
      const character = getCharacter(db, request.auth.user.id, conversation.characterId);
      if (!character) return response.status(404).json({ error: '角色不存在' });
      const controller = new AbortController();
      request.once('aborted', () => controller.abort());
      response.once('close', () => {
        if (!response.writableEnded) controller.abort();
      });
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Content-Encoding': 'identity',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders?.();
      try {
        const messages = listRecentConversationEvidenceMessages(db, conversation.id, { limit: 80 });
        await organizeCast({
          database: db,
          userId: request.auth.user.id,
          conversationId: conversation.id,
          settings: settings.value,
          scope: request.body.scope,
          scopeMemberId: request.body.memberId || '',
          requirement: request.body.requirement,
          messages,
          signal: controller.signal,
          onProgress: (phase, data) => writeSse(response, 'progress', { phase, ...data }),
        });
      } catch (error) {
        const failure = serializeCastPlanError(error);
        await writeSse(response, 'error', {
          ...failure,
          error: error?.message || '人物整理失败',
          code: error?.code || 'CAST_ORGANIZE_FAILED',
        });
      } finally {
        if (!response.writableEnded) response.end();
      }
    })
  );

  router.post(
    '/cast/audit/:eventId/rollback',
    requireAuth,
    validate(castCleanupSchema),
    (request, response) => {
    response.json(rollbackCastAuditEvent(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.eventId
    ));
    }
  );

  router.get('/cast/:memberId', requireAuth, (request, response) => {
    response.json(getCastMemberDetail(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId
    ));
  });

  router.patch('/cast/:memberId', requireAuth, validate(castMemberUpdateSchema), (request, response) => {
    response.json(updateCastMemberProfile(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.body
    ));
  });

  router.get(
    '/cast/:memberId/memories',
    requireAuth,
    validate(castMemoryListQuerySchema, 'query'),
    (request, response) => {
    response.json(getCastMemories(db, request.auth.user.id, request.params.id, request.params.memberId, {
      limit: request.validatedQuery.limit,
      offset: request.validatedQuery.offset,
      includeForgotten: request.validatedQuery.includeForgotten === true,
    }));
    }
  );

  router.post('/cast/:memberId/memories', requireAuth, validate(castMemoryCreateSchema), (request, response) => {
    response.status(201).json(createCastMemory(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.body
    ));
  });

  router.get('/cast/:memberId/memories/:memoryId', requireAuth, (request, response) => {
    response.json(getCastMemoryEntry(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.params.memoryId
    ));
  });

  router.patch(
    '/cast/:memberId/memories/:memoryId',
    requireAuth,
    validate(castMemoryUpdateSchema),
    (request, response) => {
      response.json(updateCastMemoryEntry(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.params.memoryId,
        request.body
      ));
    }
  );

  router.delete(
    '/cast/:memberId/memories/:memoryId',
    requireAuth,
    validate(castRevisionBodySchema),
    (request, response) => {
      response.json(deleteCastMemoryEntry(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.params.memoryId,
        { expectedRevision: request.body.revision }
      ));
    }
  );

  router.get('/cast/:memberId/behaviors', requireAuth, (request, response) => {
    response.json(getCastBehaviors(db, request.auth.user.id, request.params.id, request.params.memberId));
  });

  router.post('/cast/:memberId/behaviors', requireAuth, validate(castBehaviorCreateSchema), (request, response) => {
    response.status(201).json(createCastBehavior(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.body
    ));
  });

  router.get('/cast/:memberId/behaviors/:behaviorId', requireAuth, (request, response) => {
    response.json(getCastBehaviorEntry(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.params.behaviorId
    ));
  });

  router.patch(
    '/cast/:memberId/behaviors/:behaviorId',
    requireAuth,
    validate(castBehaviorUpdateSchema),
    (request, response) => {
      response.json(updateCastBehaviorEntry(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.params.behaviorId,
        request.body
      ));
    }
  );

  router.delete(
    '/cast/:memberId/behaviors/:behaviorId',
    requireAuth,
    validate(castRevisionBodySchema),
    (request, response) => {
      response.json(deleteCastBehaviorEntry(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.params.behaviorId,
        { expectedRevision: request.body.revision }
      ));
    }
  );

  router.get(
    '/cast/:memberId/items',
    requireAuth,
    validate(castItemListQuerySchema, 'query'),
    (request, response) => {
      response.json(getCastItems(db, request.auth.user.id, request.params.id, request.params.memberId, {
        limit: request.validatedQuery.limit,
        offset: request.validatedQuery.offset,
      }));
    }
  );

  router.post('/cast/:memberId/items', requireAuth, validate(castItemCreateSchema), (request, response) => {
    response.status(201).json(upsertCastMemberItem(
      db,
      request.auth.user.id,
      request.params.id,
      request.params.memberId,
      request.body
    ));
  });

  router.patch(
    '/cast/:memberId/items/:itemId',
    requireAuth,
    validate(castItemUpdateSchema),
    (request, response) => {
      const current = getCastItemEntry(db, request.auth.user.id, request.params.id, request.params.itemId);
      if (current.ownerKind !== 'cast' || current.ownerMemberId !== request.params.memberId) {
        return response.status(404).json({ error: '物品不存在', code: 'CAST_NOT_FOUND' });
      }
      response.json(upsertCastMemberItem(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        { ...request.body, itemId: request.params.itemId }
      ));
    }
  );

  router.post(
    '/cast/:memberId/items/:itemId/transfer',
    requireAuth,
    validate(castItemTransferSchema),
    (request, response) => {
      const current = getCastItemEntry(db, request.auth.user.id, request.params.id, request.params.itemId);
      if (current.ownerKind !== 'cast' || current.ownerMemberId !== request.params.memberId) {
        return response.status(404).json({ error: '物品不存在', code: 'CAST_NOT_FOUND' });
      }
      response.json(transferCastItem(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.itemId,
        request.body
      ));
    }
  );

  router.delete(
    '/cast/:memberId/items/:itemId',
    requireAuth,
    validate(castRevisionBodySchema),
    (request, response) => {
      response.json(deleteCastMemberItem(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.params.itemId,
        { expectedRevision: request.body.revision }
      ));
    }
  );

  router.patch(
    '/cast/:memberId/appearance',
    requireAuth,
    validate(castAppearanceUpdateSchema),
    (request, response) => {
      response.json(updateCastMemberAppearance(
        db,
        request.auth.user.id,
        request.params.id,
        request.params.memberId,
        request.body
      ));
    }
  );

  router.get(
    '/cast/:memberId/audit',
    requireAuth,
    validate(castAuditListQuerySchema, 'query'),
    (request, response) => {
    response.json(getCastAudit(db, request.auth.user.id, request.params.id, {
      memberId: request.params.memberId,
      limit: request.validatedQuery.limit,
      beforeCreatedAt: request.validatedQuery.beforeCreatedAt,
      beforeId: request.validatedQuery.beforeId,
    }));
    }
  );

  return router;
}

function validateCastResourceId(request, response, next, value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 160) {
    response.status(400).json({ error: '人物资源 ID 无效', code: 'CAST_INVALID_ID' });
    return;
  }
  next();
}
