import { Router } from 'express';
import {
  applyWorldBookChanges,
  createWorldBook,
  deleteWorldBook,
  getWorldBook,
  listWorldBooks,
  updateWorldBook,
  createEntry,
  updateEntry,
  deleteEntry
} from '../services/worldBooks/worldBookService.js';
import { applyWorldBookChangesSchema, createWorldBookSchema, updateWorldBookSchema, createWorldBookEntrySchema, updateWorldBookEntrySchema, validate } from '../validations/schemas.js';
import { sanitizeText } from '../services/sanitize.js';
import { completeWorldBookDraft, streamWorldBookDraft } from '../services/worldBookAssistant.js';
import { withModelOverride, writeSse } from './helpers.js';
import { sendRouteError } from './errorResponse.js';
import { prepareWorldBookChangesForSave } from '../services/worldBooks/prepareWorldBookChanges.js';

const WORLD_BOOK_ASSISTANT_TIMEOUT_MS = 10 * 60 * 1000;

export function createWorldBooksRouter(ctx) {
  const { db, requireAuth, asyncRoute, withListCache, getChatProviderSettings } = ctx;
  const config = ctx.config || {};
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listWorldBooks(db, request.auth.user.id));
  });

  router.post('/complete-draft', requireAuth, asyncRoute(async (request, response) => {
    const requirement = String(request.body?.requirement || '').trim();
    const current = request.body?.worldBook || {};
    const hasSelection = Array.isArray(request.body?.selectedBookIds) && request.body.selectedBookIds.length > 0;
    const hasWorkspace = Array.isArray(request.body?.workspace?.targets) && request.body.workspace.targets.length > 0;
    if (!requirement && !hasWorldBookDraftSeed(current) && !hasSelection && !hasWorkspace) {
      response.status(400).json({ error: '请描述希望查阅、更新或创建的世界书内容，或选择已有世界书。' });
      return;
    }

    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }
    const effectiveSettings = withModelOverride(settings.value, request.body?.modelOverride);
    const runtimeOptions = {
      thinkingLevel: request.body?.thinkingLevel,
      providerStreaming: typeof request.body?.providerStreaming === 'boolean' ? request.body.providerStreaming : undefined,
      context: request.body?.context || {},
      selectedBookIds: request.body?.selectedBookIds,
      workspace: request.body?.workspace,
      history: request.body?.history,
      automatic: request.body?.automatic,
      planMode: request.body?.planMode === true,
      plan: request.body?.plan || null
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('世界书助手请求超时，请稍后重试。')), WORLD_BOOK_ASSISTANT_TIMEOUT_MS);
    request.on('aborted', () => controller.abort(new Error('客户端已取消世界书助手请求。')));

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
          const result = await streamWorldBookDraft(effectiveSettings, {
            requirement,
            current,
            ...runtimeOptions,
            database: db,
            userId: request.auth.user.id,
            signal: controller.signal,
            emit: (event, data) => writeSse(response, event, data)
          });
          writeSse(response, 'done', result);
          response.end();
        } catch (error) {
          if (!request.aborted && !response.destroyed) {
            const message = controller.signal.aborted
              ? controller.signal.reason?.message || '世界书助手请求已中断，请重试。'
              : safeWorldBookAssistantError(error, config);
            writeSse(response, 'error', { error: message });
            response.end();
          }
        } finally {
          clearInterval(heartbeat);
        }
        return;
      }

      response.json(await completeWorldBookDraft(effectiveSettings, {
        requirement,
        current,
        ...runtimeOptions,
        database: db,
        userId: request.auth.user.id,
        signal: controller.signal
      }));
    } catch (error) {
      if (request.aborted || response.destroyed) {
        return;
      }
      const status = controller.signal.aborted ? 504 : Number(error?.status) === 429 ? 429 : 400;
      const abortedMessage = controller.signal.aborted
        ? controller.signal.reason?.message || '世界书助手请求已中断，请重试。'
        : '';
      sendRouteError(response, error, {
        status,
        isProduction: config.isProduction,
        publicMessage: abortedMessage || undefined,
        fallback: abortedMessage || '世界书助手请求失败，请稍后重试。'
      });
    } finally {
      clearTimeout(timeout);
    }
  }));

  router.post('/apply-changes', requireAuth, validate(applyWorldBookChangesSchema), (request, response) => {
    try {
      const payload = prepareWorldBookChangesForSave(db, request.auth.user.id, request.body);
      response.json(applyWorldBookChanges(db, request.auth.user.id, payload));
    } catch (error) {
      sendRouteError(response, error, {
        status: Number.isInteger(error?.status) ? error.status : 400,
        isProduction: config.isProduction,
        fallback: '世界书变更应用失败，请稍后重试。'
      });
    }
  });

  router.post('/', requireAuth, validate(createWorldBookSchema), (request, response) => {
    try {
      const body = request.body;
      body.name = sanitizeText(body.name);
      const book = createWorldBook(db, request.auth.user.id, body);
      response.status(201).json(book);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '世界书保存失败' });
    }
  });

  router.get('/:id', requireAuth, (request, response) => {
    const book = getWorldBook(db, request.auth.user.id, request.params.id);
    if (!book) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }
    response.json(book);
  });

  router.put('/:id', requireAuth, validate(updateWorldBookSchema), (request, response) => {
    try {
      const body = request.body;
      if (body.name) body.name = sanitizeText(body.name);
      const book = updateWorldBook(db, request.auth.user.id, request.params.id, body);
      if (!book) {
        response.status(404).json({ error: '世界书不存在' });
        return;
      }
      response.json(book);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '世界书更新失败' });
    }
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteWorldBook(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.post('/:id/entries', requireAuth, validate(createWorldBookEntrySchema), (request, response) => {
    try {
      const entry = createEntry(db, request.auth.user.id, request.params.id, request.body);
      if (!entry) {
        response.status(404).json({ error: '世界书不存在' });
        return;
      }
      response.status(201).json(entry);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '世界书条目保存失败' });
    }
  });

  router.put('/:id/entries/:entryId', requireAuth, validate(updateWorldBookEntrySchema), (request, response) => {
    try {
      const entry = updateEntry(db, request.auth.user.id, request.params.id, request.params.entryId, request.body);
      if (!entry) {
        response.status(404).json({ error: '条目不存在' });
        return;
      }
      response.json(entry);
    } catch (error) {
      sendRouteError(response, error, { status: 400, isProduction: config.isProduction, fallback: '世界书条目更新失败' });
    }
  });

  router.delete('/:id/entries/:entryId', requireAuth, (request, response) => {
    if (!deleteEntry(db, request.auth.user.id, request.params.id, request.params.entryId)) {
      response.status(404).json({ error: '条目不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}

function hasWorldBookDraftSeed(value = {}) {
  return Boolean(
    String(value.name || '').trim()
    || String(value.description || '').trim()
    || (Array.isArray(value.entries) && value.entries.length > 0)
  );
}

function normalizeWorldBookAssistantError(error) {
  const message = String(error?.message || '世界书助手请求失败，请稍后重试。');
  if (/terminated|ECONNRESET|socket|fetch failed|network/i.test(message)) {
    return 'AI 服务连接中断，请检查网关地址、网络或稍后重试。';
  }
  return message;
}

function safeWorldBookAssistantError(error, config = {}) {
  if (config.isProduction && !error?.publicMessage) {
    return '世界书助手请求失败，请稍后重试。';
  }
  return normalizeWorldBookAssistantError(error);
}
