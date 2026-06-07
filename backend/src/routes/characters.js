import { Router } from 'express';
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  getRegexRules as getRegexRulesForExport,
  listCharacters,
  setCharacterFavorite,
  setCharacterLike,
  updateCharacter
} from '../modules/characters.js';
import {
  createEntry,
  createWorldBook,
  getWorldBook,
  linkWorldBookToCharacter,
  listCharacterWorldBooks,
  unlinkWorldBookFromCharacter
} from '../modules/worldBooks.js';
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
import { rollTalent, getCharacterTalents, deleteAllCharacterTalents, deleteCharacterTalent } from '../modules/talents.js';
import { createCharacterSchema, updateCharacterSchema, importCharacterSchema, validate } from '../validations/schemas.js';
import { sanitizeCharacterPayload } from '../services/sanitize.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { normalizeFiniteNumber } from '../utils/number.js';
import { parseJson, withModelOverride, writeSse } from './helpers.js';

export function createCharactersRouter({
  db,
  requireAuth,
  asyncRoute,
  withCharacterTags,
  withWorldBookId,
  hasUsableProvider,
  getChatProviderSettings,
  withEtag,
  withListCache,
  nowIso
}) {
  const router = Router();

  // ── Character CRUD ──

  router.get('/', requireAuth, (request, response) => {
    const characters = listCharacters(db, request.auth.user.id, {
      search: request.query.search,
      sort: request.query.sort,
      tag: request.query.tag
    });
    withListCache(request, response, characters.map((c) => withCharacterTags(withWorldBookId(c))));
  });

  router.post('/', requireAuth, validate(createCharacterSchema), (request, response) => {
    const worldBookId = String(request.body?.worldBookId || '').trim();
    if (worldBookId && !getWorldBook(db, request.auth.user.id, worldBookId)) {
      response.status(404).json({ error: '世界书不存在' });
      return;
    }

    const payload = prepareCharacterPayload(request.auth.user.id, sanitizeCharacterPayload(request.body));
    const character = createCharacter(db, request.auth.user.id, payload);
    if (worldBookId) {
      linkWorldBookToCharacter(db, worldBookId, character.id, 0, request.auth.user.id);
    }
    setCharacterTags(db, request.auth.user.id, character.id, request.body?.tags);
    response.status(201).json(withCharacterTags(withWorldBookId(character)));
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
      linkWorldBookToCharacter(db, worldBookId, character.id, 0, request.auth.user.id);
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

  // ── Character Import / Export ──

  router.get('/:id/export', requireAuth, (request, response) => {
    const character = getCharacter(db, request.auth.user.id, request.params.id);
    if (!character) {
      response.status(404).json({ error: '角色不存在' });
      return;
    }

    const regexRules = getRegexRulesForExport(db, character.ownerId, character.id);
    const characterTags = db
      .prepare(
        `SELECT tags.name, tags.color FROM character_tags
         JOIN tags ON tags.id = character_tags.tag_id
         WHERE character_tags.character_id = ? AND tags.user_id = ?
         ORDER BY tags.name COLLATE NOCASE ASC, tags.name ASC, tags.rowid ASC`
      )
      .all(character.id, character.ownerId);

    const worldBook = getCharacterExportWorldBook(db, character);

    const exportData = {
      _flai_export_version: 1,
      exported_at: new Date().toISOString(),
      character: {
        name: character.name,
        gender: character.gender || '',
        age: character.age || '',
        background: character.background || '',
        worldview: character.worldview || '',
        persona: character.persona || '',
        openingMessage: character.openingMessage || '',
        visibility: character.visibility,
        renderPlugins: character.renderPlugins || []
      },
      regex_rules: regexRules,
      tags: characterTags.map((t) => t.name),
      world_book: worldBook
    };

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(character.name)}.flai-char.json"`);
    response.json(exportData);
  });

  router.post('/import', requireAuth, validate(importCharacterSchema), (request, response) => {
    const data = request.body;
    if (!data || !data.character) {
      response.status(400).json({ error: '无效的角色卡数据：缺少 character 字段' });
      return;
    }

    const characterData = data.character;
    if (!String(characterData.name || '').trim()) {
      response.status(400).json({ error: '角色名不能为空' });
      return;
    }

    const userId = request.auth.user.id;

    const character = createCharacter(db, userId, {
      name: characterData.name,
      gender: characterData.gender || '',
      age: characterData.age || '',
      background: characterData.background || '',
      worldview: characterData.worldview || '',
      persona: characterData.persona || '',
      openingMessage: characterData.openingMessage || '',
      visibility: 'private',
      renderPlugins: Array.isArray(characterData.renderPlugins) ? characterData.renderPlugins : [],
      regexRules: Array.isArray(data.regex_rules) ? data.regex_rules : [],
      tags: Array.isArray(data.tags) ? data.tags : []
    });
    setCharacterTags(db, userId, character.id, data.tags);

    if (data.world_book && data.world_book.name) {
      const book = createWorldBook(db, userId, {
        name: data.world_book.name,
        description: data.world_book.description || '',
        characterId: character.id
      });

      if (Array.isArray(data.world_book.entries)) {
        for (const entry of data.world_book.entries) {
          createEntry(db, userId, book.id, {
            name: entry.name || '',
            triggerKeys: entry.trigger_keys || entry.triggerKeys || '',
            content: entry.content || '',
            position: entry.position || 'before_char',
            enabled: normalizeBoolean(entry.enabled, true)
          });
        }
      }
    }

    response.status(201).json(withCharacterTags(withWorldBookId(character)));
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

    const imageUrl = String(request.body?.imageUrl || '').trim();
    if (!imageUrl) {
      response.status(400).json({ error: '请提供立绘图片' });
      return;
    }

    try {
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

    if (!deleteCharacterImage(db, request.params.id, request.params.imageId)) {
      response.status(404).json({ error: '立绘不存在' });
      return;
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

  router.post('/complete-draft', requireAuth, asyncRoute(async (request, response) => {
    const requirement = String(request.body?.requirement || '').trim();
    const current = request.body?.character || {};
    if (!requirement && !hasCharacterDraftSeed(current)) {
      response.status(400).json({ error: '请先输入希望 AI 完善的角色要求，或保留已有设定作为参考。' });
      return;
    }

    const settings = getChatProviderSettings(request.auth.user.id);
    if (!settings.ok) {
      response.status(400).json({ error: settings.error });
      return;
    }
    const effectiveSettings = withModelOverride(settings.value, request.body?.modelOverride);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('AI 角色助手请求超时，请稍后重试。')), 300000);
    request.on('aborted', () => controller.abort(new Error('客户端已取消角色助手请求。')));

    try {
      if (request.body?.stream === true) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        response.flushHeaders?.();
        const heartbeat = setInterval(() => writeSse(response, 'ping', { at: Date.now() }), 15000);
        try {
          const result = await streamCharacterDraft(effectiveSettings, {
            requirement,
            current,
            user: request.auth.user,
            options: request.body?.options || {},
            signal: controller.signal,
            emit: (event, data) => writeSse(response, event, data)
          });
          writeSse(response, 'done', result);
          response.end();
        } catch (error) {
          if (!request.aborted && !response.destroyed) {
            const message = controller.signal.aborted
              ? controller.signal.reason?.message || 'AI 角色助手请求已中断，请重试。'
              : normalizeCharacterAssistantError(error);
            writeSse(response, 'error', { error: message });
            response.end();
          }
        } finally {
          clearInterval(heartbeat);
        }
        return;
      }

      response.json(
        await completeCharacterDraft(effectiveSettings, {
          requirement,
          current,
          user: request.auth.user,
          options: request.body?.options || {},
          signal: controller.signal
        })
      );
    } catch (error) {
      if (request.aborted || response.destroyed) {
        return;
      }
      const message = controller.signal.aborted
        ? controller.signal.reason?.message || 'AI 角色助手请求已中断，请重试。'
        : normalizeCharacterAssistantError(error);
      response.status(controller.signal.aborted ? 504 : 400).json({ error: message });
    } finally {
      clearTimeout(timeout);
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

    const result = rollTalent(db, request.params.id, poolId);
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
    response.json(getCharacterTalents(db, request.params.id));
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
    deleteAllCharacterTalents(db, request.params.id);
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
    if (!deleteCharacterTalent(db, request.params.talentId)) {
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
    if (!linkWorldBookToCharacter(db, bookId, request.params.id, orderIndex, request.auth.user.id)) {
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
    if (!unlinkWorldBookFromCharacter(db, request.params.bookId, request.params.id, request.auth.user.id)) {
      response.status(404).json({ error: '关联不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}

function getCharacterExportWorldBook(db, character) {
  const linkedWorldBookRow = db
    .prepare(
      `SELECT wb.id, wb.name, wb.description
       FROM character_world_books cwb
       JOIN world_books wb ON wb.id = cwb.world_book_id
       WHERE cwb.character_id = ? AND wb.user_id = ?
       ORDER BY cwb.order_index ASC, cwb.created_at ASC, cwb.rowid ASC`
    )
    .get(character.id, character.ownerId);
  let worldBookRow = linkedWorldBookRow;
  if (!worldBookRow) {
    worldBookRow = db
      .prepare(
        `SELECT id, name, description FROM world_books
         WHERE character_id = ? AND user_id = ?
         ORDER BY updated_at DESC, rowid DESC`
      )
      .get(character.id, character.ownerId);
  }
  if (!worldBookRow) {
    return null;
  }

  const entries = db
    .prepare(
      `SELECT name, trigger_keys, content, position, enabled, order_index
       FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index ASC, rowid ASC`
    )
    .all(worldBookRow.id);
  return {
    name: worldBookRow.name,
    description: worldBookRow.description || '',
    entries
  };
}

function prepareCharacterPayload(userId, body = {}) {
  const payload = { ...body };
  if (payload.avatarDataUrl && !payload.avatarUrl) {
    payload.avatarUrl = payload.avatarDataUrl;
  }
  return payload;
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
