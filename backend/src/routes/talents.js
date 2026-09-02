import { Router } from 'express';
import {
  createTalentPool,
  deleteTalentPool,
  getTalentPool,
  listTalentPools,
  updateTalentPool
} from '../modules/talents.js';
import { createTalentPoolSchema, updateTalentPoolSchema, validate } from '../validations/schemas.js';
import { sanitizeText } from '../services/sanitize.js';

export function createTalentsRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    const result = listTalentPools(db, request.auth.user.id, {
      limit: request.query.limit,
      cursor: request.query.cursor
    });
    if (result && !Array.isArray(result)) {
      response.setHeader('X-Next-Cursor', result.nextCursor || '');
      response.json(result);
      return;
    }
    response.json(result);
  });

  router.post('/', requireAuth, validate(createTalentPoolSchema), (request, response) => {
    try {
      const body = request.body;
      body.name = sanitizeText(body.name);
      const pool = createTalentPool(db, request.auth.user.id, body);
      response.status(201).json(pool);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.get('/:id', requireAuth, (request, response) => {
    const pool = getTalentPool(db, request.params.id, request.auth.user.id);
    if (!pool) {
      response.status(404).json({ error: '天赋池不存在' });
      return;
    }
    response.json(pool);
  });

  router.put('/:id', requireAuth, validate(updateTalentPoolSchema), (request, response) => {
    try {
      const body = request.body;
      if (body.name) body.name = sanitizeText(body.name);
      const pool = updateTalentPool(db, request.params.id, body, request.auth.user.id);
      if (!pool) {
        response.status(404).json({ error: '天赋池不存在' });
        return;
      }
      response.json(pool);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteTalentPool(db, request.params.id, request.auth.user.id)) {
      response.status(404).json({ error: '天赋池不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
