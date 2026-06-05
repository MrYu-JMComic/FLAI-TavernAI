import { newId, nowIso } from '../security.js';

// ── Save CRUD ──

export function listSaves(database, userId, conversationId) {
  if (!hasConversationAccess(database, userId, conversationId)) {
    return [];
  }
  return database
    .prepare(
      `SELECT id, conversation_id, name, preview, created_at
       FROM saves
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at DESC`
    )
    .all(userId, conversationId)
    .map(toSaveSummary);
}

export function getSave(database, userId, saveId) {
  const row = database
    .prepare('SELECT * FROM saves WHERE id = ? AND user_id = ?')
    .get(saveId, userId);
  return row ? toSaveDetail(row) : null;
}

export function createSave(database, userId, conversationId, payload) {
  assertConversationAccess(database, userId, conversationId);
  const id = newId();
  const timestamp = nowIso();
  const name = normalizeSaveName(payload.name);
  const snapshot = buildSnapshot(database, userId, conversationId);
  const preview = buildPreview(snapshot);

  database
    .prepare(
      `INSERT INTO saves (id, conversation_id, user_id, name, snapshot, preview, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, conversationId, userId, name, JSON.stringify(snapshot), preview, timestamp);

  return toSaveSummary(
    database.prepare('SELECT id, conversation_id, name, preview, created_at FROM saves WHERE id = ?').get(id)
  );
}

export function updateSave(database, userId, saveId, payload) {
  const existing = database
    .prepare('SELECT * FROM saves WHERE id = ? AND user_id = ?')
    .get(saveId, userId);
  if (!existing) {
    return null;
  }

  const name = normalizeSaveName(payload.name ?? existing.name);

  database
    .prepare('UPDATE saves SET name = ? WHERE id = ? AND user_id = ?')
    .run(name, saveId, userId);

  return toSaveSummary(
    database.prepare('SELECT id, conversation_id, name, preview, created_at FROM saves WHERE id = ?').get(saveId)
  );
}

export function deleteSave(database, userId, saveId) {
  const result = database
    .prepare('DELETE FROM saves WHERE id = ? AND user_id = ?')
    .run(saveId, userId);
  return result.changes > 0;
}

export function loadSave(database, userId, saveId) {
  const row = database
    .prepare('SELECT * FROM saves WHERE id = ? AND user_id = ?')
    .get(saveId, userId);
  if (!row) {
    return null;
  }

  const snapshot = parseJson(row.snapshot, null);
  if (!snapshot) {
    return null;
  }

  const conversationId = row.conversation_id;

  // Wrap DELETE + INSERT in a transaction to prevent message loss on failure
  database.exec('BEGIN');
  try {
    // Clear existing messages for this conversation
    database
      .prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ?')
      .run(userId, conversationId);

    // Restore messages from snapshot
    if (Array.isArray(snapshot.messages) && snapshot.messages.length > 0) {
      const insert = database.prepare(
        `INSERT INTO messages (id, user_id, conversation_id, role, content, reasoning, usage_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const msg of snapshot.messages) {
        insert.run(
          msg.id || newId(),
          userId,
          conversationId,
          msg.role,
          msg.content,
          msg.reasoning || '',
          msg.usage ? JSON.stringify(msg.usage) : null,
          msg.createdAt || nowIso()
        );
      }
    }

    // Update conversation timestamp
    database
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?')
      .run(nowIso(), conversationId, userId);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return {
    conversationId,
    messageCount: Array.isArray(snapshot.messages) ? snapshot.messages.length : 0
  };
}

// ── Snapshot Logic ──

function buildSnapshot(database, userId, conversationId) {
  const messages = database
    .prepare(
      `SELECT id, role, content, reasoning, usage_json, created_at
       FROM messages
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(userId, conversationId)
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning || '',
      usage: parseJson(row.usage_json, null),
      createdAt: row.created_at
    }));

  return {
    messages,
    savedAt: nowIso()
  };
}

function buildPreview(snapshot) {
  const messages = snapshot.messages || [];
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
  if (!last) {
    return messages.length > 0 ? `${messages.length} 条消息` : '空会话';
  }
  const text = last.content.replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

// ── Helpers ──

function normalizeSaveName(name) {
  const value = String(name || '').trim();
  if (!value) {
    return `存档 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  }
  if (value.length > 80) {
    return value.slice(0, 80);
  }
  return value;
}

function assertConversationAccess(database, userId, conversationId) {
  if (!hasConversationAccess(database, userId, conversationId)) {
    throw new Error('对话不存在');
  }
}

function hasConversationAccess(database, userId, conversationId) {
  return Boolean(database
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .get(conversationId, userId));
}

function toSaveSummary(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    preview: row.preview || '',
    createdAt: row.created_at
  };
}

function toSaveDetail(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    snapshot: parseJson(row.snapshot, {}),
    preview: row.preview || '',
    createdAt: row.created_at
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}
