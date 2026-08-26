import { Router } from 'express';
import {
  createConversationTransaction,
  getConversationEconomyState,
  getTransactionHistory
} from '../modules/economy.js';
import {
  economyHistoryQuerySchema,
  economyTransactionSchema,
  validate
} from '../validations/schemas.js';

export function createConversationEconomyRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router({ mergeParams: true });

  router.get('/', requireAuth, (request, response) => {
    const ensureDefaultAccount = !['0', 'false', 'no'].includes(String(request.query.ensure || '').toLowerCase());
    const state = getConversationEconomyState(db, request.auth.user.id, request.params.id, { ensureDefaultAccount });
    if (!state) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    response.json(state);
  });

  router.post('/transaction', requireAuth, validate(economyTransactionSchema), (request, response) => {
    try {
      const result = createConversationTransaction(db, request.auth.user.id, request.params.id, request.body || {});
      if (!result) {
        response.status(404).json({ error: '对话不存在' });
        return;
      }
      response.status(201).json(result);
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.get('/history', requireAuth, validate(economyHistoryQuerySchema, 'query'), (request, response) => {
    const query = request.validatedQuery;
    const history = getTransactionHistory(db, request.auth.user.id, request.params.id, {
      currencyType: query.currencyType,
      pagination: query.pagination,
      limit: query.limit,
      offset: query.offset,
      cursor: query.cursor
    });
    if (!history) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    if (query.pagination === 'cursor') response.setHeader('X-Next-Cursor', history.nextCursor);
    if (query.offset !== undefined) response.setHeader('Deprecation', 'true');
    response.json(history);
  });

  return router;
}
