import { Router } from 'express';
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacterPage,
  listCharacters,
  setCharacterFavorite,
  setCharacterLike,
  updateCharacter
} from '../modules/characters.js';
import {
  getWorldBook,
  linkCharacter,
  listCharacterWorldBooks,
  unlinkCharacter
} from '../services/worldBooks/worldBookService.js';
import { assetIdFromUrl, assetKinds, deleteAsset, saveAssetInput } from '../modules/assets.js';
import { setCharacterTags } from '../modules/tags.js';
import {
  createCharacterImage,
  deleteCharacterImage,
  listCharacterImages,
  reorderCharacterImages,
  updateCharacterImage
} from '../modules/characterImages.js';
import { normalizeAdvancedSettings, normalizeAccessorySkills } from '../modules/advancedSettings.js';
import { completeCharacterDraft, streamCharacterDraft } from '../services/characterAssistant.js';
import { applyProviderNetworkPolicy } from '../services/providerNetworkPolicy.js';
import {
  normalizeChatAttachments,
  resolveChatAttachmentsForModel,
  validateChatAttachmentsForUpload
} from '../services/chatAttachments.js';
import {
  beginCharacterAssistantTurn,
  checkpointCharacterAssistantTurn,
  finishCharacterAssistantTurn,
  getCharacterAssistantSession,
  updateCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';
import { withSavepoint } from '../modules/savepoint.js';
import { rollTalent, getCharacterTalents, deleteAllCharacterTalents, deleteCharacterTalent } from '../modules/talents.js';
import {
  characterListQuerySchema,
  characterAssistantRequestSchema,
  createCharacterSchema,
  updateCharacterSchema,
  validate
} from '../validations/schemas.js';
import { sanitizeCharacterPayload } from '../services/sanitize.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeFiniteNumber } from '../utils/number.js';
import { parseJson, withModelOverride, writeSse } from './helpers.js';
import { routeErrorPayload } from './errorResponse.js';

export function createCharactersRouter({
  db,
  requireAuth,
  asyncRoute,
  withCharacterTags,
  withWorldBookId,
  withCharacterListExtras,
  hasUsableProvider,
  getProviderRow,
  providerWithSecret,
  getChatProviderSettings,
  withEtag,
  withListCache,
  nowIso,
  config = {}
}) {
  const router = Router();

  // ── Character CRUD ──

  router.get('/', requireAuth, validate(characterListQuerySchema, 'query'), (request, response) => {
    const query = request.validatedQuery;
    if (query.pagination === 'cursor') {
      const page = listCharacterPage(db, request.auth.user.id, query);
      response.setHeader('X-Next-Cursor', page.nextCursor);
      withListCache(request, response, {
        items: withCharacterListExtras(page.items),
        nextCursor: page.nextCursor
      });
      return;
    }
    const characters = listCharacters(db, request.auth.user.id, query);
    withListCache(request, response, withCharacterListExtras(characters));
  });

  router.post('/', requireAuth, validate(createCharacterSchema), (request, response) => {
    const worldBookId = String(request.body?.worldBookId || '').trim();
    if (worldBookId && !getWorldBook(db, request.auth.user.id, worldBookId)) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }

    const assistantSessionId = String(request.body?.assistantSessionId || '').trim();
    const payload = prepareCharacterPayload(request.auth.user.id, sanitizeCharacterPayload(request.body));
    try {
      const character = withSavepoint(db, 'sp_create_assistant_character', () => {
        const created = createCharacter(db, request.auth.user.id, payload);
        if (worldBookId) linkCharacter(db, request.auth.user.id, worldBookId, created.id, 0);
        setCharacterTags(db, request.auth.user.id, created.id, request.body?.tags);
        if (assistantSessionId) {
          const session = updateCharacterAssistantSession(db, request.auth.user.id, assistantSessionId, {
            characterId: created.id, character: created
          });
          if (!session) throw Object.assign(new Error('助手会话不存在。'), { status: 404 });
        }
        return created;
      });
      response.status(201).json(withCharacterTags(withWorldBookId(character)));
    } catch (error) {
      if (!error.status) throw error;
      response.status(error.status).json({ error: error.message });
    }
  });

  router.get('/:id', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(withCharacterTags(withWorldBookId(character)));
  });

  router.patch('/:id', requireAuth, validate(updateCharacterSchema), (request, response) => {
    const existing = getCharacter(db, request.auth.user.id, request.params.id);
    if (!existing) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!existing.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
      return;
    }

    const hasWorldBookId = Object.prototype.hasOwnProperty.call(request.body || {}, 'worldBookId');
    const worldBookId = hasWorldBookId ? String(request.body.worldBookId || '').trim() : '';
    if (worldBookId && !getWorldBook(db, request.auth.user.id, worldBookId)) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }

    const payload = prepareCharacterPayload(request.auth.user.id, sanitizeCharacterPayload(request.body));
    const character = updateCharacter(db, request.auth.user.id, request.params.id, payload);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (worldBookId) {
      linkCharacter(db, request.auth.user.id, worldBookId, character.id, 0);
    }
    if (Object.prototype.hasOwnProperty.call(request.body || {}, 'tags')) {
      setCharacterTags(db, request.auth.user.id, character.id, request.body.tags);
    }
    response.json(withCharacterTags(withWorldBookId(character)));
  });

  router.put('/:id/accessory-skills', requireAuth, (request, response) => {
    const existing = getCharacter(db, request.auth.user.id, request.params.id);
    if (!existing) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!existing.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以编辑附属技能默认值' });
      return;
    }

    const current = db
      .prepare('SELECT author_advanced_settings FROM characters WHERE id = ? AND user_id = ?')
      .get(request.params.id, request.auth.user.id);
    const advancedSettings = parseJson(current?.author_advanced_settings, {});
    const accessorySkills = normalizeAccessorySkills(request.body?.accessorySkills ?? request.body?.skills ?? request.body);
    db
      .prepare('UPDATE characters SET author_advanced_settings = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(
        JSON.stringify(normalizeAdvancedSettings({ ...advancedSettings, accessorySkills })),
        nowIso(),
        request.params.id,
        request.auth.user.id
      );
    response.json(withCharacterTags(withWorldBookId(getCharacter(db, request.auth.user.id, request.params.id))));
  });

  router.delete('/:id', requireAuth, (request, response) => {
    const existing = getCharacter(db, request.auth.user.id, request.params.id);
    if (!existing) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!existing.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以删除此角色' });
      return;
    }

    if (!deleteCharacter(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json({ ok: true });
  });

  // ── Character Reactions ──

  router.put('/:id/favorite', requireAuth, (request, response) => {
    const character = setCharacterFavorite(db, request.auth.user.id, request.params.id, normalizeBoolean(request.body?.favorited));
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(character);
  });

  router.put('/:id/like', requireAuth, (request, response) => {
    const character = setCharacterLike(db, request.auth.user.id, request.params.id, normalizeBoolean(request.body?.liked));
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(character);
  });

  // ── Character Images (CG) ──

  router.get('/:id/images', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(listCharacterImages(db, request.params.id));
  });

  router.post('/:id/images', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以管理立绘' });
      return;
    }

    try {
      const imageUrl = normalizeCharacterGalleryImageUrl(db, request.auth.user.id, request.params.id, request.body || {});
      if (!imageUrl) {
        response.status(400).json({ error: '请提供立绘图片' });
        return;
      }
      const image = createCharacterImage(db, {
        characterId: request.params.id,
        imageUrl,
        sceneTag: request.body?.sceneTag || '',
        emotionTag: request.body?.emotionTag || '',
        isDefault: normalizeBoolean(request.body?.isDefault)
      });
      response.status(201).json(image);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.put('/:id/images/:imageId', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以编辑立绘' });
      return;
    }

    const image = updateCharacterImage(db, request.params.id, request.params.imageId, {
      sceneTag: request.body?.sceneTag,
      emotionTag: request.body?.emotionTag,
      isDefault: request.body?.isDefault === undefined ? undefined : normalizeBoolean(request.body.isDefault)
    });
    if (!image) {
      response.status(404).json({ error: '立绘不存在' });
      return;
    }
    response.json(image);
  });

  router.delete('/:id/images/:imageId', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以删除立绘' });
      return;
    }

    const existingImageUrl = getCharacterImageUrl(db, request.params.id, request.params.imageId);
    if (!deleteCharacterImage(db, request.params.id, request.params.imageId)) {
      response.status(404).json({ error: '立绘不存在' });
      return;
    }
    const assetId = assetIdFromUrl(existingImageUrl);
    if (assetId) {
      deleteAsset(db, request.auth.user.id, assetId);
    }
    response.json({ ok: true });
  });

  router.put('/:id/images/order', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以排序立绘' });
      return;
    }

    const orderedIds = Array.isArray(request.body?.orderedIds) ? request.body.orderedIds : [];
    if (!orderedIds.length) {
      response.status(400).json({ error: '请提供排序后的立绘 ID 列表' });
      return;
    }
    const changed = reorderCharacterImages(db, request.params.id, orderedIds);
    response.json({ ok: true, changed });
  });

  // ── Character AI Draft ──

  router.post('/complete-draft', requireAuth, validate(characterAssistantRequestSchema), asyncRoute(async (request, response) => {
    let attachments;
    try {
      validateChatAttachmentsForUpload(request.body.attachments);
      attachments = normalizeChatAttachments(request.body.attachments);
      if (resolveChatAttachmentsForModel(db, request.auth.user.id, attachments).length !== attachments.length) {
        throw new Error('参考图片无效或不可访问');
      }
    } catch (error) {
      response.status(400).json({ error: error.message || '参考图片无效' });
      return;
    }
    const requirement = String(request.body?.requirement || '').trim() || (attachments.length
      ? '请参考图片中的角色特征，帮助完善角色卡。' : '');
    const assistantSessionId = String(request.body?.assistantSessionId || '').trim();
    let session = null;
    if (assistantSessionId) {
      try {
        session = getCharacterAssistantSession(db, request.auth.user.id, assistantSessionId);
      } catch (error) {
        response.status(error.status || 400).json({ error: error.message });
        return;
      }
      if (!session) {
        response.status(404).json({ error: '助手会话不存在。' });
        return;
      }
    }
    const current = request.body?.character || session?.character || {};
    if (!requirement && !hasCharacterDraftSeed(current)) {
      response.status(400).json({ error: '请先输入希望 AI 完善的角色要求，或保留已有设定作为参考。' });
      return;
    }

    const providerProfileId = String(request.body?.providerProfileId || '').trim();
    let effectiveSettings;
    if (providerProfileId) {
      const row = getProviderRow(request.auth.user.id, providerProfileId);
      if (!row) {
        response.status(404).json({ error: '所选 AI 网关不存在或已删除，请重新选择。', code: 'PROVIDER_PROFILE_NOT_FOUND' });
        return;
      }
      const settings = withModelOverride(providerWithSecret(row), request.body?.modelOverride);
      if (!hasUsableProvider(settings) || settings.providerType === 'mock') {
        response.status(400).json({
          error: settings.apiKeyError || '所选 AI 网关配置不完整，请检查网关地址、模型和 API Key。',
          code: 'PROVIDER_PROFILE_UNUSABLE'
        });
        return;
      }
      try {
        effectiveSettings = applyProviderNetworkPolicy(settings, config, request.auth.user);
      } catch (error) {
        response.status(400).json({ error: error.publicMessage || error.message, code: error.code });
        return;
      }
    } else {
      const settings = getChatProviderSettings(request.auth.user.id);
      if (!settings.ok) {
        response.status(400).json({ error: settings.error });
        return;
      }
      effectiveSettings = withModelOverride(settings.value, request.body?.modelOverride);
    }

    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('客户端已取消角色助手请求。'));
    const onClose = () => { if (!response.writableEnded) cancel(); };
    request.on('aborted', cancel);
    response.on('close', onClose);
    let turn = null;
    let heartbeat = null;
    const partial = { process: [], toolCalls: [] };
    const captureEvent = (event, data = {}) => {
      if (event === 'step') partial.process.push({ ...data });
      if (event === 'tool') {
        partial.toolCalls.push(data);
        const step = partial.process.at(-1);
        if (step) {
          const index = Array.isArray(step.tools) ? step.tools.length : 0;
          step.tools = [...(step.tools || []), data];
          step.activity = [...(step.activity || []), { type: 'tool', index }];
        }
      }
      if (['content', 'reasoning'].includes(event)) {
        const step = partial.process.at(-1);
        if (step) {
          const text = String(data.text || '');
          step[event] = String(step[event] || '') + text;
          if (event === 'content' && text) {
            const activity = Array.isArray(step.activity) ? step.activity : [];
            const last = activity.at(-1);
            step.activity = last?.type === 'content'
              ? [...activity.slice(0, -1), { ...last, text: `${last.text || ''}${text}` }]
              : [...activity, { type: 'content', text }];
          }
        }
      }
      if (event === 'context') partial.context = data;
      if (event === 'checkpoint') {
        partial.checkpoint = data;
        if (data.character) partial.character = data.character;
      }
      if (event === 'plan') partial.plan = data;
      if (turn && ['checkpoint', 'plan', 'context'].includes(event)) {
        checkpointCharacterAssistantTurn(db, request.auth.user.id, turn, partial);
      }
      return writeSse(response, event, data);
    };

    try {
      if (session) {
        turn = beginCharacterAssistantTurn(db, request.auth.user.id, session.id, {
          requirement, character: current, attachments,
          state: {
            ...(request.body?.options ? { options: request.body.options } : {}),
            ...(request.body?.planMode === true && !request.body?.plan ? {
              planPhase: 'planning', planContext: { requirement, character: current, worldBookContext: request.body?.worldBookContext || {} }
            } : {}),
            ...(request.body?.plan ? { plan: request.body.plan, planPhase: 'executing' } : {})
          }
        });
      }
      const runtimeRequest = {
        requirement,
        current,
        user: request.auth.user,
        options: request.body?.options || {},
        thinkingLevel: request.body?.thinkingLevel,
        continuation: request.body?.continuation || {},
        worldBookContext: request.body?.worldBookContext || {},
        characterId: session ? session.characterId : request.body?.characterId,
        history: turn ? turn.history : request.body?.history || [],
        attachments: turn ? turn.attachments : attachments,
        conversationMode: request.body?.conversationMode === true,
        planMode: request.body?.planMode === true,
        plan: request.body?.plan || null,
        database: db,
        userId: request.auth.user.id,
        signal: controller.signal
      };
      if (request.body?.stream === true) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        response.flushHeaders?.();
        heartbeat = setInterval(() => writeSse(response, 'ping', { at: Date.now() }), 15000);
        const result = await streamCharacterDraft(effectiveSettings, {
            ...runtimeRequest,
            providerStreaming: request.body?.providerStreaming === true,
            emit: captureEvent
          });
        if (turn) {
          result.assistantSession = finishCharacterAssistantTurn(db, request.auth.user.id, turn, result);
          turn = null;
        }
        writeSse(response, 'done', result);
        response.end();
        return;
      }

      const result = await completeCharacterDraft(effectiveSettings, runtimeRequest);
      if (turn) {
        result.assistantSession = finishCharacterAssistantTurn(db, request.auth.user.id, turn, result);
        turn = null;
      }
      response.json(result);
    } catch (error) {
      const message = controller.signal.aborted
        ? controller.signal.reason?.message || 'AI 角色助手请求已中断，请重试。'
        : safeCharacterAssistantError(error, config);
      if (turn) {
        finishCharacterAssistantTurn(db, request.auth.user.id, turn, partial, message, controller.signal.aborted);
        turn = null;
      }
      if (request.aborted || response.destroyed) {
        return;
      }
      if (response.headersSent) {
        writeSse(response, 'error', { error: message });
        response.end();
        return;
      }
      const status = controller.signal.aborted ? 504 : [403, 404, 409, 429].includes(Number(error?.status)) ? Number(error.status) : 400;
      const abortedMessage = controller.signal.aborted
        ? controller.signal.reason?.message || 'AI 角色助手请求已中断，请重试。'
        : '';
      const publicError = routeErrorPayload(error, {
        status,
        isProduction: config.isProduction,
        publicMessage: abortedMessage || undefined,
        fallback: abortedMessage || 'AI 角色助手失败，请稍后重试。'
      });
      response.status(status).json({ error: publicError.error, code: publicError.code });
    } finally {
      clearInterval(heartbeat);
      request.off('aborted', cancel);
      response.off('close', onClose);
    }
  }));

  // ── Character Talents ──

  router.post('/:id/roll-talent', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以 Roll 天赋' });
      return;
    }

    const poolId = String(request.body?.poolId || '').trim();
    if (!poolId) {
      response.status(400).json({ error: '请提供天赋池 ID' });
      return;
    }

    const result = rollTalent(db, request.params.id, poolId, request.auth.user.id);
    if (result.error) {
      response.status(400).json({ error: result.error });
      return;
    }
    response.json(result);
  });

  router.get('/:id/talents', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(getCharacterTalents(db, request.params.id, request.auth.user.id));
  });

  router.delete('/:id/talents', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以管理天赋' });
      return;
    }
    deleteAllCharacterTalents(db, request.params.id, request.auth.user.id);
    response.json({ ok: true });
  });

  router.delete('/:id/talents/:talentId', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以管理天赋' });
      return;
    }
    if (!deleteCharacterTalent(db, request.params.talentId, request.params.id, request.auth.user.id)) {
      response.status(404).json({ error: '天赋不存在' });
      return;
    }
    response.json({ ok: true });
  });

  // ── Character World Books ──

  router.get('/:id/world-books', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    response.json(listCharacterWorldBooks(db, request.params.id));
  });

  router.post('/:id/world-books', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
      return;
    }
    const bookId = String(request.body?.worldBookId || '').trim();
    if (!bookId) {
      response.status(400).json({ error: '请提供世界书 ID' });
      return;
    }
    const orderIndex = normalizeFiniteNumber(request.body?.orderIndex);
    if (!linkCharacter(db, request.auth.user.id, bookId, request.params.id, orderIndex)) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }
    response.json({ ok: true });
  });

  router.delete('/:id/world-books/:bookId', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }
    if (!character.canEdit) {
      response.status(403).json({ error: '只有角色拥有者可以编辑此角色' });
      return;
    }
    if (!unlinkCharacter(db, request.auth.user.id, request.params.bookId, request.params.id)) {
      response.status(404).json({ error: '关联不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}

function prepareCharacterPayload(userId, body = {}) {
  const payload = { ...body };
  if (payload.avatarDataUrl && !payload.avatarUrl) {
    payload.avatarUrl = payload.avatarDataUrl;
  }
  return payload;
}

function normalizeCharacterGalleryImageUrl(db, userId, characterId, body = {}) {
  return saveAssetInput(db, userId, {
    value: body.dataUrl || body.imageUrl,
    ownerType: 'character',
    ownerId: characterId,
    kind: assetKinds.characterGallery,
    name: body.name || body.filename || '',
    alt: body.alt || '',
    metadata: {
      source: 'character-gallery',
      sceneTag: body.sceneTag || '',
      emotionTag: body.emotionTag || ''
    }
  });
}

function getCharacterImageUrl(db, characterId, imageId) {
  const row = db
    .prepare('SELECT image_url FROM character_images WHERE id = ? AND character_id = ?')
    .get(imageId, characterId);
  return row?.image_url || '';
}

function hasCharacterDraftSeed(character = {}) {
  return ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage']
    .some((key) => String(character[key] || '').trim())
    || (Array.isArray(character.tags) && character.tags.some((tag) => String(tag || '').trim()))
    || (Array.isArray(character.regexRules) && character.regexRules.length > 0);
}

function normalizeCharacterAssistantError(error) {
  const message = String(error?.message || 'AI 角色助手失败，请稍后重试。');
  if (/terminated|ECONNRESET|socket|fetch failed|network/i.test(message)) {
    return 'AI 服务连接中断，请检查网关地址、网络或稍后重试。';
  }
  return message;
}

function safeCharacterAssistantError(error, config = {}) {
  if (config.isProduction && !error?.publicMessage) {
    return 'AI 角色助手失败，请稍后重试。';
  }
  return normalizeCharacterAssistantError(error);
}
