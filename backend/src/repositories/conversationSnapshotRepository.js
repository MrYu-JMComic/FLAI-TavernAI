import { createHash } from 'node:crypto';
import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { withSavepoint } from '../modules/savepoint.js';
import { sanitizeChatAttachments } from '../services/chatAttachments.js';

export const CONVERSATION_SNAPSHOT_VERSION = 2;
const CONVERSATION_FIELDS = [
  'title', 'desktop_background_url', 'mobile_background_url', 'custom_css', 'custom_js',
  'user_advanced_settings', 'chat_lorebook_id', 'context_budget_json'
];
const TABLES = [
  ['scene_nodes'], ['scene_routes'], ['cast_members'], ['cast_member_aliases'],
  ['cast_memories'], ['cast_behaviors'], ['cast_personality_anchors'], ['cast_emotion_states'],
  ['cast_emotion_history'], ['cast_appearances'], ['cast_activities'], ['cast_turn_queue'],
  ['conversation_turns'], ['scene_items'], ['cast_change_batches'], ['conversation_audit_events'],
  ['cast_ooc_validations'], ['conversation_memories'],
  ['conversation_memory_review_operations'], ['conversation_memory_review_members', 'conversation_memory_review_operations', 'operation_id'],
  ['status_bars'], ['economy_accounts'],
  ['economy_transactions', 'economy_accounts', 'account_id'], ['quests'],
  ['quest_objectives', 'quests', 'quest_id'], ['skill_checks'], ['world_clocks'], ['world_advances'],
  ['player_travel_states'], ['discovered_scene_nodes'], ['encounters'],
  ['encounter_participants', 'encounters', 'encounter_id'], ['encounter_actions', 'encounters', 'encounter_id'],
  ['reward_grants'], ['world_events'], ['conversation_world_book_clock'], ['conversation_world_book_state']
];
export const SNAPSHOT_STATE_TABLES = Object.freeze(TABLES.map(([table]) => table));
const OPTIONAL_V2_STATE_TABLES = new Set([
  'conversation_memory_review_operations',
  'conversation_memory_review_members'
]);

export function readSnapshotConversation(database, userId, conversationId) {
  return database.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId) || null;
}

export function readSnapshotMessages(database, userId, conversationId, throughMessageId = '') {
  const rows = database.prepare('SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at, rowid')
    .all(userId, conversationId);
  if (!throughMessageId) return rows;
  const index = rows.findIndex((row) => row.id === throughMessageId);
  return index < 0 ? [] : rows.slice(0, index + 1);
}

export function conversationHistoryHash(messages) {
  return createHash('sha256').update(JSON.stringify(messages.map((row) => [row.id, row.revision || 1, row.role]))).digest('hex');
}

export function captureConversationSnapshot(database, userId, conversationId, options = {}) {
  const conversation = readSnapshotConversation(database, userId, conversationId);
  if (!conversation) throw snapshotError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
  const state = {};
  for (const [table, parent, foreignKey] of TABLES) {
    state[table] = database.prepare(`SELECT * FROM ${table} WHERE ${scopeClause(parent, foreignKey)} ORDER BY rowid`).all(conversationId);
  }
  const messages = options.includeMessages === false ? [] : readSnapshotMessages(database, userId, conversationId);
  return {
    version: CONVERSATION_SNAPSHOT_VERSION,
    userId, conversationId, characterId: conversation.character_id,
    settings: Object.fromEntries(CONVERSATION_FIELDS.map((key) => [key, conversation[key]])),
    timelineRevision: conversation.timeline_revision,
    stateStatus: conversation.state_status,
    messages: messages.map(toSnapshotMessage),
    swipes: options.includeMessages === false ? [] : database.prepare(
      'SELECT * FROM message_swipes WHERE user_id = ? AND message_id IN (SELECT id FROM messages WHERE conversation_id = ?) ORDER BY created_at, rowid'
    ).all(userId, conversationId),
    state,
    savedAt: nowIso()
  };
}

