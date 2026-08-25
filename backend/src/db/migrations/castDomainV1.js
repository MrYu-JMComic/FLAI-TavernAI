import { newId, nowIso } from '../../security.js';
import {
  castBehaviorRuleKey,
  castContentKey,
  castNameKey,
  normalizeCastName,
  normalizeCastText,
  normalizeItemCode,
  parseCastJson,
} from '../../domain/cast/normalization.js';
import { CAST_SCHEMA_VERSION, CAST_SCHEMA_VERSION_KEY } from '../../domain/cast/constants.js';

const LEGACY_TABLES = Object.freeze([
  'npc_registry',
  'npc_memories',
  'npc_behaviors',
  'npc_activities',
  'npc_personality_anchors',
  'npc_emotion_vectors',
  'npc_emotion_history',
  'actor_appearances',
  'appearance_audit',
  'npc_turn_queue',
  'npc_profile_audit',
  'npc_item_audit',
  'scene_item_audit',
]);

const JSON_COLUMNS = Object.freeze({
  cast_memories: ['linked_memory_ids_json', 'shared_member_ids_json'],
  cast_personality_anchors: ['anchor_json'],
  cast_emotion_states: ['emotion_json'],
  cast_emotion_history: ['emotion_json', 'impact_json'],
  cast_appearances: ['injuries_json', 'transformations_json', 'details_json'],
  cast_activities: ['metadata_json'],
  cast_turn_queue: ['payload_json'],
  conversation_turns: ['metadata_json'],
  scene_items: ['state_json', 'position_json', 'coverage_json'],
  cast_change_batches: ['plan_json', 'result_json'],
  conversation_audit_events: ['before_json', 'after_json', 'metadata_json'],
});

