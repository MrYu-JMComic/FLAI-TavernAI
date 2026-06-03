import { Router } from 'express';
import { branchConversation, getBranchConversation, getConversationBranches } from '../modules/branches.js';

export function createBranchesRouter(ctx) {
  const { db, requireAuth } = ctx;
  const router = Router();

  // Create a branch from a specific message in a conversation
  router.post('/:id/branch', requireAuth, (request, response) => {
    const conversationId = request.params.id;
    const messageId = String(request.body?.messageId || '').trim();
    if (!messageId) {
      response.status(400).json({ error: '请指定从哪条消息创建分支' });
      return;
    }

    const branch = branchConversation(db, request.auth.user.id, conversationId, messageId);
    if (!branch) {
      response.status(404).json({ error: '对话或消息不存在' });
      return;
    }
    response.status(201).json(branch);
  });

  // Get branches of a conversation
  router.get('/:id/branches', requireAuth, (request, response) => {
    const conversationId = request.params.id;
    const conversation = db
      .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, request.auth.user.id);
    if (!conversation) {
      response.status(404).json({ error: '对话不存在' });
      return;
    }
    const branches = getConversationBranches(db, request.auth.user.id, conversationId);
    response.json(branches);
  });

  return router;
}