export function restoreConversationSnapshot(database, userId, conversationId, snapshot, options = {}) {
  const target = readSnapshotConversation(database, userId, conversationId);
  const restoredSnapshot = normalizeSnapshotForRestore(snapshot);
  assertSnapshot(restoredSnapshot, userId, target);
  assertInternalReferences(database, restoredSnapshot);
  const idMap = new Map([[restoredSnapshot.conversationId, conversationId]]);
  const restoredTables = options.preserveWorldBookState
    ? TABLES.filter(([table]) => !table.startsWith('conversation_world_book_')) : TABLES;
  if (options.remapIds) {
    for (const rows of [restoredSnapshot.messages || [], restoredSnapshot.swipes || [], ...Object.values(restoredSnapshot.state)]) {
      for (const row of rows) if (row.id) idMap.set(row.id, newId());
    }
  }
  return withSavepoint(database, 'sp_restore_conversation_snapshot', () => {
    const deferred = database.prepare('PRAGMA defer_foreign_keys').get().defer_foreign_keys;
    database.exec('PRAGMA defer_foreign_keys = ON');
    try {
      for (const [table, parent, foreignKey] of [...restoredTables].reverse()) {
        database.prepare(`DELETE FROM ${table} WHERE ${scopeClause(parent, foreignKey)}`).run(conversationId);
      }
      if (options.restoreMessages !== false) {
        database.prepare('DELETE FROM messages WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
        const messageRows = (restoredSnapshot.messages || []).map((message) => ({
          id: message.id, user_id: userId, conversation_id: restoredSnapshot.conversationId,
          role: message.role, content: message.content, reasoning: message.reasoning || '',
          attachments_json: JSON.stringify(message.attachments || parseJson(message.attachments_json, [])),
          usage_json: message.usage ? JSON.stringify(message.usage) : message.usage_json || null,
          created_at: message.createdAt || message.created_at || nowIso(), revision: message.revision || 1,
          postprocess_state: message.postprocessState || message.postprocess_state || 'untracked'
        }));
        insertRows(database, 'messages', messageRows, idMap, userId, restoredSnapshot.conversationId, conversationId);
        insertRows(database, 'message_swipes', restoredSnapshot.swipes || [], idMap, userId, restoredSnapshot.conversationId, conversationId);
      }
      for (const [table] of restoredTables) {
        insertRows(database, table, restoredSnapshot.state[table], idMap, userId, restoredSnapshot.conversationId, conversationId);
      }
      if (options.restoreSettings !== false) {
        const fields = CONVERSATION_FIELDS.filter((key) => Object.hasOwn(restoredSnapshot.settings || {}, key)
          && (options.restoreTitle !== false || key !== 'title'));
        if (fields.length) {
          database.prepare(`UPDATE conversations SET ${fields.map((key) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
            .run(...fields.map((key) => restoredSnapshot.settings[key]), conversationId, userId);
        }
      }
      if (database.prepare('PRAGMA foreign_key_check').all().length) {
        throw snapshotError('Snapshot contains invalid resource references', 'SNAPSHOT_REFERENCE_INVALID');
      }
      return { idMap, restoredDomains: restoredTables.map(([table]) => table) };
    } finally {
      database.exec(`PRAGMA defer_foreign_keys = ${deferred ? 'ON' : 'OFF'}`);
    }
  });
}

export function clearConversationSnapshotState(database, userId, conversationId) {
  const empty = captureConversationSnapshot(database, userId, conversationId, { includeMessages: false });
  for (const key of SNAPSHOT_STATE_TABLES) empty.state[key] = [];
  return restoreConversationSnapshot(database, userId, conversationId, empty, { restoreMessages: false, restoreSettings: false });
}

export function writeConversationCheckpoint(database, userId, conversationId, options = {}) {
  const messages = readSnapshotMessages(database, userId, conversationId, options.throughMessageId || '');
  const anchor = messages.at(-1);
  const state = captureConversationSnapshot(database, userId, conversationId, { includeMessages: false });
  if (options.preserveWorldBookState && options.id) {
    const previous = database.prepare('SELECT state_json FROM conversation_checkpoints WHERE id = ? AND conversation_id = ?').get(options.id, conversationId);
    const before = parseJson(previous?.state_json, null);
    for (const table of ['conversation_world_book_clock', 'conversation_world_book_state']) {
      if (before?.state?.[table]) state.state[table] = before.state[table];
    }
  }
  if (options.stateStatus) state.stateStatus = options.stateStatus;
  const id = options.id || newId();
  database.prepare(`INSERT INTO conversation_checkpoints
    (id, conversation_id, anchor_message_id, anchor_revision, history_hash, kind, state_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, history_hash = excluded.history_hash, kind = excluded.kind, created_at = excluded.created_at`)
    .run(id, conversationId, anchor?.id || '', anchor?.revision || 0, conversationHistoryHash(messages),
      options.kind || 'after', JSON.stringify(state), nowIso());
  return id;
}

export function findConversationCheckpoint(database, userId, conversationId, throughMessageId, options = {}) {
  const allMessages = readSnapshotMessages(database, userId, conversationId);
  const targetIndex = throughMessageId ? allMessages.findIndex((message) => message.id === throughMessageId) : allMessages.length - 1;
  if (throughMessageId && targetIndex < 0) return null;
  const rows = database.prepare('SELECT * FROM conversation_checkpoints WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(conversationId);
  let best = null;
  let bestIndex = -2;
  for (const row of rows) {
    const snapshot = parseJson(row.state_json, null);
    if (row.kind === 'pending' || !snapshot || ['pending', 'needs_review', 'needs_rebuild', 'stale', 'legacy_partial'].includes(snapshot.stateStatus)) continue;
    if (row.kind === 'adopted' && !options.before) continue;
    const index = row.anchor_message_id ? allMessages.findIndex((message) => message.id === row.anchor_message_id) : -1;
    if ((row.anchor_message_id && index < 0) || index > targetIndex || (options.before && index === targetIndex) || index <= bestIndex) continue;
    if (options.exact && index !== targetIndex) continue;
    if (conversationHistoryHash(allMessages.slice(0, index + 1)) !== row.history_hash) continue;
    best = { ...row, index, snapshot };
    bestIndex = index;
  }
  return best;
}

function scopeClause(parent, foreignKey) {
  return parent ? `${foreignKey} IN (SELECT id FROM ${parent} WHERE conversation_id = ?)` : 'conversation_id = ?';
}

function assertSnapshot(snapshot, userId, target) {
  if (!target) throw snapshotError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
  if (snapshot?.version !== CONVERSATION_SNAPSHOT_VERSION || snapshot.userId !== userId || snapshot.characterId !== target.character_id) {
    throw snapshotError('Snapshot version or ownership is invalid', 'SNAPSHOT_INVALID');
  }
  for (const table of SNAPSHOT_STATE_TABLES) {
    if (!Array.isArray(snapshot.state?.[table])) throw snapshotError(`Snapshot is missing ${table}`, 'SNAPSHOT_INCOMPLETE');
  }
}

function normalizeSnapshotForRestore(snapshot) {
  if (snapshot?.version !== CONVERSATION_SNAPSHOT_VERSION || !snapshot.state || typeof snapshot.state !== 'object') {
    return snapshot;
  }
  let state = snapshot.state;
  for (const table of OPTIONAL_V2_STATE_TABLES) {
    if (Object.hasOwn(state, table)) continue;
    if (state === snapshot.state) state = { ...snapshot.state };
    state[table] = [];
  }
  return state === snapshot.state ? snapshot : { ...snapshot, state };
}

function insertRows(database, table, rows, idMap, userId, sourceId, targetId) {
  const allowed = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  for (const row of rows) {
    if (row.conversation_id && row.conversation_id !== sourceId) throw snapshotError('Snapshot mixes conversations', 'SNAPSHOT_SCOPE_INVALID');
    if (row.user_id && row.user_id !== userId) throw snapshotError('Snapshot mixes owners', 'SNAPSHOT_SCOPE_INVALID');
    const keys = Object.keys(row).filter((key) => allowed.has(key));
    const values = keys.map((key) => {
      if (key === 'conversation_id') return targetId;
      if (key === 'user_id') return userId;
      if (key === 'id' || /_id$/.test(key)) return idMap.get(row[key]) || row[key];
      if (/_json$/.test(key)) {
        try {
          return JSON.stringify(remapStructuredIds(JSON.parse(row[key]), idMap, /_ids_json$/.test(key)));
        } catch {
          return row[key];
        }
      }
      return row[key];
    });
    database.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...values);
  }
}

function assertInternalReferences(database, snapshot) {
  const allRows = Object.fromEntries(SNAPSHOT_STATE_TABLES.map((table) => [table, snapshot.state[table]]));
  allRows.messages = snapshot.messages || [];
  allRows.message_swipes = snapshot.swipes || [];
  for (const [table, rows] of Object.entries(allRows)) {
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all();
    for (const key of foreignKeys) {
      if (!allRows[key.table]) continue;
      const targetValues = new Set(allRows[key.table].map((row) => row[key.to]));
      for (const row of rows) {
        if (row[key.from] != null && !targetValues.has(row[key.from])) {
          throw snapshotError(`Snapshot has an out-of-scope ${table}.${key.from} reference`, 'SNAPSHOT_REFERENCE_INVALID');
        }
      }
    }
  }
}

function toSnapshotMessage(row) {
  return {
    id: row.id, role: row.role, content: row.content, attachments: sanitizeChatAttachments(parseJson(row.attachments_json, [])),
    reasoning: row.reasoning || '', usage: parseJson(row.usage_json, null), createdAt: row.created_at,
    revision: row.revision || 1, postprocessState: row.postprocess_state || 'untracked'
  };
}

function remapStructuredIds(value, idMap, isId = false) {
  if (typeof value === 'string') return isId ? idMap.get(value) || value : value;
  if (Array.isArray(value)) return value.map((item) => remapStructuredIds(item, idMap, isId));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapStructuredIds(item, idMap, /(?:^id$|Ids?$|_ids?$)/.test(key))]));
}

function snapshotError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status, publicMessage: message });
}
