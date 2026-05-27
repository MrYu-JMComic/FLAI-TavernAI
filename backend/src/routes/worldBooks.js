import { Router } from 'express';
import {
  createWorldBook,
  deleteWorldBook,
  getWorldBook,
  listWorldBooks,
  updateWorldBook,
  createEntry,
  updateEntry,
  deleteEntry
} from '../modules/worldBooks.js';
import { createWorldBookSchema, updateWorldBookSchema, createWorldBookEntrySchema, updateWorldBookEntrySchema, validate } from '../validations/schemas.js';
import { sanitizeText } from '../services/sanitize.js';

export function createWorldBooksRouter(ctx) {
  const { db, requireAuth, withListCache } = ctx;
  const router = Router();

  router.get('/', requireAuth, (request, response) => {
    withListCache(request, response, listWorldBooks(db, request.auth.user.id));
  });

  router.post('/', requireAuth, validate(createWorldBookSchema), (request, response) => {
    try {
      const body = request.body;
      body.name = sanitizeText(body.name);
      const book = createWorldBook(db, request.auth.user.id, body);
      response.status(201).json(book);
    } catch (error) {
      response.status(400).json({ error: error.message });
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
      response.status(400).json({ error: error.message });
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
      response.status(400).json({ error: error.message });
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
      response.status(400).json({ error: error.message });
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
