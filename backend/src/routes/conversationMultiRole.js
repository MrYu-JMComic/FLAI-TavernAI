import { Router } from 'express';
import { CastDomainError } from '../domain/cast/errors.js';
import {
  configureMultiRoleQueue,
  generateMultiRoleTurns,
  getMultiRoleState,
} from '../services/cast/multiRoleService.js';
import {
  getChatProviderSettingsFromContext,
  getConversationForUser,
} from './helpers.js';

export function createConversationMultiRoleRouter(ctx) {
  const { db, requireAuth, asyncRoute } = ctx;
  const router = Router({ mergeParams: true });

  router.get('/multi-role', requireAuth, (request, response) => {
    if (!requireConversation(db, request, response)) return;
    respond(response, () => getMultiRoleState(
      db,
      request.auth.user.id,
      request.params.id
    ));
  });

  router.put('/multi-role/queue', requireAuth, (request, response) => {
    if (!requireConversation(db, request, response)) return;
    respond(response, () => ({
      queue: configureMultiRoleQueue(
        db,
        request.auth.user.id,
        request.params.id,
        request.body?.memberIds
      ),
    }));
  });

  router.post('/multi-role/generate', requireAuth, asyncRoute(async (request, response) => {
    if (!requireConversation(db, request, response)) return;
    const settings = getChatProviderSettingsFromContext(ctx, request.auth.user.id);
    if (!settings.ok) return response.status(400).json({ error: settings.error });
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('Client disconnected'));
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    try {
      const result = await generateMultiRoleTurns(settings.value, {
        database: db,
        userId: request.auth.user.id,
        conversationId: request.params.id,
        input: request.body?.input,
        memberIds: request.body?.memberIds,
      }, { signal: controller.signal });
      response.json(result);
    } catch (error) {
      if (error instanceof CastDomainError) {
        return response.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      throw error;
    } finally {
      request.off('aborted', abort);
    }
  }));

  return router;
}

function requireConversation(database, request, response) {
  const conversation = getConversationForUser(
    database,
    request.auth.user.id,
    request.params.id,
    { includeUsage: false }
  );
  if (!conversation) {
    response.status(404).json({ error: '对话不存在' });
    return null;
  }
  return conversation;
}

function respond(response, operation) {
  try {
    response.json(operation());
  } catch (error) {
    if (error instanceof CastDomainError) {
      response.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
}
