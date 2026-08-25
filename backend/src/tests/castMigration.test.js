import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateCastDomainV1 } from '../db/migrations/castDomainV1.js';

test('cast migration preserves legacy records, repairs ownership, and removes legacy tables', () => {
  const database = createLegacyDatabase();
  try {
    seedLegacyConversation(database);

    const result = migrateCastDomainV1(database);

    assert.equal(result.migrated, true);
    assert.deepEqual({ ...result.stats }, {
      members: 2,
      aliases: 1,
      memories: 1,
      behaviors: 1,
      personality: 1,
      emotionStates: 1,
      emotionHistory: 1,
      appearances: 2,
      activities: 1,
      turnQueue: 1,
      conversationTurns: 2,
      items: 2,
      auditEvents: 4,
    });

    const members = database.prepare(
      `SELECT id, member_type, canonical_name, visibility, current_location_label
       FROM cast_members ORDER BY member_type, canonical_name`
    ).all().map((row) => ({ ...row }));
    assert.deepEqual(members, [
      {
        id: 'npc-alice',
        member_type: 'npc',
        canonical_name: 'Alice',
        visibility: 'visible',
        current_location_label: 'Clock tower',
      },
      {
        id: 'npc-bob',
        member_type: 'npc',
        canonical_name: 'Bob',
        visibility: 'hidden',
        current_location_label: '',
      },
      {
        id: members[2].id,
        member_type: 'protagonist',
        canonical_name: 'Hero',
        visibility: 'visible',
        current_location_label: '',
      },
    ]);

    assert.deepEqual(
      database.prepare('SELECT alias FROM cast_member_aliases').all().map((row) => ({ ...row })),
      [{ alias: 'Al' }]
    );
    assert.deepEqual(
      database.prepare('SELECT id, content, importance FROM cast_memories').all().map((row) => ({ ...row })),
      [{ id: 'memory-1', content: 'Alice found the key.', importance: 0.8 }]
    );
    assert.deepEqual(
      database.prepare('SELECT id, trigger_condition, action, enabled FROM cast_behaviors').all().map((row) => ({ ...row })),
      [{ id: 'behavior-1', trigger_condition: 'Danger', action: 'Warn the group', enabled: 1 }]
    );

    const items = database.prepare(
      `SELECT id, owner_kind, owner_member_id, node_id, item_kind, equipped
       FROM scene_items ORDER BY id`
    ).all();
    assert.equal(items[0].id, 'item-coat');
    assert.equal(items[0].owner_kind, 'cast');
    assert.equal(items[0].owner_member_id, 'npc-alice');
    assert.equal(items[0].node_id, null);
    assert.equal(items[0].item_kind, 'clothing');
    assert.equal(items[0].equipped, 1);
    assert.equal(items[1].id, 'item-world');
    assert.equal(items[1].owner_kind, 'world');
    assert.equal(items[1].owner_member_id, null);
    assert.ok(items[1].node_id);
    assert.equal(
      database.prepare('SELECT name FROM scene_nodes WHERE id = ?').get(items[1].node_id).name,
      'Unresolved items'
    );

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cast_appearances').get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cast_personality_anchors').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cast_emotion_states').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cast_emotion_history').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM cast_turn_queue').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_turns').get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM conversation_audit_events').get().count, 5);
    const aliasConflict = database.prepare(
      "SELECT metadata_json FROM conversation_audit_events WHERE action = 'migration.merge'"
    ).get();
    assert.equal(JSON.parse(aliasConflict.metadata_json).reason, 'alias_conflicts_with_name');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);

    for (const legacyTable of [
      'npc_registry', 'npc_memories', 'npc_behaviors', 'npc_activities',
      'actor_appearances', 'npc_personality_anchors', 'npc_emotion_vectors',
      'npc_emotion_history', 'npc_turn_queue', 'npc_profile_audit', 'npc_item_audit',
      'appearance_audit', 'scene_item_audit',
      'scene_items_legacy_cast_v1', 'conversation_turns_legacy_cast_v1',
    ]) {
      assert.equal(tableExists(database, legacyTable), false, legacyTable);
    }
    assert.equal(
      database.prepare("SELECT value FROM _schema_meta WHERE key = 'cast_domain_v1'").get().value,
      '1'
    );
  } finally {
    database.close();
  }
});

