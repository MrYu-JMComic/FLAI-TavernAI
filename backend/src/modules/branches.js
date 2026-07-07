import { newId, nowIso } from '../security.js';
import { withSavepoint } from './savepoint.js';

export function branchConversation(db, userId, conversationId, branchFromMessageId) {
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) return null;

  const branchMessage = db
    .prepare('SELECT rowid AS message_rowid, * FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?')
    .get(branchFromMessageId, conversationId, userId);
  if (!branchMessage) return null;

  const newConversationId = newId();
  const timestamp = nowIso();

  withSavepoint(db, 'sp_branch_conversation', () => {
    // Create new conversation as a branch
    db.prepare(
      `INSERT INTO conversations (id, user_id, character_id, title, branched_from_id, branched_from_message_id, branched_from_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newConversationId,
      userId,
      conversation.character_id,
      `${conversation.title} (分支)`,
      conversationId,
      branchFromMessageId,
      conversation.title,
      timestamp,
      timestamp
    );

    // Copy messages up to and including the branch point
    const messages = db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
           AND user_id = ?
           AND (created_at < ? OR (created_at = ? AND rowid <= ?))
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(conversationId, userId, branchMessage.created_at, branchMessage.created_at, branchMessage.message_rowid);

    for (const msg of messages) {
      const newMsgId = newId();
      db.prepare(
        'INSERT INTO messages (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        newMsgId,
        userId,
        newConversationId,
        msg.role,
        msg.content,
        msg.attachments_json || '[]',
        msg.reasoning || '',
        msg.usage_json,
        msg.created_at
      );

      // Copy swipes for assistant messages
      if (msg.role === 'assistant') {
        const swipes = db.prepare('SELECT * FROM message_swipes WHERE message_id = ? AND user_id = ?').all(msg.id, userId);
        for (const swipe of swipes) {
          const newSwipeId = newId();
          db.prepare(
            'INSERT INTO message_swipes (id, message_id, user_id, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(newSwipeId, newMsgId, userId, swipe.content, swipe.reasoning || '', swipe.usage_json, swipe.created_at);
        }
      }
    }

    // Copy status bar if exists
    const statusBar = db.prepare('SELECT * FROM status_bars WHERE conversation_id = ?').get(conversationId);
    if (statusBar) {
      db.prepare(
        'INSERT INTO status_bars (id, conversation_id, name, variables, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), newConversationId, statusBar.name, statusBar.variables, statusBar.template, timestamp, timestamp);
    }
  });

  return getBranchConversation(db, userId, newConversationId);
}

export function getBranchConversation(db, userId, conversationId) {
  const row = db
    .prepare(
      `SELECT c.*, ch.name AS character_name, ch.avatar_url,
              src.title AS branched_from_title_name
       FROM conversations c
       JOIN characters ch ON ch.id = c.character_id
       LEFT JOIN conversations src ON src.id = c.branched_from_id
       WHERE c.id = ? AND c.user_id = ?`
    )
    .get(conversationId, userId);
  if (!row) return null;

  return {
    id: row.id,
    characterId: row.character_id,
    title: row.title,
    branchedFromId: row.branched_from_id || null,
    branchedFromMessageId: row.branched_from_message_id || null,
    branchedFromTitle: row.branched_from_title_name || row.branched_from_title || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    character: {
      name: row.character_name,
      avatarUrl: row.avatar_url || ''
    }
  };
}

export function getConversationBranches(db, userId, conversationId) {
  return db
    .prepare(
      `SELECT c.id, c.title, c.branched_from_message_id, c.created_at,
              ch.name AS character_name
       FROM conversations c
       JOIN characters ch ON ch.id = c.character_id
       WHERE c.branched_from_id = ? AND c.user_id = ?
       ORDER BY c.created_at DESC, c.rowid DESC`
    )
    .all(conversationId, userId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      branchedFromMessageId: row.branched_from_message_id,
      createdAt: row.created_at,
      characterName: row.character_name
    }));
}

export function getConversationBranchTree(db, userId, conversationId) {
  const active = db
    .prepare('SELECT id, branched_from_id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!active) {
    return null;
  }

  const rootId = getBranchRootId(db, userId, active);
  const rows = db
    .prepare(
      `WITH RECURSIVE branch_tree(id, depth) AS (
         SELECT id, 0
         FROM conversations
         WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT child.id, branch_tree.depth + 1
         FROM conversations child
         JOIN branch_tree ON child.branched_from_id = branch_tree.id
         WHERE child.user_id = ? AND branch_tree.depth < 64
       )
       SELECT branch_tree.depth,
              c.id,
              c.character_id,
              c.title,
              c.branched_from_id,
              c.branched_from_message_id,
              c.branched_from_title,
              c.created_at,
              c.updated_at,
              ch.name AS character_name,
              src.title AS branched_from_title_name,
              branch_message.role AS branch_message_role,
              branch_message.content AS branch_message_content,
              branch_message.created_at AS branch_message_created_at,
              (SELECT COUNT(*) FROM messages msg WHERE msg.conversation_id = c.id AND msg.user_id = c.user_id) AS message_count,
              (SELECT COUNT(*) FROM messages msg WHERE msg.conversation_id = c.id AND msg.user_id = c.user_id AND msg.role = 'assistant') AS assistant_message_count,
              (SELECT MAX(msg.created_at) FROM messages msg WHERE msg.conversation_id = c.id AND msg.user_id = c.user_id) AS last_message_at
       FROM branch_tree
       JOIN conversations c ON c.id = branch_tree.id AND c.user_id = ?
       JOIN characters ch ON ch.id = c.character_id
       LEFT JOIN conversations src ON src.id = c.branched_from_id AND src.user_id = c.user_id
       LEFT JOIN messages branch_message
         ON branch_message.id = c.branched_from_message_id
        AND branch_message.user_id = c.user_id
       ORDER BY branch_tree.depth ASC, c.created_at ASC, c.rowid ASC`
    )
    .all(rootId, userId, userId, userId);

  const nodes = [];
  const byId = new Map();
  let activeNode = null;
  for (const row of rows) {
    if (byId.has(row.id)) {
      continue;
    }
    const node = toBranchTreeNode(row);
    nodes.push(node);
    byId.set(node.id, node);
    if (node.id === conversationId) {
      activeNode = node;
    }
  }

  for (const node of nodes) {
    if (!node.branchedFromId) {
      continue;
    }
    const parent = byId.get(node.branchedFromId);
    if (parent) {
      parent.children.push(node);
    }
  }

  const root = byId.get(rootId) || null;
  const activeComparison = buildActiveBranchComparison(nodes, activeNode);
  return {
    rootId,
    activeConversationId: conversationId,
    tree: root,
    nodes,
    branches: getConversationBranches(db, userId, conversationId),
    comparison: activeComparison
  };
}

function getBranchRootId(db, userId, conversation) {
  const seen = new Set([conversation.id]);
  let rootId = conversation.id;
  let parentId = conversation.branched_from_id || '';
  while (parentId && !seen.has(parentId)) {
    const parent = db
      .prepare('SELECT id, branched_from_id FROM conversations WHERE id = ? AND user_id = ?')
      .get(parentId, userId);
    if (!parent) {
      break;
    }
    seen.add(parent.id);
    rootId = parent.id;
    parentId = parent.branched_from_id || '';
  }
  return rootId;
}

function toBranchTreeNode(row = {}) {
  return {
    id: row.id,
    characterId: row.character_id,
    characterName: row.character_name,
    title: row.title,
    branchedFromId: row.branched_from_id || null,
    branchedFromMessageId: row.branched_from_message_id || null,
    branchedFromTitle: row.branched_from_title_name || row.branched_from_title || '',
    depth: Number(row.depth) || 0,
    messageCount: Number(row.message_count) || 0,
    assistantMessageCount: Number(row.assistant_message_count) || 0,
    lastMessageAt: row.last_message_at || null,
    branchPoint: row.branched_from_message_id ? {
      messageId: row.branched_from_message_id,
      role: row.branch_message_role || '',
      preview: normalizeBranchPreview(row.branch_message_content),
      createdAt: row.branch_message_created_at || null
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    children: []
  };
}

function buildActiveBranchComparison(nodes, activeNode) {
  const activeDepth = Number(activeNode?.depth) || 0;
  const activeMessageCount = Number(activeNode?.messageCount) || 0;
  let descendantCount = 0;
  let ancestorCount = 0;
  let maxDepth = 0;
  for (const node of nodes) {
    if (node.depth > maxDepth) {
      maxDepth = node.depth;
    }
    if (activeNode && isDescendantOf(node, activeNode.id)) {
      ancestorCount += 1;
    }
    if (activeNode && isDescendantOf(activeNode, node.id)) {
      descendantCount += 1;
    }
    node.comparison = {
      depthDeltaFromActive: node.depth - activeDepth,
      messageCountDeltaFromActive: node.messageCount - activeMessageCount
    };
  }
  return {
    totalConversations: nodes.length,
    maxDepth,
    activeDepth,
    activeMessageCount,
    ancestorCount,
    descendantCount
  };
}

function isDescendantOf(node, ancestorId) {
  if (!node || !ancestorId || node.id === ancestorId) {
    return false;
  }
  for (const child of node.children) {
    if (child.id === ancestorId || isDescendantOf(child, ancestorId)) {
      return true;
    }
  }
  return false;
}

function normalizeBranchPreview(content) {
  const compact = String(content || '').replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}
