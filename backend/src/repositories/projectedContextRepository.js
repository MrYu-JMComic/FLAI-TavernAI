import { DatabaseSync } from 'node:sqlite';
import { findConversationCheckpoint, readSnapshotMessages, SNAPSHOT_STATE_TABLES } from './conversationSnapshotRepository.js';
import { memoryHash } from '../domain/conversationMemory/contracts.js';

/** Resolve a historical checkpoint and its memory lineage without allocating a projection connection. */
export function readProjectedContextCheckpoint(database, userId, conversationId, options = {}) {
  if (!options.asOfMessageId && !Number.isFinite(options.asOfOrder)) return null;
  const conversation = database.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(conversationId, userId);
  if (!conversation) throw contextError('CONTEXT_CONVERSATION_UNAVAILABLE', '会话不存在或无权访问。');
  const messages = readSnapshotMessages(database, userId, conversationId);
  let cutoff;
  let anchor;
  let before;
  if (options.asOfMessageId) {
    const index = messages.findIndex((row) => row.id === options.asOfMessageId);
    if (index < 0) throw contextError('MEMORY_CUTOFF_INVALID', '历史节点不存在。');
    before = options.beforeCutoff === true;
    anchor = options.asOfMessageId;
    cutoff = index + 1 - (before ? 1 : 0);
  } else {
    cutoff = Math.max(0, Math.min(messages.length, Number(options.asOfOrder)));
    anchor = messages[Math.max(0, cutoff - 1)]?.id;
    before = cutoff === 0;
  }
  const checkpoint = findConversationCheckpoint(database, userId, conversationId, anchor, { before });
  if (!checkpoint) throw contextError('CONTEXT_CHECKPOINT_REQUIRED', '该历史节点缺少可验证的状态检查点，请先修复或建立明确的历史基线，再重新生成。');
  const memoryCheckpoint=checkpoint.snapshot.memoryCheckpoint || {
    commitId: checkpoint.snapshot.memory?.conversation_memory_state?.[0]?.core_commit_id || '',
    revision: checkpoint.snapshot.memory?.conversation_memory_state?.[0]?.revision || 0,
    coreOrder: checkpoint.snapshot.memory?.conversation_memory_state?.[0]?.core_order || 0
  };
  return {conversation,messages,cutoff,checkpoint,memoryCheckpoint};
}

/** Materialize an owned checkpoint into an isolated read-only connection; never restore the live database. */
export function openProjectedContext(database, userId, conversationId, options = {}) {
  const resolved=readProjectedContextCheckpoint(database,userId,conversationId,options);
  if(!resolved)return null;
  const {conversation,messages,cutoff,checkpoint,memoryCheckpoint}=resolved;
  const projection = new DatabaseSync(':memory:');
  try {
    // Projection rows are already validated checkpoint data; omitted shared tables are intentionally absent.
    projection.exec('PRAGMA foreign_keys=OFF');
    const tables = new Set(['conversations', ...SNAPSHOT_STATE_TABLES, 'characters', 'world_books', 'world_book_entries', 'character_world_books']);
    for (const table of tables) {
      const definition = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
      if (!definition) throw contextError('CONTEXT_PROJECTION_SCHEMA_INVALID', '历史状态的数据库结构不完整。');
      projection.exec(definition);
    }
    insertRows(projection, 'conversations', [{ ...conversation, ...checkpoint.snapshot.settings }]);
    for (const table of SNAPSHOT_STATE_TABLES) insertRows(projection, table, checkpoint.snapshot.state[table] || []);
    // Author definitions remain canon; conversation-owned lore selection and activation come from the checkpoint.
    const character = database.prepare('SELECT * FROM characters WHERE id=?').get(conversation.character_id);
    if (character) insertRows(projection, 'characters', [character]);
    const links = database.prepare('SELECT * FROM character_world_books WHERE character_id=?').all(conversation.character_id);
    const ids = [...new Set([...links.map((row) => row.world_book_id), checkpoint.snapshot.settings?.chat_lorebook_id].filter(Boolean))];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      insertRows(projection, 'world_books', database.prepare(`SELECT * FROM world_books WHERE id IN (${placeholders})`).all(...ids));
      insertRows(projection, 'world_book_entries', database.prepare(`SELECT * FROM world_book_entries WHERE world_book_id IN (${placeholders})`).all(...ids));
      insertRows(projection, 'character_world_books', links);
    }
    projection.exec('PRAGMA query_only=ON');
    return {
      database: projection,
      checkpointId: checkpoint.id,
      checkpointOrder: checkpoint.index + 1,
      memoryCheckpoint,
      cutoffOrder: cutoff,
      historyIds: new Set(messages.slice(0, cutoff).map((row) => row.id)),
      fingerprint: memoryHash([checkpoint.id, checkpoint.history_hash, checkpoint.snapshot.state, checkpoint.snapshot.settings]),
      dispose: () => projection.close()
    };
  } catch (error) {
    projection.close();
    throw error;
  }
}

function insertRows(database, table, rows) {
  const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const row of rows) {
    const keys = Object.keys(row).filter((key) => columns.has(key));
    if (!keys.length) continue;
    database.prepare(`INSERT INTO ${table}(${keys.map((key) => `"${key}"`).join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...keys.map((key) => row[key]));
  }
}

function contextError(code, message) {
  return Object.assign(new Error(message), { code, status: 409, accepted: false, publicMessage: message });
}
