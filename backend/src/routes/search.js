import { Router } from 'express';
import { z } from 'zod';
import { searchUserContent } from '../services/fullTextSearch.js';
import { validate } from '../validations/schemas.js';

const searchQuerySchema = z.object({
  q: z.string().min(1).max(1000).trim(),
  conversationId: z.string().max(200).trim().optional().default(''),
  types: z.string().max(100).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

export function createSearchRouter(ctx) {
  const router = Router();
  router.get('/', ctx.requireAuth, validate(searchQuerySchema, 'query'), (request, response) => {
    const query = request.validatedQuery;
    response.json(searchUserContent(ctx.db, request.auth.user.id, query.q, {
      conversationId: query.conversationId,
      types: query.types.split(',').map((value) => value.trim()).filter(Boolean),
      limit: query.limit
    }));
  });
  return router;
}
