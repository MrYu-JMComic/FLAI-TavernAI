import { parseCastJson } from '../domain/cast/normalization.js';

export function castConversationBelongsToUser(database, userId, conversationId) {
  return Boolean(database.prepare(
    'SELECT 1 FROM conversations WHERE id = ? AND user_id = ?'
  ).get(conversationId, userId));
}

export function getConversationCharacter(database, conversationId) {
  const row = database.prepare(
    `SELECT characters.id, characters.name
     FROM conversations
     JOIN characters ON characters.id = conversations.character_id
     WHERE conversations.id = ?`
  ).get(conversationId);
  return row ? { id: row.id, name: row.name } : null;
}

export function listCastMembers(database, conversationId, options = {}) {
  const includeHidden = options.includeHidden !== false;
  return database.prepare(
    `SELECT * FROM cast_members
     WHERE conversation_id = ? AND (? = 1 OR visibility = 'visible')
     ORDER BY CASE member_type WHEN 'protagonist' THEN 0 ELSE 1 END,
              canonical_name COLLATE NOCASE ASC, created_at ASC`
  ).all(conversationId, includeHidden ? 1 : 0).map((row) => toCastMember(database, row));
}

export function getCastMember(database, conversationId, memberId) {
  const row = database.prepare(
    'SELECT * FROM cast_members WHERE conversation_id = ? AND id = ?'
  ).get(conversationId, memberId);
  return row ? toCastMember(database, row) : null;
}

export function getCastProtagonist(database, conversationId) {
  const row = database.prepare(
    `SELECT * FROM cast_members
     WHERE conversation_id = ? AND member_type = 'protagonist'
     LIMIT 1`
  ).get(conversationId);
  return row ? toCastMember(database, row) : null;
}

export function findCastMemberByNameKey(database, conversationId, nameKey) {
  const row = database.prepare(
    `SELECT cast_members.* FROM cast_members
     WHERE cast_members.conversation_id = ? AND cast_members.name_key = ?
     UNION ALL
     SELECT cast_members.* FROM cast_member_aliases
     JOIN cast_members ON cast_members.id = cast_member_aliases.member_id
     WHERE cast_member_aliases.conversation_id = ? AND cast_member_aliases.alias_key = ?
     LIMIT 1`
  ).get(conversationId, nameKey, conversationId, nameKey);
  return row ? toCastMember(database, row) : null;
}

export function findCastNameClaim(database, conversationId, nameKey) {
  const row = database.prepare(
    `SELECT id AS member_id, 'canonical' AS claim_type
     FROM cast_members WHERE conversation_id = ? AND name_key = ?
     UNION ALL
     SELECT member_id, 'alias' AS claim_type
     FROM cast_member_aliases WHERE conversation_id = ? AND alias_key = ?
     LIMIT 1`
  ).get(conversationId, nameKey, conversationId, nameKey);
  return row ? { memberId: row.member_id, claimType: row.claim_type } : null;
}

