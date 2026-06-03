import { Router } from 'express';
import { listSwipes, createSwipe, setActiveSwipe, getActiveSwipe } from '../modules/swipes.js';

export function createSwipesRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  // List all swipes for a message
  router.get('/:messageId/swipes', requireAuth, (request, response) => {
    const messageId = request.params.messageId;
    const swipes = listSwipes(db, request.auth.user.id, messageId);
    response.json(swipes);
  });

  // Create a new swipe (generate alternative reply)
  router.post('/:messageId/swipes', requireAuth, (request, response) => {
    const messageId = request.params.messageId;
    const { content, reasoning, usage } = request.body || {};

    if (!content) {
      response.status(400).json({ error: 'content is required' });
      return;
    }

    // Verify message belongs to user
    const message = db
      .prepare('SELECT id FROM messages WHERE id = ? AND user_id = ?')
      .get(messageId, request.auth.user.id);
    if (!message) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }

    const swipe = createSwipe(db, request.auth.user.id, messageId, {
      content,
      reasoning: reasoning || '',
      usage: usage || null
    });
    response.status(201).json(swipe);
  });

  // Get active swipe info for a message
  router.get('/:messageId/swipes/active', requireAuth, (request, response) => {
    const messageId = request.params.messageId;
    const active = getActiveSwipe(db, messageId);
    if (!active) {
      response.status(404).json({ error: '消息不存在' });
      return;
    }
    response.json(active);
  });

  // Set active swipe (switch to a different candidate)
  router.put('/:messageId/swipes/active', requireAuth, (request, response) => {
    const messageId = request.params.messageId;
    const { swipeId } = request.body || {};

    if (!swipeId) {
      response.status(400).json({ error: 'swipeId is required' });
      return;
    }

    const result = setActiveSwipe(db, request.auth.user.id, messageId, swipeId);
    if (!result) {
      response.status(404).json({ error: '滑动候选不存在' });
      return;
    }
    response.json(result);
  });

  return router;
}
