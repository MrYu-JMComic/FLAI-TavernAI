import { newId, nowIso } from '../security.js';

export function branchConversation(db, userId, conversationId, branchFromMessageId) {
  const conversation = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId);
  if (!conversation) return null;

  const branchMessage = db
    .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?')
    .get(branchFromMessageId, conversationId, userId);
  if (!branchMessage) return null;

  const newConversationId = newId();
  const timestamp = nowIso();

  // Wrap entire branch operation in a transaction to prevent incomplete branches
  db.exec('BEGIN');
  try {
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
        'SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? AND created_at <= ? ORDER BY created_at ASC'
      )
      .all(conversationId, userId, branchMessage.created_at);

    for (const msg of messages) {
      const newMsgId = newId();
      db.prepare(
        'INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newMsgId, userId, newConversationId, msg.role, msg.content, msg.reasoning || '', msg.usage_json, msg.created_at);

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

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

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
       ORDER BY c.created_at DESC`
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