export function migrateCastDomainV1(database) {
  if (schemaVersion(database) === CAST_SCHEMA_VERSION) {
    return { migrated: false };
  }

  const foreignKeysEnabled = Boolean(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys);
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN IMMEDIATE');
  try {
    const legacyTurnTable = renameLegacyTable(database, 'conversation_turns');
    const legacyItemTable = renameLegacyTable(database, 'scene_items');
    createCastTables(database);

    const context = createMigrationContext(database);
    migrateMembers(database, context);
    migrateAliases(database, context);
    migrateMemories(database, context);
    migrateBehaviors(database, context);
    migratePersonality(database, context);
    migrateEmotions(database, context);
    migrateAppearances(database, context);
    migrateActivities(database, context);
    migrateTurnQueue(database, context);
    migrateConversationTurns(database, context, legacyTurnTable);
    migrateItems(database, context, legacyItemTable);
    migrateLegacyAudits(database, context);

    validateMigration(database);
    dropLegacyTables(database, legacyTurnTable, legacyItemTable);
    database.prepare(
      'INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (?, ?)'
    ).run(CAST_SCHEMA_VERSION_KEY, CAST_SCHEMA_VERSION);
    database.exec('COMMIT');
    return { migrated: true, stats: context.stats };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function schemaVersion(database) {
  if (!tableExists(database, '_schema_meta')) return '';
  return database.prepare('SELECT value FROM _schema_meta WHERE key = ?').get(CAST_SCHEMA_VERSION_KEY)?.value || '';
}

function renameLegacyTable(database, tableName) {
  if (!tableExists(database, tableName)) return '';
  const legacyName = `${tableName}_legacy_cast_v1`;
  if (tableExists(database, legacyName)) {
    throw new Error(`Cannot migrate ${tableName}: ${legacyName} already exists`);
  }
  database.exec(`ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(legacyName)}`);
  return legacyName;
}

function createCastTables(database) {
  database.exec(`
    CREATE TABLE cast_members (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_type TEXT NOT NULL CHECK (member_type IN ('protagonist', 'npc')),
      canonical_name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
      visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
      status TEXT NOT NULL DEFAULT 'active',
      custom_status TEXT NOT NULL DEFAULT '',
      relationship TEXT NOT NULL DEFAULT '',
      current_location_label TEXT NOT NULL DEFAULT '',
      current_scene_node_id TEXT,
      memory_sealed INTEGER NOT NULL DEFAULT 0 CHECK (memory_sealed IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (current_scene_node_id) REFERENCES scene_nodes(id) ON DELETE SET NULL,
      UNIQUE(conversation_id, name_key)
    );

    CREATE TABLE cast_member_aliases (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, alias_key),
      UNIQUE(member_id, alias_key)
    );

    CREATE TABLE cast_memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'event',
      content TEXT NOT NULL,
      content_key TEXT NOT NULL,
      layer TEXT NOT NULL DEFAULT 'short_term',
      importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
      emotional_intensity REAL NOT NULL DEFAULT 0 CHECK (emotional_intensity >= 0 AND emotional_intensity <= 1),
      decay_rate REAL NOT NULL DEFAULT 0 CHECK (decay_rate >= 0 AND decay_rate <= 1),
      last_reinforced_at TEXT,
      reinforcement_count INTEGER NOT NULL DEFAULT 0 CHECK (reinforcement_count >= 0),
      forgotten_at TEXT,
      linked_memory_ids_json TEXT NOT NULL DEFAULT '[]',
      shared_member_ids_json TEXT NOT NULL DEFAULT '[]',
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_message_id TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE,
      UNIQUE(member_id, content_key)
    );

    CREATE TABLE cast_behaviors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      behavior_type TEXT NOT NULL DEFAULT 'reaction',
      trigger_condition TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      rule_key TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      source_kind TEXT NOT NULL DEFAULT 'manual',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE,
      UNIQUE(member_id, rule_key)
    );

    CREATE TABLE cast_personality_anchors (
      member_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      anchor_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );

    CREATE TABLE cast_emotion_states (
      member_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      emotion_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );

    CREATE TABLE cast_emotion_history (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      emotion_json TEXT NOT NULL DEFAULT '{}',
      impact_json TEXT NOT NULL DEFAULT '{}',
      trigger TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );

    CREATE TABLE cast_appearances (
      member_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      outfit TEXT NOT NULL DEFAULT '',
      injuries_json TEXT NOT NULL DEFAULT '[]',
      transformations_json TEXT NOT NULL DEFAULT '[]',
      details_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );

    CREATE TABLE cast_activities (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      title TEXT NOT NULL,
      location_node_id TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      start_tick INTEGER NOT NULL,
      end_tick INTEGER NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE,
      FOREIGN KEY (location_node_id) REFERENCES scene_nodes(id) ON DELETE SET NULL,
      CHECK (end_tick >= start_tick)
    );

    CREATE TABLE cast_turn_queue (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      order_index INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );

    CREATE TABLE conversation_turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      speaker_kind TEXT NOT NULL DEFAULT 'system' CHECK (speaker_kind IN ('user', 'assistant', 'cast', 'system')),
      speaker_member_id TEXT,
      speaker_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      turn_index INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (speaker_member_id) REFERENCES cast_members(id) ON DELETE SET NULL
    );

    CREATE TABLE scene_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      node_id TEXT,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('world', 'cast')),
      owner_member_id TEXT,
      item_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      state_json TEXT NOT NULL DEFAULT '{}',
      position_json TEXT NOT NULL DEFAULT '{}',
      movable INTEGER NOT NULL DEFAULT 0 CHECK (movable IN (0, 1)),
      item_kind TEXT NOT NULL DEFAULT 'item',
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
      clothing_slot TEXT NOT NULL DEFAULT '',
      equipped INTEGER NOT NULL DEFAULT 0 CHECK (equipped IN (0, 1)),
      coverage_json TEXT NOT NULL DEFAULT '[]',
      icon_key TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES scene_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_member_id) REFERENCES cast_members(id) ON DELETE CASCADE,
      UNIQUE(conversation_id, item_code),
      CHECK (
        (owner_kind = 'world' AND node_id IS NOT NULL AND owner_member_id IS NULL)
        OR (owner_kind = 'cast' AND node_id IS NULL AND owner_member_id IS NOT NULL)
      )
    );

    CREATE TABLE cast_change_batches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'auto_sync', 'ai_organize', 'migration')),
      scope_member_id TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
      plan_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      applied_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (scope_member_id) REFERENCES cast_members(id) ON DELETE SET NULL,
      UNIQUE(conversation_id, idempotency_key)
    );

    CREATE TABLE conversation_audit_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      batch_id TEXT,
      member_id TEXT,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      before_json TEXT NOT NULL DEFAULT 'null',
      after_json TEXT NOT NULL DEFAULT 'null',
      before_revision INTEGER,
      after_revision INTEGER,
      rollback_of_event_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES cast_change_batches(id) ON DELETE SET NULL,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE SET NULL,
      FOREIGN KEY (rollback_of_event_id) REFERENCES conversation_audit_events(id) ON DELETE SET NULL
    );
  `);
}

function createMigrationContext(database) {
  const conversations = new Map(
    database.prepare(
      `SELECT conversations.id, characters.name AS character_name
       FROM conversations
       JOIN characters ON characters.id = conversations.character_id`
    ).all().map((row) => [row.id, row])
  );
  return {
    conversations,
    memberByName: new Map(),
    protagonistByConversation: new Map(),
    stats: Object.create(null),
  };
}

function migrateMembers(database, context) {
  const insert = database.prepare(
    `INSERT INTO cast_members (
       id, conversation_id, member_type, canonical_name, name_key, source, evidence,
       confidence, visibility, status, custom_status, relationship,
       current_location_label, current_scene_node_id, memory_sealed, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const timestamp = nowIso();
  for (const conversation of context.conversations.values()) {
    const name = normalizeCastName(conversation.character_name) || 'Protagonist';
    const member = {
      id: newId(),
      conversationId: conversation.id,
      memberType: 'protagonist',
      canonicalName: name,
      nameKey: castNameKey(name),
    };
    insert.run(
      member.id, member.conversationId, member.memberType, member.canonicalName, member.nameKey,
      'character', '', 1, 'visible', 'active', '', '', '', null, 0, timestamp, timestamp
    );
    rememberMember(context, member);
    context.protagonistByConversation.set(conversation.id, member);
  }

  const sourceTables = [
    'npc_registry', 'npc_memories', 'npc_behaviors', 'npc_activities',
    'npc_personality_anchors', 'npc_emotion_vectors', 'npc_emotion_history',
    'actor_appearances', 'npc_turn_queue', 'npc_profile_audit', 'npc_item_audit',
  ];
  for (const tableName of sourceTables) {
    for (const row of readLegacyRows(database, tableName)) {
      const conversationId = stringField(row, ['conversation_id']);
      assertConversation(context, conversationId, tableName);
      if (tableName === 'actor_appearances'
        && isProtagonistOwner(stringField(row, ['actor_type', 'owner_type', 'member_type']))) {
        continue;
      }
      const name = legacyMemberName(row);
      if (name) ensureNpcMember(database, context, conversationId, name, row, tableName);
    }
  }
  for (const row of readLegacyRows(database, 'scene_items_legacy_cast_v1')) {
    const ownerType = stringField(row, ['owner_type', 'owner_kind']).toLowerCase();
    if (ownerType === 'world') continue;
    const conversationId = stringField(row, ['conversation_id']);
    assertConversation(context, conversationId, 'scene_items');
    const ownerName = stringField(row, ['owner_name', 'actor_name', 'npc_name']);
    if (isProtagonistOwner(ownerType) || !ownerName) continue;
    ensureNpcMember(database, context, conversationId, ownerName, row, 'scene_items');
  }
}

function ensureNpcMember(database, context, conversationId, rawName, row, sourceTable) {
  const canonicalName = normalizeCastName(rawName);
  if (!canonicalName) return null;
  const key = memberMapKey(conversationId, castNameKey(canonicalName));
  const existing = context.memberByName.get(key);
  if (existing) {
    mergeMemberProfile(database, existing, row);
    if (existing.memberType === 'protagonist' || existing.canonicalName !== canonicalName) {
      writeMigrationNote(database, conversationId, existing.id, 'member', existing.id, {
        reason: 'name_key_merged', sourceTable, incomingName: canonicalName,
      });
    }
    return existing;
  }

  const timestamp = timestampField(row, ['created_at'], nowIso());
  const updatedAt = timestampField(row, ['updated_at'], timestamp);
  const member = {
    id: availableId(database, 'cast_members', stringField(row, ['id'])),
    conversationId,
    memberType: 'npc',
    canonicalName,
    nameKey: castNameKey(canonicalName),
  };
  database.prepare(
    `INSERT INTO cast_members (
       id, conversation_id, member_type, canonical_name, name_key, source, evidence,
       confidence, visibility, status, custom_status, relationship,
       current_location_label, current_scene_node_id, memory_sealed, revision,
       created_at, updated_at
     ) VALUES (?, ?, 'npc', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    member.id,
    conversationId,
    canonicalName,
    member.nameKey,
    normalizeCastText(stringField(row, ['source']), 80) || 'migration',
    normalizeCastText(stringField(row, ['evidence']), 4_000),
    clampNumber(numberField(row, ['confidence'], 0), 0, 1),
    booleanField(row, ['hidden'], false) ? 'hidden' : 'visible',
    normalizeCastText(stringField(row, ['status']), 80) || 'active',
    normalizeCastText(stringField(row, ['custom_status']), 500),
    normalizeCastText(stringField(row, ['relationship']), 1_000),
    normalizeCastText(stringField(row, ['current_location', 'current_location_label']), 500),
    validSceneNode(database, conversationId, stringField(row, ['current_scene_node_id', 'location_node_id'])),
    booleanField(row, ['memory_sealed'], false) ? 1 : 0,
    timestamp,
    updatedAt
  );
  rememberMember(context, member);
  incrementStat(context, 'members');
  return member;
}

function mergeMemberProfile(database, member, row) {
  database.prepare(
    `UPDATE cast_members SET
       evidence = CASE WHEN evidence = '' THEN ? ELSE evidence END,
       confidence = MAX(confidence, ?),
       visibility = CASE WHEN ? = 1 THEN 'hidden' ELSE visibility END,
       custom_status = CASE WHEN custom_status = '' THEN ? ELSE custom_status END,
       relationship = CASE WHEN relationship = '' THEN ? ELSE relationship END,
       current_location_label = CASE WHEN current_location_label = '' THEN ? ELSE current_location_label END,
       memory_sealed = MAX(memory_sealed, ?),
       updated_at = MAX(updated_at, ?)
     WHERE id = ?`
  ).run(
    normalizeCastText(stringField(row, ['evidence']), 4_000),
    clampNumber(numberField(row, ['confidence'], 0), 0, 1),
    booleanField(row, ['hidden'], false) ? 1 : 0,
    normalizeCastText(stringField(row, ['custom_status']), 500),
    normalizeCastText(stringField(row, ['relationship']), 1_000),
    normalizeCastText(stringField(row, ['current_location', 'current_location_label']), 500),
    booleanField(row, ['memory_sealed'], false) ? 1 : 0,
    timestampField(row, ['updated_at', 'created_at'], nowIso()),
    member.id
  );
}

function migrateAliases(database, context) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_member_aliases
     (id, conversation_id, member_id, alias, alias_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_registry')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = resolveMember(context, conversationId, legacyMemberName(row));
    if (!member) continue;
    const aliases = parseAliasList(row.aliases);
    for (const rawAlias of aliases) {
      const alias = normalizeCastName(rawAlias);
      const aliasKey = castNameKey(alias);
      if (!alias || aliasKey === member.nameKey) continue;
      const claimedMember = context.memberByName.get(memberMapKey(conversationId, aliasKey));
      if (claimedMember && claimedMember.id !== member.id) {
        writeMigrationNote(database, conversationId, member.id, 'member', member.id, {
          reason: 'alias_conflicts_with_name', alias,
        });
        continue;
      }
      const result = insert.run(newId(), conversationId, member.id, alias, aliasKey, timestampField(row, ['created_at'], nowIso()));
      if (!result.changes) {
        writeMigrationNote(database, conversationId, member.id, 'member', member.id, {
          reason: 'alias_conflict_skipped', alias,
        });
      } else {
        context.memberByName.set(memberMapKey(conversationId, aliasKey), member);
        incrementStat(context, 'aliases');
      }
    }
  }
}

function migrateMemories(database, context) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_memories (
       id, conversation_id, member_id, memory_type, content, content_key, layer,
       importance, emotional_intensity, decay_rate, last_reinforced_at,
       reinforcement_count, forgotten_at, linked_memory_ids_json,
       shared_member_ids_json, source_kind, source_message_id, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_memories')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_memories');
    const content = normalizeCastText(stringField(row, ['content', 'memory']), 20_000);
    const createdAt = timestampField(row, ['created_at'], nowIso());
    const result = insert.run(
      availableId(database, 'cast_memories', stringField(row, ['id'])),
      conversationId,
      member.id,
      normalizeCastText(stringField(row, ['memory_type', 'type']), 80) || 'event',
      content,
      castContentKey(content),
      normalizeCastText(stringField(row, ['layer']), 80) || 'short_term',
      clampNumber(numberField(row, ['importance'], 0.5), 0, 1),
      clampNumber(numberField(row, ['emotional_intensity'], 0), 0, 1),
      clampNumber(numberField(row, ['decay_rate'], 0), 0, 1),
      nullableStringField(row, ['last_reinforced_at']),
      Math.max(0, integerField(row, ['reinforcement_count'], 0)),
      nullableStringField(row, ['forgotten_at']),
      jsonText(row.linked_memory_ids_json ?? row.linked_memory_ids, []),
      jsonText(row.shared_member_ids_json ?? row.shared_member_ids, []),
      normalizeCastText(stringField(row, ['source_kind', 'source']), 80) || 'migration',
      normalizeCastText(stringField(row, ['source_message_id']), 160),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    recordMigratedOrMerged(database, context, result, conversationId, member.id, 'memory', stringField(row, ['id']), 'memories');
  }
}

function migrateBehaviors(database, context) {
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_behaviors (
       id, conversation_id, member_id, behavior_type, trigger_condition, action,
       rule_key, priority, enabled, source_kind, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_behaviors')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_behaviors');
    const trigger = normalizeCastText(stringField(row, ['trigger_condition', 'trigger']), 2_000);
    const action = normalizeCastText(stringField(row, ['action']), 4_000);
    const createdAt = timestampField(row, ['created_at'], nowIso());
    const result = insert.run(
      availableId(database, 'cast_behaviors', stringField(row, ['id'])),
      conversationId,
      member.id,
      normalizeCastText(stringField(row, ['behavior_type', 'type']), 80) || 'reaction',
      trigger,
      action,
      castBehaviorRuleKey(trigger, action),
      integerField(row, ['priority'], 0),
      booleanField(row, ['enabled'], true) ? 1 : 0,
      normalizeCastText(stringField(row, ['source_kind', 'source']), 80) || 'migration',
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    recordMigratedOrMerged(database, context, result, conversationId, member.id, 'behavior', stringField(row, ['id']), 'behaviors');
  }
}

function migratePersonality(database, context) {
  const rows = readLegacyRows(database, 'npc_personality_anchors');
  const insert = database.prepare(
    `INSERT INTO cast_personality_anchors
     (member_id, conversation_id, anchor_json, revision, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       anchor_json = excluded.anchor_json,
       revision = cast_personality_anchors.revision + 1,
       updated_at = excluded.updated_at`
  );
  for (const row of rows) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_personality_anchors');
    const createdAt = timestampField(row, ['created_at'], nowIso());
    insert.run(
      member.id,
      conversationId,
      jsonText(row.anchor_json ?? row.anchor_data ?? row.personality_json ?? row.personality, {}),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    incrementStat(context, 'personality');
  }
}

function migrateEmotions(database, context) {
  const stateInsert = database.prepare(
    `INSERT INTO cast_emotion_states
     (member_id, conversation_id, emotion_json, revision, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       emotion_json = excluded.emotion_json,
       revision = cast_emotion_states.revision + 1,
       updated_at = excluded.updated_at`
  );
  for (const row of readLegacyRows(database, 'npc_emotion_vectors')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_emotion_vectors');
    stateInsert.run(
      member.id,
      conversationId,
      jsonText(row.emotion_json ?? row.emotion_data ?? row.vector_json ?? row.vector, {}),
      timestampField(row, ['updated_at', 'created_at'], nowIso())
    );
    incrementStat(context, 'emotionStates');
  }

  const historyInsert = database.prepare(
    `INSERT INTO cast_emotion_history
     (id, conversation_id, member_id, emotion_json, impact_json, trigger, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_emotion_history')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_emotion_history');
    historyInsert.run(
      availableId(database, 'cast_emotion_history', stringField(row, ['id'])),
      conversationId,
      member.id,
      jsonText(row.emotion_json ?? row.emotion_vector_json ?? row.emotion_data, {}),
      jsonText(row.impact_json ?? row.emotion_impact_json, {}),
      normalizeCastText(stringField(row, ['trigger']), 2_000),
      timestampField(row, ['created_at'], nowIso())
    );
    incrementStat(context, 'emotionHistory');
  }
}

function migrateAppearances(database, context) {
  const insert = database.prepare(
    `INSERT INTO cast_appearances (
       member_id, conversation_id, summary, outfit, injuries_json,
       transformations_json, details_json, revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET
       summary = excluded.summary,
       outfit = excluded.outfit,
       injuries_json = excluded.injuries_json,
       transformations_json = excluded.transformations_json,
       details_json = excluded.details_json,
       revision = cast_appearances.revision + 1,
       updated_at = excluded.updated_at`
  );
  for (const row of readLegacyRows(database, 'actor_appearances')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = resolveLegacyActor(context, conversationId, row, 'actor_appearances');
    const createdAt = timestampField(row, ['created_at'], nowIso());
    insert.run(
      member.id,
      conversationId,
      normalizeCastText(stringField(row, ['summary', 'appearance', 'description']), 8_000),
      normalizeCastText(stringField(row, ['outfit', 'clothing']), 4_000),
      jsonText(row.injuries_json ?? row.injuries, []),
      jsonText(row.transformations_json ?? row.transformations, []),
      jsonText(row.details_json ?? row.details ?? row.appearance_json, {}),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    incrementStat(context, 'appearances');
  }
}

function migrateActivities(database, context) {
  const insert = database.prepare(
    `INSERT INTO cast_activities (
       id, conversation_id, member_id, title, location_node_id, status,
       start_tick, end_tick, source_kind, metadata_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_activities')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_activities');
    const createdAt = timestampField(row, ['created_at'], nowIso());
    const startTick = integerField(row, ['start_tick'], 0);
    insert.run(
      availableId(database, 'cast_activities', stringField(row, ['id'])),
      conversationId,
      member.id,
      normalizeCastText(stringField(row, ['title', 'activity']), 500) || 'Activity',
      validSceneNode(database, conversationId, stringField(row, ['location_node_id'])),
      normalizeCastText(stringField(row, ['status']), 80) || 'scheduled',
      startTick,
      Math.max(startTick, integerField(row, ['end_tick'], startTick)),
      normalizeCastText(stringField(row, ['source_kind', 'source']), 80) || 'migration',
      jsonText(row.metadata_json ?? row.metadata, {}),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    incrementStat(context, 'activities');
  }
}

function migrateTurnQueue(database, context) {
  const insert = database.prepare(
    `INSERT INTO cast_turn_queue (
       id, conversation_id, member_id, status, order_index, payload_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of readLegacyRows(database, 'npc_turn_queue')) {
    const conversationId = stringField(row, ['conversation_id']);
    const member = requireMember(context, conversationId, legacyMemberName(row), 'npc_turn_queue');
    const createdAt = timestampField(row, ['created_at'], nowIso());
    insert.run(
      availableId(database, 'cast_turn_queue', stringField(row, ['id'])),
      conversationId,
      member.id,
      normalizeCastText(stringField(row, ['status']), 80) || 'pending',
      integerField(row, ['order_index', 'turn_index', 'priority'], 0),
      jsonText(row.payload_json ?? row.payload ?? row.context_json, {}),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    incrementStat(context, 'turnQueue');
  }
}

function migrateConversationTurns(database, context, legacyTable) {
  if (!legacyTable) return;
  const insert = database.prepare(
    `INSERT INTO conversation_turns (
       id, conversation_id, speaker_kind, speaker_member_id, speaker_name,
       content, turn_index, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of readRows(database, legacyTable)) {
    const conversationId = stringField(row, ['conversation_id']);
    assertConversation(context, conversationId, 'conversation_turns');
    const rawKind = stringField(row, ['speaker_kind', 'speaker_type', 'role', 'actor_type']).toLowerCase();
    const speakerName = legacyMemberName(row);
    let speakerKind = ['user', 'assistant', 'system'].includes(rawKind) ? rawKind : 'cast';
    let member = null;
    if (speakerKind === 'cast' && speakerName) {
      member = resolveMember(context, conversationId, speakerName)
        || ensureNpcMember(database, context, conversationId, speakerName, row, 'conversation_turns');
    } else if (isProtagonistOwner(rawKind)) {
      speakerKind = 'cast';
      member = context.protagonistByConversation.get(conversationId);
    }
    insert.run(
      availableId(database, 'conversation_turns', stringField(row, ['id'])),
      conversationId,
      speakerKind,
      member?.id || null,
      normalizeCastName(speakerName),
      stringField(row, ['content', 'message', 'text']),
      integerField(row, ['turn_index', 'order_index'], 0),
      jsonText(row.metadata_json ?? row.metadata, {}),
      timestampField(row, ['created_at'], nowIso())
    );
    incrementStat(context, 'conversationTurns');
  }
}

function migrateItems(database, context, legacyTable) {
  if (!legacyTable) return;
  const insert = database.prepare(
    `INSERT INTO scene_items (
       id, conversation_id, node_id, owner_kind, owner_member_id, item_code,
       name, description, state_json, position_json, movable, item_kind,
       quantity, clothing_slot, equipped, coverage_json, icon_key, revision,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const usedCodes = new Map();
  for (const row of readRows(database, legacyTable)) {
    const conversationId = stringField(row, ['conversation_id']);
    assertConversation(context, conversationId, 'scene_items');
    const ownerType = stringField(row, ['owner_type', 'owner_kind']).toLowerCase() || 'world';
    const ownerName = stringField(row, ['owner_name', 'actor_name', 'npc_name']);
    let ownerKind = 'world';
    let ownerMemberId = null;
    let nodeId = validSceneNode(database, conversationId, stringField(row, ['node_id']));
    if (ownerType !== 'world') {
      ownerKind = 'cast';
      const member = isProtagonistOwner(ownerType) || !ownerName
        ? context.protagonistByConversation.get(conversationId)
        : resolveMember(context, conversationId, ownerName)
          || ensureNpcMember(database, context, conversationId, ownerName, row, 'scene_items');
      ownerMemberId = member.id;
      nodeId = null;
    } else if (!nodeId) {
      nodeId = ensureUnresolvedItemNode(database, conversationId);
    }
    const sourceId = stringField(row, ['id']) || newId();
    const baseCode = normalizeItemCode(stringField(row, ['item_code', 'code']), `${conversationId}:${sourceId}`);
    const itemCode = uniqueItemCode(usedCodes, database, conversationId, baseCode, sourceId);
    const createdAt = timestampField(row, ['created_at'], nowIso());
    insert.run(
      availableId(database, 'scene_items', sourceId),
      conversationId,
      nodeId,
      ownerKind,
      ownerMemberId,
      itemCode,
      normalizeCastText(stringField(row, ['name']), 500) || 'Item',
      normalizeCastText(stringField(row, ['description']), 8_000),
      jsonText(row.state_json ?? row.state, {}),
      jsonText(row.position_json ?? row.position, {}),
      booleanField(row, ['movable'], ownerKind === 'cast') ? 1 : 0,
      normalizeCastText(stringField(row, ['item_kind', 'kind']), 80) || 'item',
      Math.max(0, integerField(row, ['quantity'], 1)),
      normalizeCastText(stringField(row, ['clothing_slot']), 80),
      booleanField(row, ['equipped'], false) ? 1 : 0,
      jsonText(row.coverage_json ?? row.coverage, []),
      normalizeCastText(stringField(row, ['icon_key']), 120),
      createdAt,
      timestampField(row, ['updated_at'], createdAt)
    );
    incrementStat(context, 'items');
  }
}

function migrateLegacyAudits(database, context) {
  const specs = [
    ['npc_profile_audit', 'member'],
    ['npc_item_audit', 'cast-resource'],
    ['appearance_audit', 'appearance'],
    ['scene_item_audit', 'item'],
  ];
  const insert = database.prepare(
    `INSERT INTO conversation_audit_events (
       id, conversation_id, batch_id, member_id, subject_type, subject_id,
       action, actor, before_json, after_json, before_revision, after_revision,
       rollback_of_event_id, metadata_json, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
  );
  for (const [tableName, subjectType] of specs) {
    for (const row of readLegacyRows(database, tableName)) {
      const conversationId = stringField(row, ['conversation_id']);
      assertConversation(context, conversationId, tableName);
      const name = legacyMemberName(row);
      const member = name ? resolveMember(context, conversationId, name) : null;
      insert.run(
        availableId(database, 'conversation_audit_events', stringField(row, ['id'])),
        conversationId,
        member?.id || null,
        normalizeCastText(stringField(row, ['item_type', 'subject_type']), 80) || subjectType,
        stringField(row, ['item_id', 'subject_id']),
        normalizeCastText(stringField(row, ['action']), 80) || 'update',
        normalizeCastText(stringField(row, ['actor']), 120) || 'migration',
        jsonText(row.before_json, null),
        jsonText(row.after_json, null),
        JSON.stringify({ migratedFrom: tableName, legacyMemberName: name }),
        timestampField(row, ['created_at'], nowIso())
      );
      incrementStat(context, 'auditEvents');
    }
  }
}

function validateMigration(database) {
  const duplicateProtagonists = database.prepare(
    `SELECT conversation_id FROM cast_members
     WHERE member_type = 'protagonist'
     GROUP BY conversation_id HAVING COUNT(*) <> 1`
  ).all();
  if (duplicateProtagonists.length) {
    throw new Error('Cast migration produced an invalid protagonist count');
  }
  const missingProtagonists = database.prepare(
    `SELECT conversations.id FROM conversations
     LEFT JOIN cast_members ON cast_members.conversation_id = conversations.id
       AND cast_members.member_type = 'protagonist'
     WHERE cast_members.id IS NULL`
  ).all();
  if (missingProtagonists.length) {
    throw new Error('Cast migration did not create every protagonist');
  }
  const invalidOwnership = database.prepare(
    `SELECT id FROM scene_items WHERE NOT (
       (owner_kind = 'world' AND node_id IS NOT NULL AND owner_member_id IS NULL)
       OR (owner_kind = 'cast' AND node_id IS NULL AND owner_member_id IS NOT NULL)
     ) LIMIT 1`
  ).get();
  if (invalidOwnership) {
    throw new Error(`Cast migration produced invalid item ownership: ${invalidOwnership.id}`);
  }
  for (const [tableName, columns] of Object.entries(JSON_COLUMNS)) {
    for (const columnName of columns) {
      const rows = database.prepare(
        `SELECT rowid AS source_rowid, ${quoteIdentifier(columnName)} AS value FROM ${quoteIdentifier(tableName)}`
      ).all();
      for (const row of rows) {
        try {
          JSON.parse(row.value);
        } catch {
          throw new Error(`Cast migration produced invalid JSON in ${tableName}.${columnName} row ${row.source_rowid}`);
        }
      }
    }
  }
  const ignoredLegacyTables = new Set([
    ...LEGACY_TABLES,
    'scene_items_legacy_cast_v1',
    'conversation_turns_legacy_cast_v1',
  ]);
  const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all()
    .filter((row) => !ignoredLegacyTables.has(row.table));
  if (foreignKeyErrors.length) {
    const first = foreignKeyErrors[0];
    throw new Error(`Cast migration foreign key violation in ${first.table} row ${first.rowid}`);
  }
}

function dropLegacyTables(database, legacyTurnTable, legacyItemTable) {
  for (const tableName of [...LEGACY_TABLES, legacyTurnTable, legacyItemTable]) {
    if (tableName && tableExists(database, tableName)) {
      database.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
    }
  }
}

function resolveLegacyActor(context, conversationId, row, sourceTable) {
  assertConversation(context, conversationId, sourceTable);
  const actorType = stringField(row, ['actor_type', 'owner_type', 'member_type']).toLowerCase();
  const name = legacyMemberName(row);
  if (isProtagonistOwner(actorType) || (!name && actorType !== 'npc')) {
    return context.protagonistByConversation.get(conversationId);
  }
  return requireMember(context, conversationId, name, sourceTable);
}

function resolveMember(context, conversationId, name) {
  const key = castNameKey(name);
  if (!key) return null;
  return context.memberByName.get(memberMapKey(conversationId, key)) || null;
}

function requireMember(context, conversationId, name, sourceTable) {
  assertConversation(context, conversationId, sourceTable);
  const member = resolveMember(context, conversationId, name);
  if (!member) {
    throw new Error(`Cast migration cannot resolve member from ${sourceTable}`);
  }
  return member;
}

function rememberMember(context, member) {
  context.memberByName.set(memberMapKey(member.conversationId, member.nameKey), member);
}

function memberMapKey(conversationId, nameKey) {
  return `${conversationId}\u0000${nameKey}`;
}

function legacyMemberName(row) {
  return stringField(row, ['npc_name', 'member_name', 'actor_name', 'speaker_name', 'name']);
}

function isProtagonistOwner(value) {
  return ['protagonist', 'player', 'user', 'character', 'main'].includes(String(value || '').toLowerCase());
}

function assertConversation(context, conversationId, sourceTable) {
  if (!conversationId || !context.conversations.has(conversationId)) {
    throw new Error(`Cast migration found orphaned ${sourceTable} data`);
  }
}

function recordMigratedOrMerged(
  database,
  context,
  result,
  conversationId,
  memberId,
  subjectType,
  legacyId,
  statKey
) {
  if (result.changes) {
    incrementStat(context, statKey);
    return;
  }
  writeMigrationNote(database, conversationId, memberId, subjectType, legacyId, {
    reason: 'normalized_duplicate_merged',
  });
}

function writeMigrationNote(database, conversationId, memberId, subjectType, subjectId, metadata) {
  database.prepare(
    `INSERT INTO conversation_audit_events (
       id, conversation_id, batch_id, member_id, subject_type, subject_id,
       action, actor, before_json, after_json, before_revision, after_revision,
       rollback_of_event_id, metadata_json, created_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'migration.merge', 'migration', 'null', 'null', NULL, NULL, NULL, ?, ?)`
  ).run(
    newId(), conversationId, memberId || null, subjectType, subjectId || '',
    JSON.stringify(metadata || {}), nowIso()
  );
}

function ensureUnresolvedItemNode(database, conversationId) {
  const existing = database.prepare(
    `SELECT id FROM scene_nodes
     WHERE conversation_id = ? AND node_type = 'map' AND name = ?
     ORDER BY created_at ASC LIMIT 1`
  ).get(conversationId, 'Unresolved items');
  if (existing) return existing.id;
  const id = newId();
  const timestamp = nowIso();
  database.prepare(
    `INSERT INTO scene_nodes (
       id, conversation_id, parent_id, node_type, name, description,
       layout_json, tags_json, permanent, created_at, updated_at
     ) VALUES (?, ?, NULL, 'map', ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    conversationId,
    'Unresolved items',
    'Temporary migration location for world items whose original scene is unavailable.',
    JSON.stringify({ x: 50, y: 50, iconKey: 'map.district', unresolved: true }),
    JSON.stringify(['system', 'unresolved-items']),
    timestamp,
    timestamp
  );
  return id;
}

function validSceneNode(database, conversationId, nodeId) {
  if (!nodeId) return null;
  return database.prepare(
    'SELECT id FROM scene_nodes WHERE id = ? AND conversation_id = ?'
  ).get(nodeId, conversationId)?.id || null;
}

function uniqueItemCode(usedCodes, database, conversationId, baseCode, sourceId) {
  const mapKey = `${conversationId}\u0000${baseCode}`;
  const exists = usedCodes.has(mapKey) || database.prepare(
    'SELECT 1 FROM scene_items WHERE conversation_id = ? AND item_code = ?'
  ).get(conversationId, baseCode);
  if (!exists) {
    usedCodes.set(mapKey, true);
    return baseCode;
  }
  let suffix = castContentKey(sourceId).slice(0, 8);
  let candidate = `${baseCode}-${suffix}`.slice(0, 120);
  let counter = 1;
  while (database.prepare(
    'SELECT 1 FROM scene_items WHERE conversation_id = ? AND item_code = ?'
  ).get(conversationId, candidate)) {
    counter += 1;
    candidate = `${baseCode}-${suffix}-${counter}`.slice(0, 120);
  }
  usedCodes.set(`${conversationId}\u0000${candidate}`, true);
  return candidate;
}

function readLegacyRows(database, tableName) {
  return tableExists(database, tableName) ? readRows(database, tableName) : [];
}

function readRows(database, tableName) {
  return database.prepare(`SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY rowid ASC`).all();
}

function tableExists(database, tableName) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName));
}

function availableId(database, tableName, preferredId) {
  const candidate = normalizeCastText(preferredId, 160);
  if (candidate && !database.prepare(
    `SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE id = ?`
  ).get(candidate)) {
    return candidate;
  }
  return newId();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseAliasList(value) {
  const parsed = parseCastJson(value, []);
  if (Array.isArray(parsed)) return parsed;
  return String(value || '').split(/[,;\n]/u);
}

function jsonText(value, fallback) {
  return JSON.stringify(parseCastJson(value, fallback));
}

function stringField(row, names) {
  for (const name of names) {
    if (row?.[name] != null) return String(row[name]);
  }
  return '';
}

function nullableStringField(row, names) {
  const value = stringField(row, names).trim();
  return value || null;
}

function numberField(row, names, fallback) {
  const value = Number(stringField(row, names));
  return Number.isFinite(value) ? value : fallback;
}

function integerField(row, names, fallback) {
  return Math.trunc(numberField(row, names, fallback));
}

function booleanField(row, names, fallback) {
  for (const name of names) {
    if (row?.[name] == null) continue;
    const value = row[name];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  }
  return fallback;
}

function timestampField(row, names, fallback) {
  return normalizeCastText(stringField(row, names), 80) || fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function incrementStat(context, key) {
  context.stats[key] = (context.stats[key] || 0) + 1;
}
