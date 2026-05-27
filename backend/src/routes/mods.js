import { Router } from 'express';
import {
  createMod,
  deleteMod,
  getMod,
  listMods,
  reorderMods,
  updateMod
} from '../modules/mods.js';
import { createModSchema, updateModSchema, validate } from '../validations/schemas.js';
import { sanitizeText } from '../services/sanitize.js';

export function createModsRouter(ctx) {
  const { db, requireAuth, withListCache } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listMods(db, request.auth.user.id));
  });

  router.post('/', requireAuth, validate(createModSchema), (request, response) => {
    try {
      const body = request.body;
      body.name = sanitizeText(body.name);
      const mod = createMod(db, request.auth.user.id, body);
      response.status(201).json(mod);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.put('/order', requireAuth, (request, response) => {
    const ids = Array.isArray(request.body?.order) ? request.body.order : [];
    response.json(reorderMods(db, request.auth.user.id, ids));
  });

  router.put('/:id', requireAuth, validate(updateModSchema), (request, response) => {
    try {
      const body = request.body;
      if (body.name) body.name = sanitizeText(body.name);
      const mod = updateMod(db, request.auth.user.id, request.params.id, body);
      if (!mod) {
        response.status(404).json({ error: 'Mod 不存在' });
        return;
      }
      response.json(mod);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteMod(db, request.auth.user.id, request.params.id)) {
      response.status(404).json({ error: 'Mod 不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
