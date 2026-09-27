import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { withSavepoint } from './savepoint.js';
import { finishConversationHistoryChange, prepareConversationHistoryChange } from '../services/conversationTimeline.js';

export function listSwipes(db, userId, messageId) {
  const rows = db
    .prepare(
      'SELECT id, message_id, content, reasoning, usage_json, created_at FROM message_swipes WHERE message_id = ? AND user_id = ? ORDER BY created_at ASC, rowid ASC'
    )
    .all(messageId, userId);
  const swipes = [];
  for (const row of rows) {
    swipes.push({
      id: row.id,
      messageId: row.message_id,
      content: row.content,
      reasoning: row.reasoning || '',
      usage: parseJson(row.usage_json, null),
      createdAt: row.created_at
    });
  }
  return swipes;
}

export function createSwipe(db, userId, messageId, { content, reasoning = '', usage = null }) {
  const message = db.prepare('SELECT id FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!message) return null;

  const id = newId();
  const timestamp = nowIso();
  db.prepare(
    'INSERT INTO message_swipes (id, message_id, user_id, content, reasoning, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, messageId, userId, content, reasoning, usage ? JSON.stringify(usage) : null, timestamp);
  return {
    id,
    messageId,
    content,
    reasoning,
    usage,
    createdAt: timestamp
  };
}

export function getSwipeIndex(db, messageId, swipeId) {
  const rows = db
    .prepare('SELECT id FROM message_swipes WHERE message_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(messageId);
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].id === swipeId) {
      return { index, total: rows.length };
    }
  }
  return null;
}

export function getActiveSwipe(db, userId, messageId) {
  const message = db
    .prepare('SELECT content, reasoning, usage_json, created_at FROM messages WHERE id = ? AND user_id = ?')
    .get(messageId, userId);
  if (!message) return null;
  const row = db.prepare('SELECT COUNT(*) AS count FROM message_swipes WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  const swipeCount = Number(row?.count) || 0;
  return {
    content: message.content,
    reasoning: message.reasoning || '',
    usage: parseJson(message.usage_json, null),
    createdAt: message.created_at,
    swipeCount: swipeCount + 1,
    activeIndex: 0
  };
}

export function setActiveSwipe(db, userId, messageId, swipeId) {
  const swipe = db.prepare('SELECT * FROM message_swipes WHERE id = ? AND message_id = ? AND user_id = ?').get(swipeId, messageId, userId);
  if (!swipe) return null;

  const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!message) return null;

  // Use a savepoint to keep the read-modify-write sequence atomic
  let timeline = null;
  withSavepoint(db, 'sp_set_active_swipe', () => {
    timeline = replaceMessageWithAlternative(db, userId, message, {
      content: swipe.content,
      reasoning: swipe.reasoning,
      usage: parseJson(swipe.usage_json, null)
    });
  });

  // Return updated state
  const rows = db
    .prepare('SELECT id FROM message_swipes WHERE message_id = ? AND user_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(messageId, userId);
  let activeIdx = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].id === swipeId) {
      activeIdx = index;
      break;
    }
  }
  return {
    content: swipe.content,
    reasoning: swipe.reasoning || '',
    usage: parseJson(swipe.usage_json, null),
    createdAt: swipe.created_at,
    swipeCount: rows.length + 1,
    activeIndex: activeIdx >= 0 ? activeIdx + 1 : 0,
    timeline
  };
}

/**
 * Replace a message's text with an alternative (an existing swipe or a freshly
 * regenerated reply). The previous text is retained as a swipe, so no recovery
 * save is written; the timeline still restores the pre-message checkpoint and
 * re-queues postprocessing for the new content.
 */
export function replaceMessageWithAlternative(db, userId, message, next, options = {}) {
  const content = String(next.content ?? '');
  const reasoning = String(next.reasoning ?? '');
  const usageJson = next.usage ? JSON.stringify(next.usage) : null;
  const changed = message.content !== content;
  const prepared = changed
    ? prepareConversationHistoryChange(db, userId, message.conversation_id, message.id, { recoverySave: false })
    : null;
  const existingSwipe = db
    .prepare('SELECT id FROM message_swipes WHERE message_id = ? AND user_id = ? AND content = ?')
    .get(message.id, userId, message.content);
  if (!existingSwipe && String(message.content || '').trim()) {
    createSwipe(db, userId, message.id, {
      content: message.content,
      reasoning: message.reasoning || '',
      usage: parseJson(message.usage_json, null)
    });
  }
  db.prepare('UPDATE messages SET content = ?, reasoning = ?, usage_json = ? WHERE id = ?')
    .run(content, reasoning, usageJson, message.id);
  return prepared ? finishConversationHistoryChange(db, userId, message.conversation_id, prepared, options) : null;
}

export function countSwipes(db, userId, messageId) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM message_swipes WHERE message_id = ? AND user_id = ?').get(messageId, userId);
  return Number(row?.count) || 0;
}