export function insertCastMember(database, member) {
  database.prepare(
    `INSERT INTO cast_members (
       id, conversation_id, member_type, canonical_name, name_key, source,
       evidence, confidence, visibility, status, custom_status, relationship,
       current_location_label, current_scene_node_id, memory_sealed, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    member.id,
    member.conversationId,
    member.memberType,
    member.canonicalName,
    member.nameKey,
    member.source,
    member.evidence,
    member.confidence,
    member.visibility,
    member.status,
    member.customStatus,
    member.relationship,
    member.currentLocationLabel,
    member.currentSceneNodeId || null,
    member.memorySealed ? 1 : 0,
    member.createdAt,
    member.updatedAt
  );
  return getCastMember(database, member.conversationId, member.id);
}

export function updateCastMember(database, member, expectedRevision) {
  const result = database.prepare(
    `UPDATE cast_members SET
       canonical_name = ?, name_key = ?, source = ?, evidence = ?, confidence = ?,
       visibility = ?, status = ?, custom_status = ?, relationship = ?,
       current_location_label = ?, current_scene_node_id = ?, memory_sealed = ?,
       revision = revision + 1, updated_at = ?
     WHERE conversation_id = ? AND id = ? AND revision = ?`
  ).run(
    member.canonicalName,
    member.nameKey,
    member.source,
    member.evidence,
    member.confidence,
    member.visibility,
    member.status,
    member.customStatus,
    member.relationship,
    member.currentLocationLabel,
    member.currentSceneNodeId || null,
    member.memorySealed ? 1 : 0,
    member.updatedAt,
    member.conversationId,
    member.id,
    expectedRevision
  );
  return result.changes
    ? getCastMember(database, member.conversationId, member.id)
    : null;
}

export function deleteCastMember(database, conversationId, memberId, expectedRevision) {
  return database.prepare(
    `DELETE FROM cast_members
     WHERE conversation_id = ? AND id = ? AND revision = ? AND member_type = 'npc'`
  ).run(conversationId, memberId, expectedRevision).changes > 0;
}

export function listCastAliases(database, conversationId, memberId) {
  return database.prepare(
    `SELECT id, alias, alias_key, created_at FROM cast_member_aliases
     WHERE conversation_id = ? AND member_id = ?
     ORDER BY alias COLLATE NOCASE ASC, created_at ASC`
  ).all(conversationId, memberId).map((row) => ({
    id: row.id,
    alias: row.alias,
    aliasKey: row.alias_key,
    createdAt: row.created_at,
  }));
}

export function replaceCastAliases(database, conversationId, memberId, aliases) {
  database.prepare(
    'DELETE FROM cast_member_aliases WHERE conversation_id = ? AND member_id = ?'
  ).run(conversationId, memberId);
  const insert = database.prepare(
    `INSERT INTO cast_member_aliases
     (id, conversation_id, member_id, alias, alias_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const alias of aliases) {
    insert.run(alias.id, conversationId, memberId, alias.alias, alias.aliasKey, alias.createdAt);
  }
}

export function listCastMemories(database, conversationId, memberId, options = {}) {
  const limit = Math.max(1, Number(options.limit || 100));
  const offset = Math.max(0, Number(options.offset || 0));
  const includeForgotten = options.includeForgotten === true;
  return database.prepare(
    `SELECT * FROM cast_memories
     WHERE conversation_id = ? AND member_id = ?
       AND (? = 1 OR forgotten_at IS NULL)
     ORDER BY forgotten_at IS NOT NULL ASC, importance DESC, updated_at DESC, rowid DESC
     LIMIT ? OFFSET ?`
  ).all(conversationId, memberId, includeForgotten ? 1 : 0, limit, offset).map(toCastMemory);
}

export function countCastMemories(database, conversationId, memberId, options = {}) {
  const includeForgotten = options.includeForgotten === true;
  return Number(database.prepare(
    `SELECT COUNT(*) AS count FROM cast_memories
     WHERE conversation_id = ? AND member_id = ?
       AND (? = 1 OR forgotten_at IS NULL)`
  ).get(conversationId, memberId, includeForgotten ? 1 : 0)?.count || 0);
}

export function getCastMemory(database, conversationId, memberId, memoryId) {
  const row = database.prepare(
    `SELECT * FROM cast_memories
     WHERE conversation_id = ? AND member_id = ? AND id = ?`
  ).get(conversationId, memberId, memoryId);
  return row ? toCastMemory(row) : null;
}

export function findCastMemoryByContentKey(database, conversationId, memberId, contentKey) {
  const row = database.prepare(
    `SELECT * FROM cast_memories
     WHERE conversation_id = ? AND member_id = ? AND content_key = ?`
  ).get(conversationId, memberId, contentKey);
  return row ? toCastMemory(row) : null;
}

export function insertCastMemory(database, memory) {
  database.prepare(
    `INSERT INTO cast_memories (
       id, conversation_id, member_id, memory_type, content, content_key, layer,
       importance, emotional_intensity, decay_rate, last_reinforced_at,
       reinforcement_count, forgotten_at, linked_memory_ids_json,
       shared_member_ids_json, source_kind, source_message_id, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(...castMemoryValues(memory));
  return getCastMemory(database, memory.conversationId, memory.memberId, memory.id);
}

export function updateCastMemory(database, memory, expectedRevision) {
  const result = database.prepare(
    `UPDATE cast_memories SET
       memory_type = ?, content = ?, content_key = ?, layer = ?, importance = ?,
       emotional_intensity = ?, decay_rate = ?, last_reinforced_at = ?,
       reinforcement_count = ?, forgotten_at = ?, linked_memory_ids_json = ?,
       shared_member_ids_json = ?, source_kind = ?, source_message_id = ?,
       revision = revision + 1, updated_at = ?
     WHERE conversation_id = ? AND member_id = ? AND id = ? AND revision = ?`
  ).run(
    memory.memoryType,
    memory.content,
    memory.contentKey,
    memory.layer,
    memory.importance,
    memory.emotionalIntensity,
    memory.decayRate,
    memory.lastReinforcedAt,
    memory.reinforcementCount,
    memory.forgottenAt,
    JSON.stringify(memory.linkedMemoryIds),
    JSON.stringify(memory.sharedMemberIds),
    memory.sourceKind,
    memory.sourceMessageId,
    memory.updatedAt,
    memory.conversationId,
    memory.memberId,
    memory.id,
    expectedRevision
  );
  return result.changes
    ? getCastMemory(database, memory.conversationId, memory.memberId, memory.id)
    : null;
}

export function deleteCastMemory(database, conversationId, memberId, memoryId, expectedRevision) {
  return database.prepare(
    `DELETE FROM cast_memories
     WHERE conversation_id = ? AND member_id = ? AND id = ? AND revision = ?`
  ).run(conversationId, memberId, memoryId, expectedRevision).changes > 0;
}

export function listCastBehaviors(database, conversationId, memberId) {
  return database.prepare(
    `SELECT * FROM cast_behaviors
     WHERE conversation_id = ? AND member_id = ?
     ORDER BY enabled DESC, priority DESC, created_at ASC, rowid ASC`
  ).all(conversationId, memberId).map(toCastBehavior);
}

export function getCastBehavior(database, conversationId, memberId, behaviorId) {
  const row = database.prepare(
    `SELECT * FROM cast_behaviors
     WHERE conversation_id = ? AND member_id = ? AND id = ?`
  ).get(conversationId, memberId, behaviorId);
  return row ? toCastBehavior(row) : null;
}

export function findCastBehaviorByRuleKey(database, conversationId, memberId, ruleKey) {
  const row = database.prepare(
    `SELECT * FROM cast_behaviors
     WHERE conversation_id = ? AND member_id = ? AND rule_key = ?`
  ).get(conversationId, memberId, ruleKey);
  return row ? toCastBehavior(row) : null;
}

export function insertCastBehavior(database, behavior) {
  database.prepare(
    `INSERT INTO cast_behaviors (
       id, conversation_id, member_id, behavior_type, trigger_condition, action,
       rule_key, priority, enabled, source_kind, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    behavior.id,
    behavior.conversationId,
    behavior.memberId,
    behavior.behaviorType,
    behavior.triggerCondition,
    behavior.action,
    behavior.ruleKey,
    behavior.priority,
    behavior.enabled ? 1 : 0,
    behavior.sourceKind,
    behavior.createdAt,
    behavior.updatedAt
  );
  return getCastBehavior(database, behavior.conversationId, behavior.memberId, behavior.id);
}

export function updateCastBehavior(database, behavior, expectedRevision) {
  const result = database.prepare(
    `UPDATE cast_behaviors SET
       behavior_type = ?, trigger_condition = ?, action = ?, rule_key = ?,
       priority = ?, enabled = ?, source_kind = ?, revision = revision + 1,
       updated_at = ?
     WHERE conversation_id = ? AND member_id = ? AND id = ? AND revision = ?`
  ).run(
    behavior.behaviorType,
    behavior.triggerCondition,
    behavior.action,
    behavior.ruleKey,
    behavior.priority,
    behavior.enabled ? 1 : 0,
    behavior.sourceKind,
    behavior.updatedAt,
    behavior.conversationId,
    behavior.memberId,
    behavior.id,
    expectedRevision
  );
  return result.changes
    ? getCastBehavior(database, behavior.conversationId, behavior.memberId, behavior.id)
    : null;
}

export function deleteCastBehavior(database, conversationId, memberId, behaviorId, expectedRevision) {
  return database.prepare(
    `DELETE FROM cast_behaviors
     WHERE conversation_id = ? AND member_id = ? AND id = ? AND revision = ?`
  ).run(conversationId, memberId, behaviorId, expectedRevision).changes > 0;
}

export function getCastAppearance(database, conversationId, memberId) {
  const row = database.prepare(
    `SELECT * FROM cast_appearances
     WHERE conversation_id = ? AND member_id = ?`
  ).get(conversationId, memberId);
  return row ? toCastAppearance(row) : null;
}

export function upsertCastAppearance(database, appearance, expectedRevision = null) {
  if (expectedRevision == null) {
    database.prepare(
      `INSERT INTO cast_appearances (
         member_id, conversation_id, summary, outfit, injuries_json,
         transformations_json, details_json, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(...castAppearanceValues(appearance));
  } else {
    const result = database.prepare(
      `UPDATE cast_appearances SET
         summary = ?, outfit = ?, injuries_json = ?, transformations_json = ?,
         details_json = ?, revision = revision + 1, updated_at = ?
       WHERE conversation_id = ? AND member_id = ? AND revision = ?`
    ).run(
      appearance.summary,
      appearance.outfit,
      JSON.stringify(appearance.injuries),
      JSON.stringify(appearance.transformations),
      JSON.stringify(appearance.details),
      appearance.updatedAt,
      appearance.conversationId,
      appearance.memberId,
      expectedRevision
    );
    if (!result.changes) return null;
  }
  return getCastAppearance(database, appearance.conversationId, appearance.memberId);
}

export function deleteCastAppearance(database, conversationId, memberId, expectedRevision) {
  return database.prepare(
    `DELETE FROM cast_appearances
     WHERE conversation_id = ? AND member_id = ? AND revision = ?`
  ).run(conversationId, memberId, expectedRevision).changes > 0;
}

export function insertCastActivity(database, activity) {
  database.prepare(
    `INSERT INTO cast_activities (
       id, conversation_id, member_id, title, location_node_id, status,
       start_tick, end_tick, source_kind, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    activity.id,
    activity.conversationId,
    activity.memberId,
    activity.title,
    activity.locationNodeId,
    activity.status,
    activity.startTick,
    activity.endTick,
    activity.sourceKind,
    JSON.stringify(activity.metadata || {}),
    activity.createdAt,
    activity.updatedAt
  );
}

export function listCastActivities(database, conversationId, options = {}) {
  const memberId = String(options.memberId || '');
  const status = String(options.status || '');
  const atTick = Number(options.atTick);
  const hasTick = Number.isFinite(atTick);
  return database.prepare(
    `SELECT cast_activities.*, cast_members.canonical_name
     FROM cast_activities
     JOIN cast_members ON cast_members.id = cast_activities.member_id
     WHERE cast_activities.conversation_id = ?
       AND (? = '' OR cast_activities.member_id = ?)
       AND (? = '' OR cast_activities.status = ?)
       AND (? = 0 OR (cast_activities.start_tick <= ? AND cast_activities.end_tick >= ?))
     ORDER BY cast_activities.start_tick ASC, cast_activities.created_at ASC`
  ).all(
    conversationId,
    memberId,
    memberId,
    status,
    status,
    hasTick ? 1 : 0,
    atTick || 0,
    atTick || 0
  ).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    memberName: row.canonical_name,
    title: row.title,
    locationNodeId: row.location_node_id || '',
    status: row.status,
    startTick: row.start_tick,
    endTick: row.end_tick,
    sourceKind: row.source_kind,
    metadata: parseCastJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getCastMemberUsageCounts(database, conversationId, memberId) {
  const row = database.prepare(
    `SELECT
       (SELECT COUNT(*) FROM cast_memories WHERE conversation_id = ? AND member_id = ?) AS memories,
       (SELECT COUNT(*) FROM cast_behaviors WHERE conversation_id = ? AND member_id = ?) AS behaviors,
       (SELECT COUNT(*) FROM scene_items WHERE conversation_id = ? AND owner_member_id = ?) AS items,
       (SELECT COUNT(*) FROM cast_appearances WHERE conversation_id = ? AND member_id = ?) AS appearances,
       (SELECT COUNT(*) FROM cast_activities WHERE conversation_id = ? AND member_id = ?) AS activities`
  ).get(
    conversationId, memberId,
    conversationId, memberId,
    conversationId, memberId,
    conversationId, memberId,
    conversationId, memberId
  );
  return {
    memories: Number(row?.memories || 0),
    behaviors: Number(row?.behaviors || 0),
    items: Number(row?.items || 0),
    appearances: Number(row?.appearances || 0),
    activities: Number(row?.activities || 0),
  };
}

export function insertCastChangeBatch(database, batch) {
  database.prepare(
    `INSERT INTO cast_change_batches (
       id, conversation_id, source_kind, scope_member_id, idempotency_key,
       status, plan_json, result_json, created_at, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    batch.id,
    batch.conversationId,
    batch.sourceKind,
    batch.scopeMemberId || null,
    batch.idempotencyKey,
    batch.status,
    JSON.stringify(batch.plan || {}),
    JSON.stringify(batch.result || {}),
    batch.createdAt,
    batch.appliedAt
  );
}

export function getCastChangeBatchByKey(database, conversationId, idempotencyKey) {
  const row = database.prepare(
    `SELECT * FROM cast_change_batches
     WHERE conversation_id = ? AND idempotency_key = ?`
  ).get(conversationId, idempotencyKey);
  return row ? toCastChangeBatch(row) : null;
}

export function updateCastChangeBatch(database, batchId, status, result, appliedAt) {
  database.prepare(
    `UPDATE cast_change_batches SET status = ?, result_json = ?, applied_at = ?
     WHERE id = ?`
  ).run(status, JSON.stringify(result || {}), appliedAt, batchId);
}

export function getLatestCastChangeBatch(database, conversationId, sourceKind = '') {
  const row = database.prepare(
    `SELECT * FROM cast_change_batches
     WHERE conversation_id = ? AND (? = '' OR source_kind = ?)
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(conversationId, sourceKind, sourceKind);
  return row ? toCastChangeBatch(row) : null;
}

export function getConversationEvidenceMessages(database, conversationId, messageIds) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : []).filter(Boolean))].slice(0, 80);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return database.prepare(
    `SELECT id, role, content, created_at FROM messages
     WHERE conversation_id = ? AND id IN (${placeholders})`
  ).all(conversationId, ...ids).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export function listRecentConversationEvidenceMessages(database, conversationId, options = {}) {
  const numericLimit = Number(options.limit);
  const limit = Number.isFinite(numericLimit)
    ? Math.min(80, Math.max(1, Math.round(numericLimit)))
    : 80;
  return database.prepare(
    `SELECT id, role, content, created_at FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT ?`
  ).all(conversationId, limit).reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

function castMemoryValues(memory) {
  return [
    memory.id,
    memory.conversationId,
    memory.memberId,
    memory.memoryType,
    memory.content,
    memory.contentKey,
    memory.layer,
    memory.importance,
    memory.emotionalIntensity,
    memory.decayRate,
    memory.lastReinforcedAt,
    memory.reinforcementCount,
    memory.forgottenAt,
    JSON.stringify(memory.linkedMemoryIds),
    JSON.stringify(memory.sharedMemberIds),
    memory.sourceKind,
    memory.sourceMessageId,
    memory.createdAt,
    memory.updatedAt,
  ];
}

function castAppearanceValues(appearance) {
  return [
    appearance.memberId,
    appearance.conversationId,
    appearance.summary,
    appearance.outfit,
    JSON.stringify(appearance.injuries),
    JSON.stringify(appearance.transformations),
    JSON.stringify(appearance.details),
    appearance.createdAt,
    appearance.updatedAt,
  ];
}

function toCastMember(database, row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memberType: row.member_type,
    canonicalName: row.canonical_name,
    nameKey: row.name_key,
    aliases: listCastAliases(database, row.conversation_id, row.id).map((entry) => entry.alias),
    source: row.source,
    evidence: row.evidence,
    confidence: row.confidence,
    visibility: row.visibility,
    status: row.status,
    customStatus: row.custom_status,
    relationship: row.relationship,
    currentLocationLabel: row.current_location_label,
    currentSceneNodeId: row.current_scene_node_id || '',
    memorySealed: Boolean(row.memory_sealed),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCastMemory(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    memoryType: row.memory_type,
    content: row.content,
    contentKey: row.content_key,
    layer: row.layer,
    importance: row.importance,
    emotionalIntensity: row.emotional_intensity,
    decayRate: row.decay_rate,
    lastReinforcedAt: row.last_reinforced_at || '',
    reinforcementCount: row.reinforcement_count,
    forgottenAt: row.forgotten_at || '',
    linkedMemoryIds: parseCastJson(row.linked_memory_ids_json, []),
    sharedMemberIds: parseCastJson(row.shared_member_ids_json, []),
    sourceKind: row.source_kind,
    sourceMessageId: row.source_message_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCastBehavior(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    memberId: row.member_id,
    behaviorType: row.behavior_type,
    triggerCondition: row.trigger_condition,
    action: row.action,
    ruleKey: row.rule_key,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    sourceKind: row.source_kind,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCastAppearance(row) {
  return {
    memberId: row.member_id,
    conversationId: row.conversation_id,
    summary: row.summary,
    outfit: row.outfit,
    injuries: parseCastJson(row.injuries_json, []),
    transformations: parseCastJson(row.transformations_json, []),
    details: parseCastJson(row.details_json, {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCastChangeBatch(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceKind: row.source_kind,
    scopeMemberId: row.scope_member_id || '',
    idempotencyKey: row.idempotency_key,
    status: row.status,
    plan: parseCastJson(row.plan_json, {}),
    result: parseCastJson(row.result_json, {}),
    createdAt: row.created_at,
    appliedAt: row.applied_at || '',
  };
}
