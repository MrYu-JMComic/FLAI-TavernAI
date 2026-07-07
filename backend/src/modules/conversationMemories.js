import { newId, nowIso } from '../security.js';
import { normalizeBoolean } from '../utils/boolean.js';
import { clampNumber } from '../utils/number.js';

const memoryTypes = new Set(['event', 'relationship', 'location', 'preference', 'fact', 'summary']);

export function listConversationMemories(database, userId, conversationId, options = {}) {
  if (!conversationBelongsToUser(database, userId, conversationId)) {
    return null;
  }
  const includeArchived = normalizeBoolean(options.includeArchived, false);
  const rows = database
    .prepare(
      `SELECT * FROM conversation_memories
       WHERE user_id = ? AND conversation_id = ?
         AND (? = 1 OR archived = 0)
       ORDER BY enabled DESC, updated_at DESC, rowid DESC`
    )
    .all(userId, conversationId, includeArchived ? 1 : 0);
  return rows.map(toConversationMemory);
}

export function createConversationMemory(database, userId, conversationId, payload = {}) {
  if (!conversationBelongsToUser(database, userId, conversationId)) {
    return null;
  }
  const normalized = normalizeMemoryPayload(payload);
  if (!normalized.content) {
    throw new Error('记忆内容不能为空');
  }
  const timestamp = nowIso();
  const id = newId();
  database
    .prepare(
      `INSERT INTO conversation_memories (
        id, user_id, conversation_id, memory_type, subject, content, confidence,
        source_message_id, source_kind, source_excerpt, enabled, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      conversationId,
      normalized.memoryType,
      normalized.subject,
      normalized.content,
      normalized.confidence,
      normalized.sourceMessageId,
      normalized.sourceKind,
      normalized.sourceExcerpt,
      normalized.enabled ? 1 : 0,
      0,
      timestamp,
      timestamp
    );
  return getConversationMemory(database, userId, conversationId, id);
}

export function updateConversationMemory(database, userId, conversationId, memoryId, payload = {}) {
  const existing = getConversationMemory(database, userId, conversationId, memoryId);
  if (!existing) {
    return null;
  }
  const normalized = normalizeMemoryPayload(payload, existing);
  if (!normalized.content) {
    throw new Error('记忆内容不能为空');
  }
  database
    .prepare(
      `UPDATE conversation_memories
       SET memory_type = ?, subject = ?, content = ?, confidence = ?,
           source_message_id = ?, source_kind = ?, source_excerpt = ?,
           enabled = ?, archived = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND conversation_id = ?`
    )
    .run(
      normalized.memoryType,
      normalized.subject,
      normalized.content,
      normalized.confidence,
      normalized.sourceMessageId,
      normalized.sourceKind,
      normalized.sourceExcerpt,
      normalized.enabled ? 1 : 0,
      normalized.archived ? 1 : 0,
      nowIso(),
      memoryId,
      userId,
      conversationId
    );
  return getConversationMemory(database, userId, conversationId, memoryId);
}

export function confirmConversationMemory(database, userId, conversationId, memoryId) {
  const existing = getConversationMemory(database, userId, conversationId, memoryId);
  if (!existing) {
    return null;
  }
  return updateConversationMemory(database, userId, conversationId, memoryId, {
    ...existing,
    enabled: true,
    archived: false
  });
}

export function disableConversationMemory(database, userId, conversationId, memoryId) {
  const existing = getConversationMemory(database, userId, conversationId, memoryId);
  if (!existing) {
    return null;
  }
  return updateConversationMemory(database, userId, conversationId, memoryId, {
    ...existing,
    enabled: false,
    archived: false
  });
}

export function rollbackConversationMemory(database, userId, conversationId, memoryId) {
  const existing = getConversationMemory(database, userId, conversationId, memoryId);
  if (!existing) {
    return null;
  }
  return updateConversationMemory(database, userId, conversationId, memoryId, {
    ...existing,
    enabled: false,
    archived: true
  });
}

export function deleteConversationMemory(database, userId, conversationId, memoryId) {
  const result = database
    .prepare('DELETE FROM conversation_memories WHERE id = ? AND user_id = ? AND conversation_id = ?')
    .run(memoryId, userId, conversationId);
  return result.changes > 0;
}

export function buildConversationMemoryContext(database, userId, conversationId) {
  const rows = database
    .prepare(
      `SELECT memory_type, subject, content
       FROM conversation_memories
       WHERE user_id = ? AND conversation_id = ? AND enabled = 1 AND archived = 0
       ORDER BY updated_at DESC, rowid DESC
       LIMIT 24`
    )
    .all(userId, conversationId);
  if (!rows.length) {
    return '';
  }
  let text = '[Long-term conversation memory]\n';
  for (const row of rows) {
    const label = row.subject ? `${row.memory_type}:${row.subject}` : row.memory_type;
    text += `- ${label}: ${row.content}\n`;
  }
  return text.trimEnd();
}

function getConversationMemory(database, userId, conversationId, memoryId) {
  const row = database
    .prepare('SELECT * FROM conversation_memories WHERE id = ? AND user_id = ? AND conversation_id = ?')
    .get(memoryId, userId, conversationId);
  return row ? toConversationMemory(row) : null;
}

function conversationBelongsToUser(database, userId, conversationId) {
  return Boolean(
    database.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId)
  );
}

function normalizeMemoryPayload(payload = {}, fallback = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const memoryType = String(source.memoryType ?? source.memory_type ?? fallback.memoryType ?? 'event').trim();
  return {
    memoryType: memoryTypes.has(memoryType) ? memoryType : 'event',
    subject: String(source.subject ?? fallback.subject ?? '').trim().slice(0, 160),
    content: String(source.content ?? fallback.content ?? '').trim().slice(0, 5000),
    confidence: clampNumber(source.confidence ?? fallback.confidence ?? 1, 0, 1, 1),
    sourceMessageId: String(source.sourceMessageId ?? source.source_message_id ?? fallback.sourceMessageId ?? '').trim().slice(0, 160),
    sourceKind: normalizeSourceKind(source.sourceKind ?? source.source_kind ?? fallback.sourceKind ?? 'manual'),
    sourceExcerpt: String(source.sourceExcerpt ?? source.source_excerpt ?? fallback.sourceExcerpt ?? '').trim().slice(0, 1000),
    enabled: normalizeBoolean(source.enabled ?? fallback.enabled ?? true, true),
    archived: normalizeBoolean(source.archived ?? fallback.archived ?? false, false)
  };
}

function normalizeSourceKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'auto' || normalized === 'manual' || normalized === 'import' ? normalized : 'manual';
}

function toConversationMemory(row = {}) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memoryType: row.memory_type,
    subject: row.subject,
    content: row.content,
    confidence: row.confidence,
    sourceMessageId: row.source_message_id,
    sourceKind: row.source_kind || 'manual',
    sourceExcerpt: row.source_excerpt || '',
    enabled: Boolean(row.enabled),
    archived: Boolean(row.archived),
    pending: row.source_kind === 'auto' && !row.enabled && !row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
