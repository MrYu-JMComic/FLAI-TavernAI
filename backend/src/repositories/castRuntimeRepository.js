import { parseCastJson } from '../domain/cast/normalization.js';

export function getCastActivity(database, conversationId, activityId) {
  const row = database.prepare(
    `SELECT cast_activities.*, cast_members.canonical_name
     FROM cast_activities
     JOIN cast_members ON cast_members.id = cast_activities.member_id
     WHERE cast_activities.conversation_id = ? AND cast_activities.id = ?`
  ).get(conversationId, activityId);
  return row ? toCastActivity(row) : null;
}

export function updateCastActivityRecord(database, activity) {
  const result = database.prepare(
    `UPDATE cast_activities SET
       title = ?, location_node_id = ?, status = ?, start_tick = ?, end_tick = ?,
       metadata_json = ?, updated_at = ?
     WHERE conversation_id = ? AND id = ? AND member_id = ?`
  ).run(
    activity.title,
    activity.locationNodeId || null,
    activity.status,
    activity.startTick,
    activity.endTick,
    JSON.stringify(activity.metadata || {}),
    activity.updatedAt,
    activity.conversationId,
    activity.id,
    activity.memberId
  );
  return result.changes
    ? getCastActivity(database, activity.conversationId, activity.id)
    : null;
}

export function getCastPersonalityAnchor(database, conversationId, memberId) {
  const row = database.prepare(
    `SELECT * FROM cast_personality_anchors
     WHERE conversation_id = ? AND member_id = ?`
  ).get(conversationId, memberId);
  return row ? toPersonalityAnchor(row) : null;
}

export function upsertCastPersonalityAnchor(database, record, expectedRevision = null) {
  if (expectedRevision == null) {
    database.prepare(
      `INSERT INTO cast_personality_anchors (
         member_id, conversation_id, anchor_json, revision, created_at, updated_at
       ) VALUES (?, ?, ?, 1, ?, ?)`
    ).run(
      record.memberId,
      record.conversationId,
      JSON.stringify(record.anchor || {}),
      record.createdAt,
      record.updatedAt
    );
  } else {
    const result = database.prepare(
      `UPDATE cast_personality_anchors SET
         anchor_json = ?, revision = revision + 1, updated_at = ?
       WHERE conversation_id = ? AND member_id = ? AND revision = ?`
    ).run(
      JSON.stringify(record.anchor || {}),
      record.updatedAt,
      record.conversationId,
      record.memberId,
      expectedRevision
    );
    if (!result.changes) return null;
  }
  return getCastPersonalityAnchor(database, record.conversationId, record.memberId);
}

export function getCastEmotionState(database, conversationId, memberId) {
  const row = database.prepare(
    `SELECT * FROM cast_emotion_states
     WHERE conversation_id = ? AND member_id = ?`
  ).get(conversationId, memberId);
  return row ? toEmotionState(row) : null;
}

export function upsertCastEmotionState(database, record, expectedRevision = null) {
  if (expectedRevision == null) {
    database.prepare(
      `INSERT INTO cast_emotion_states (
         member_id, conversation_id, emotion_json, revision, updated_at
       ) VALUES (?, ?, ?, 1, ?)`
    ).run(
      record.memberId,
      record.conversationId,
      JSON.stringify(record.emotion || {}),
      record.updatedAt
    );
  } else {
    const result = database.prepare(
      `UPDATE cast_emotion_states SET
         emotion_json = ?, revision = revision + 1, updated_at = ?
       WHERE conversation_id = ? AND member_id = ? AND revision = ?`
    ).run(
      JSON.stringify(record.emotion || {}),
      record.updatedAt,
      record.conversationId,
      record.memberId,
      expectedRevision
    );
    if (!result.changes) return null;
  }
  return getCastEmotionState(database, record.conversationId, record.memberId);
}

export function insertCastEmotionHistory(database, record) {
  database.prepare(
    `INSERT INTO cast_emotion_history (
       id, conversation_id, member_id, emotion_json, impact_json, trigger, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.conversationId,
    record.memberId,
    JSON.stringify(record.emotion || {}),
    JSON.stringify(record.impact || {}),
    record.trigger,
    record.createdAt
  );
  return record;
}

export function listCastEmotionHistory(database, conversationId, memberId, options = {}) {
  const limit = Math.max(1, Number(options.limit || 50));
  const offset = Math.max(0, Number(options.offset || 0));
  return database.prepare(
    `SELECT * FROM cast_emotion_history
     WHERE conversation_id = ? AND member_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  ).all(conversationId, memberId, limit, offset).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    emotion: parseCastJson(row.emotion_json, {}),
    impact: parseCastJson(row.impact_json, {}),
    trigger: row.trigger,
    createdAt: row.created_at,
  }));
}

export function listCastTurnQueue(database, conversationId, options = {}) {
  const status = String(options.status || '');
  return database.prepare(
    `SELECT cast_turn_queue.*, cast_members.canonical_name
     FROM cast_turn_queue
     JOIN cast_members ON cast_members.id = cast_turn_queue.member_id
     WHERE cast_turn_queue.conversation_id = ? AND (? = '' OR cast_turn_queue.status = ?)
     ORDER BY cast_turn_queue.order_index ASC, cast_turn_queue.created_at ASC`
  ).all(conversationId, status, status).map(toTurnQueueEntry);
}

