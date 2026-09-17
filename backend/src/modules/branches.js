import { newId, nowIso } from '../security.js';
import { withSavepoint } from './savepoint.js';
import { captureConversationSnapshot, findConversationCheckpoint, readSnapshotMessages, restoreConversationSnapshot, SNAPSHOT_STATE_TABLES, writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { assertConversationIdle } from '../services/conversationTimeline.js';

export function branchConversation(db, userId, conversationId, branchFromMessageId) {
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) return null;

  const branchMessage = db
    .prepare('SELECT rowid AS message_rowid, * FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?')
    .get(branchFromMessageId, conversationId, userId);
  if (!branchMessage) return null;
  assertConversationIdle(db, userId, conversationId);
  if (['needs_review', 'needs_rebuild', 'stale'].includes(conversation.state_status)) {
    throw Object.assign(new Error('请先处理待同步的剧情状态，再创建分支。'), { code: 'CONVERSATION_STATE_REBUILD_REQUIRED', status: 409 });
  }

  const allMessages = readSnapshotMessages(db, userId, conversationId);
  const branchIndex = allMessages.findIndex((message) => message.id === branchFromMessageId);
  const checkpoint = findConversationCheckpoint(db, userId, conversationId, branchFromMessageId, { exact: true });
  const atTip = branchIndex === allMessages.length - 1;
  const snapshot = checkpoint?.snapshot || captureConversationSnapshot(db, userId, conversationId, { includeMessages: false });
  if (!checkpoint && !atTip) {
    for (const table of SNAPSHOT_STATE_TABLES) snapshot.state[table] = [];
  }
  snapshot.messages = allMessages.slice(0, branchIndex + 1);
  const messageIds = snapshot.messages.map((message) => message.id);
  snapshot.swipes = db.prepare(`SELECT * FROM message_swipes WHERE user_id = ? AND message_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY created_at, rowid`)
    .all(userId, ...messageIds);

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

    restoreConversationSnapshot(db, userId, newConversationId, snapshot, { remapIds: true, restoreTitle: false });
    db.prepare('UPDATE conversations SET state_status = ? WHERE id = ?')
      .run(checkpoint || atTip ? 'ready' : 'legacy_partial', newConversationId);
    writeConversationCheckpoint(db, userId, newConversationId);
  });

  return { ...getBranchConversation(db, userId, newConversationId), warnings: checkpoint || atTip ? [] : ['此历史节点没有状态快照，分支未继承后续人物、记忆、物品或经济状态。'] };
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
    stateStatus: row.state_status,
    timelineRevision: row.timeline_revision,
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
