import { newId, nowIso } from '../security.js';

export function listSwipes(db, userId, messageId) {
  return db
    .prepare(
      'SELECT id, message_id, content, reasoning, usage_json, created_at FROM message_swipes WHERE message_id = ? AND user_id = ? ORDER BY created_at ASC'
    )
    .all(messageId, userId)
    .map((row) => ({
      id: row.id,
      messageId: row.message_id,
      content: row.content,
      reasoning: row.reasoning || '',
      usage: safeParseJson(row.usage_json),
      createdAt: row.created_at
    }));
}

export function createSwipe(db, userId, messageId, { content, reasoning = '', usage = null }) {
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
    .prepare('SELECT id FROM message_swipes WHERE message_id = ? ORDER BY created_at ASC')
    .all(messageId);
  const index = rows.findIndex((row) => row.id === swipeId);
  return index >= 0 ? { index, total: rows.length } : null;
}

export function getActiveSwipe(db, messageId) {
  const message = db.prepare('SELECT content, reasoning, usage_json, created_at FROM messages WHERE id = ?').get(messageId);
  if (!message) return null;
  const swipes = db.prepare('SELECT id, created_at FROM message_swipes WHERE message_id = ? ORDER BY created_at ASC').all(messageId);
  return {
    content: message.content,
    reasoning: message.reasoning || '',
    usage: safeParseJson(message.usage_json),
    createdAt: message.created_at,
    swipeCount: swipes.length + 1,
    activeIndex: 0
  };
}

export function setActiveSwipe(db, userId, messageId, swipeId) {
  const swipe = db.prepare('SELECT * FROM message_swipes WHERE id = ? AND message_id = ? AND user_id = ?').get(swipeId, messageId, userId);
  if (!swipe) return null;

  const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(messageId, userId);
  if (!message) return null;

  // Save current message content as a swipe if it doesn't already exist
  const existingSwipe = db.prepare('SELECT id FROM message_swipes WHERE message_id = ? AND content = ?').get(messageId, message.content);
  if (!existingSwipe) {
    createSwipe(db, userId, messageId, {
      content: message.content,
      reasoning: message.reasoning || '',
      usage: safeParseJson(message.usage_json)
    });
  }

  // Update message with swipe content
  db.prepare('UPDATE messages SET content = ?, reasoning = ?, usage_json = ? WHERE id = ?')
    .run(swipe.content, swipe.reasoning, swipe.usage_json, messageId);

  // Return updated state
  const allSwipes = listSwipes(db, userId, messageId);
  const activeIdx = allSwipes.findIndex((s) => s.id === swipeId);
  return {
    content: swipe.content,
    reasoning: swipe.reasoning || '',
    usage: safeParseJson(swipe.usage_json),
    createdAt: swipe.created_at,
    swipeCount: allSwipes.length + 1,
    activeIndex: activeIdx >= 0 ? activeIdx + 1 : 0
  };
}

function safeParseJson(text) {
  try { return JSON.parse(text || 'null'); } catch { return null; }
}
