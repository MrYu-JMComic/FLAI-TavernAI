import { Router } from 'express';
import { createTag, deleteTag, listTags } from '../modules/tags.js';
import { createTagSchema, validate } from '../validations/schemas.js';
import { sanitizeText } from '../services/sanitize.js';

export function createTagsRouter(ctx) {
  const { db, requireAuth, withListCache } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listTags(db));
  });

  router.post('/', requireAuth, validate(createTagSchema), (request, response) => {
    try {
      const body = request.body;
      body.name = sanitizeText(body.name);
      const tag = createTag(db, body);
      response.status(201).json(tag);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.delete('/:id', requireAuth, (request, response) => {
    if (!deleteTag(db, request.params.id)) {
      response.status(404).json({ error: '标签不存在' });
      return;
    }
    response.json({ ok: true });
  });

  return router;
}