test('cast migration is idempotent after a successful migration', () => {
  const database = createLegacyDatabase();
  try {
    seedLegacyConversation(database);
    migrateCastDomainV1(database);
    const before = database.prepare(
      `SELECT
         (SELECT COUNT(*) FROM cast_members) AS members,
         (SELECT COUNT(*) FROM cast_memories) AS memories,
         (SELECT COUNT(*) FROM scene_items) AS items,
         (SELECT COUNT(*) FROM conversation_audit_events) AS audits`
    ).get();

    assert.deepEqual(migrateCastDomainV1(database), { migrated: false });
    assert.deepEqual({ ...database.prepare(
      `SELECT
         (SELECT COUNT(*) FROM cast_members) AS members,
         (SELECT COUNT(*) FROM cast_memories) AS memories,
         (SELECT COUNT(*) FROM scene_items) AS items,
         (SELECT COUNT(*) FROM conversation_audit_events) AS audits`
    ).get() }, { ...before });
  } finally {
    database.close();
  }
});

test('cast migration rolls back schema and data when a legacy record is orphaned', () => {
  const database = createLegacyDatabase();
  try {
    database.exec('PRAGMA foreign_keys = OFF');
    database.prepare(
      `INSERT INTO npc_memories
       (id, conversation_id, npc_name, memory_type, content, importance, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('orphan-memory', 'missing-conversation', 'Nobody', 'event', 'Orphan', 0.5, '2025-01-01T00:00:00.000Z');
    database.exec('PRAGMA foreign_keys = ON');

    assert.throws(
      () => migrateCastDomainV1(database),
      /orphaned npc_memories data/
    );
    assert.equal(tableExists(database, 'npc_memories'), true);
    assert.equal(tableExists(database, 'cast_members'), false);
    assert.equal(tableExists(database, 'scene_items'), true);
    assert.equal(tableExists(database, 'scene_items_legacy_cast_v1'), false);
    assert.equal(
      database.prepare("SELECT value FROM _schema_meta WHERE key = 'cast_domain_v1'").get(),
      undefined
    );
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    database.close();
  }
});

function createLegacyDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE _schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE scene_nodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      node_type TEXT NOT NULL DEFAULT 'room',
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      layout_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      permanent INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_registry (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      custom_status TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      memory_sealed INTEGER NOT NULL DEFAULT 0,
      current_location TEXT NOT NULL DEFAULT '',
      relationship TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_memories (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'event',
      content TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_behaviors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      behavior_type TEXT NOT NULL DEFAULT 'reaction',
      trigger_condition TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_activities (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      title TEXT NOT NULL,
      location_node_id TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      start_tick INTEGER NOT NULL,
      end_tick INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE actor_appearances (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      outfit TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_personality_anchors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      anchor_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE npc_emotion_vectors (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      emotion_data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE npc_emotion_history (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      emotion_vector_json TEXT NOT NULL DEFAULT '{}',
      emotion_impact_json TEXT NOT NULL DEFAULT '{}',
      trigger TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE npc_turn_queue (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      order_index INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE conversation_turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      npc_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      turn_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE scene_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      node_id TEXT,
      item_code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      state_json TEXT NOT NULL DEFAULT '{}',
      position_json TEXT NOT NULL DEFAULT '{}',
      movable INTEGER NOT NULL DEFAULT 0,
      owner_type TEXT NOT NULL DEFAULT 'world',
      owner_name TEXT NOT NULL DEFAULT '',
      item_kind TEXT NOT NULL DEFAULT 'item',
      quantity INTEGER NOT NULL DEFAULT 1,
      clothing_slot TEXT NOT NULL DEFAULT '',
      equipped INTEGER NOT NULL DEFAULT 0,
      coverage_json TEXT NOT NULL DEFAULT '[]',
      icon_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE npc_profile_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE npc_item_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      npc_name TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE appearance_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE scene_item_audit (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

function seedLegacyConversation(database) {
  const timestamp = '2025-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO characters (id, name) VALUES (?, ?)').run('character-1', 'Hero');
  database.prepare('INSERT INTO conversations (id, character_id) VALUES (?, ?)').run('conversation-1', 'character-1');
  database.prepare(
    `INSERT INTO npc_registry (
       id, conversation_id, npc_name, source, evidence, confidence, hidden,
       status, custom_status, aliases, memory_sealed, current_location,
       relationship, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'npc-alice', 'conversation-1', 'Alice', 'manual', 'First meeting', 0.9, 0,
    'active', '', '["Al"]', 0, 'Clock tower', 'ally', timestamp, timestamp
  );
  database.prepare(
    `INSERT INTO npc_registry (
       id, conversation_id, npc_name, source, evidence, confidence, hidden,
       status, custom_status, aliases, memory_sealed, current_location,
       relationship, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'npc-bob', 'conversation-1', 'Bob', 'manual', '', 0.5, 1,
    'active', '', '["Hero"]', 0, '', '', timestamp, timestamp
  );
  database.prepare(
    `INSERT INTO npc_memories
     (id, conversation_id, npc_name, memory_type, content, importance, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('memory-1', 'conversation-1', 'Alice', 'event', 'Alice found the key.', 0.8, timestamp);
  database.prepare(
    `INSERT INTO npc_behaviors
     (id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('behavior-1', 'conversation-1', 'Alice', 'reaction', 'Danger', 'Warn the group', 10, 1, timestamp);
  database.prepare(
    `INSERT INTO npc_activities
     (id, conversation_id, npc_name, title, location_node_id, status, start_tick, end_tick, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run('activity-1', 'conversation-1', 'Alice', 'Patrol', 'scheduled', 10, 20, 'manual', timestamp, timestamp);
  database.prepare(
    `INSERT INTO actor_appearances
     (id, conversation_id, actor_type, actor_name, summary, outfit, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('appearance-hero', 'conversation-1', 'protagonist', 'Player', 'Tall', 'Travel clothes', '{}', timestamp, timestamp);
  database.prepare(
    `INSERT INTO actor_appearances
     (id, conversation_id, actor_type, actor_name, summary, outfit, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('appearance-alice', 'conversation-1', 'npc', 'Alice', 'Alert', 'Red coat', '{}', timestamp, timestamp);
  database.prepare(
    `INSERT INTO npc_personality_anchors
     (id, conversation_id, npc_name, anchor_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('personality-alice', 'conversation-1', 'Alice', '{"traits":["loyal"]}', timestamp, timestamp);
  database.prepare(
    `INSERT INTO npc_emotion_vectors
     (id, conversation_id, npc_name, emotion_data, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run('emotion-alice', 'conversation-1', 'Alice', '{"trust":0.8}', timestamp);
  database.prepare(
    `INSERT INTO npc_emotion_history
     (id, conversation_id, npc_name, emotion_vector_json, emotion_impact_json, trigger, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('emotion-history-alice', 'conversation-1', 'Alice', '{"trust":0.8}', '{"trust":0.2}', 'Helped', timestamp);
  database.prepare(
    `INSERT INTO npc_turn_queue
     (id, conversation_id, npc_name, status, order_index, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('turn-queue-alice', 'conversation-1', 'Alice', 'pending', 2, '{"prompt":"respond"}', timestamp, timestamp);
  database.prepare(
    `INSERT INTO conversation_turns
     (id, conversation_id, role, npc_name, content, turn_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('turn-user', 'conversation-1', 'user', '', 'Hello', 1, timestamp);
  database.prepare(
    `INSERT INTO conversation_turns
     (id, conversation_id, role, npc_name, content, turn_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('turn-alice', 'conversation-1', 'npc', 'Alice', 'Welcome', 2, timestamp);
  database.prepare(
    `INSERT INTO scene_items (
       id, conversation_id, node_id, item_code, name, owner_type, owner_name,
       item_kind, quantity, clothing_slot, equipped, created_at, updated_at
     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('item-coat', 'conversation-1', 'coat', 'Red coat', 'npc', 'Alice', 'clothing', 1, 'torso', 1, timestamp, timestamp);
  database.prepare(
    `INSERT INTO scene_items (
       id, conversation_id, node_id, item_code, name, owner_type, owner_name,
       item_kind, quantity, equipped, created_at, updated_at
     ) VALUES (?, ?, NULL, ?, ?, 'world', '', 'item', 1, 0, ?, ?)`
  ).run('item-world', 'conversation-1', 'key', 'Iron key', timestamp, timestamp);
  database.prepare(
    `INSERT INTO npc_profile_audit
     (id, conversation_id, npc_name, action, actor, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('audit-profile', 'conversation-1', 'Alice', 'update', 'manual', '{}', '{}', timestamp);
  database.prepare(
    `INSERT INTO scene_item_audit
     (id, conversation_id, item_id, action, actor, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('audit-item', 'conversation-1', 'item-coat', 'update', 'manual', '{}', '{}', timestamp);
  database.prepare(
    `INSERT INTO npc_item_audit
     (id, conversation_id, npc_name, item_type, item_id, action, actor, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('audit-memory', 'conversation-1', 'Alice', 'memory', 'memory-1', 'update', 'manual', '{}', '{}', timestamp);
  database.prepare(
    `INSERT INTO appearance_audit
     (id, conversation_id, actor_name, action, actor, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('audit-appearance', 'conversation-1', 'Alice', 'update', 'manual', '{}', '{}', timestamp);
}

function tableExists(database, tableName) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName));
}