export function getCastTurnQueueEntry(database, conversationId, entryId) {
  const row = database.prepare(
    `SELECT cast_turn_queue.*, cast_members.canonical_name
     FROM cast_turn_queue
     JOIN cast_members ON cast_members.id = cast_turn_queue.member_id
     WHERE cast_turn_queue.conversation_id = ? AND cast_turn_queue.id = ?`
  ).get(conversationId, entryId);
  return row ? toTurnQueueEntry(row) : null;
}

export function replaceCastTurnQueueRecords(database, conversationId, entries) {
  database.prepare('DELETE FROM cast_turn_queue WHERE conversation_id = ?').run(conversationId);
  const insert = database.prepare(
    `INSERT INTO cast_turn_queue (
       id, conversation_id, member_id, status, order_index, payload_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    insert.run(
      entry.id,
      conversationId,
      entry.memberId,
      entry.status,
      entry.orderIndex,
      JSON.stringify(entry.payload || {}),
      entry.createdAt,
      entry.updatedAt
    );
  }
  return listCastTurnQueue(database, conversationId);
}

export function updateCastTurnQueueRecord(database, entry) {
  const result = database.prepare(
    `UPDATE cast_turn_queue SET status = ?, order_index = ?, payload_json = ?, updated_at = ?
     WHERE conversation_id = ? AND id = ? AND member_id = ?`
  ).run(
    entry.status,
    entry.orderIndex,
    JSON.stringify(entry.payload || {}),
    entry.updatedAt,
    entry.conversationId,
    entry.id,
    entry.memberId
  );
  return result.changes
    ? getCastTurnQueueEntry(database, entry.conversationId, entry.id)
    : null;
}

export function getNextConversationTurnIndex(database, conversationId) {
  const row = database.prepare(
    'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM conversation_turns WHERE conversation_id = ?'
  ).get(conversationId);
  return Number(row?.next_index || 0);
}

export function insertConversationTurn(database, turn) {
  database.prepare(
    `INSERT INTO conversation_turns (
       id, conversation_id, speaker_kind, speaker_member_id, speaker_name,
       content, turn_index, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    turn.id,
    turn.conversationId,
    turn.speakerKind,
    turn.speakerMemberId || null,
    turn.speakerName,
    turn.content,
    turn.turnIndex,
    JSON.stringify(turn.metadata || {}),
    turn.createdAt
  );
  return turn;
}

export function listConversationTurns(database, conversationId, options = {}) {
  const limit = Math.max(1, Number(options.limit || 100));
  const offset = Math.max(0, Number(options.offset || 0));
  const rows = database.prepare(
    `SELECT * FROM conversation_turns
     WHERE conversation_id = ?
     ORDER BY turn_index DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(conversationId, limit, offset).reverse();
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    speakerKind: row.speaker_kind,
    speakerMemberId: row.speaker_member_id || '',
    speakerName: row.speaker_name,
    content: row.content,
    turnIndex: row.turn_index,
    metadata: parseCastJson(row.metadata_json, {}),
    createdAt: row.created_at,
  }));
}

export function insertCastOocValidation(database, record) {
  database.prepare(
    `INSERT INTO cast_ooc_validations (
       id, conversation_id, member_id, response_text, match_score,
       passed, violations_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.conversationId,
    record.memberId,
    record.responseText,
    record.matchScore,
    record.passed ? 1 : 0,
    JSON.stringify(record.violations || []),
    record.createdAt
  );
  return record;
}

export function listCastOocValidations(database, conversationId, memberId, options = {}) {
  const limit = Math.max(1, Number(options.limit || 50));
  const offset = Math.max(0, Number(options.offset || 0));
  return database.prepare(
    `SELECT * FROM cast_ooc_validations
     WHERE conversation_id = ? AND (? = '' OR member_id = ?)
     ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  ).all(conversationId, memberId, memberId, limit, offset).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    responseText: row.response_text,
    matchScore: row.match_score,
    passed: Boolean(row.passed),
    violations: parseCastJson(row.violations_json, []),
    createdAt: row.created_at,
  }));
}

function toCastActivity(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    memberName: row.canonical_name || '',
    title: row.title,
    locationNodeId: row.location_node_id || '',
    status: row.status,
    startTick: row.start_tick,
    endTick: row.end_tick,
    sourceKind: row.source_kind,
    metadata: parseCastJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPersonalityAnchor(row) {
  return {
    memberId: row.member_id,
    conversationId: row.conversation_id,
    anchor: parseCastJson(row.anchor_json, {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEmotionState(row) {
  return {
    memberId: row.member_id,
    conversationId: row.conversation_id,
    emotion: parseCastJson(row.emotion_json, {}),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function toTurnQueueEntry(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    memberName: row.canonical_name || '',
    status: row.status,
    orderIndex: row.order_index,
    payload: parseCastJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
