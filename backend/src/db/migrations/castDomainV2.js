import { newId, nowIso } from '../../security.js';

const VERSION_KEY = 'cast_domain_v2';
const VERSION = '1';

export function migrateCastDomainV2(database) {
  if (schemaVersion(database) === VERSION) return { migrated: false };

  const foreignKeysEnabled = Boolean(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys);
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN IMMEDIATE');
  try {
    createCastOocTable(database);
    const stats = {
      personalityAnchors: migratePersonalityAnchors(database),
      emotionStates: migrateEmotionStates(database),
      emotionHistory: migrateEmotionHistory(database),
      oocValidations: migrateOocValidations(database),
      encounterParticipants: migrateEncounterParticipants(database),
    };
    dropLegacyHmdtTables(database);
    assertValidJson(database, 'cast_ooc_validations', 'violations_json');
    const foreignKeyProblems = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyProblems.length) {
      throw new Error(`Cast domain v2 foreign key validation failed (${foreignKeyProblems.length})`);
    }
    database.prepare(
      'INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (?, ?)'
    ).run(VERSION_KEY, VERSION);
    database.exec('COMMIT');
    return { migrated: true, stats };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function createCastOocTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cast_ooc_validations (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      response_text TEXT NOT NULL DEFAULT '',
      match_score REAL NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
      violations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (member_id) REFERENCES cast_members(id) ON DELETE CASCADE
    );
  `);
}

function migratePersonalityAnchors(database) {
  if (!tableExists(database, 'hmdt_personality_anchors')) return 0;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_personality_anchors (
       member_id, conversation_id, anchor_json, revision, created_at, updated_at
     ) VALUES (?, ?, ?, 1, ?, ?)`
  );
  let migrated = 0;
  for (const row of database.prepare('SELECT * FROM hmdt_personality_anchors').all()) {
    const conversations = database.prepare(
      `SELECT conversations.id, cast_members.id AS member_id
       FROM conversations
       JOIN cast_members ON cast_members.conversation_id = conversations.id
         AND cast_members.member_type = 'protagonist'
       WHERE conversations.character_id = ?`
    ).all(row.character_id);
    for (const conversation of conversations) {
      const result = insert.run(
        conversation.member_id,
        conversation.id,
        jsonText(row.anchor_data, {}),
        row.created_at || nowIso(),
        row.updated_at || row.created_at || nowIso()
      );
      migrated += result.changes;
    }
  }
  return migrated;
}

function migrateEmotionStates(database) {
  if (!tableExists(database, 'hmdt_emotion_vectors')) return 0;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_emotion_states (
       member_id, conversation_id, emotion_json, revision, updated_at
     ) VALUES (?, ?, ?, 1, ?)`
  );
  let migrated = 0;
  for (const row of database.prepare('SELECT * FROM hmdt_emotion_vectors').all()) {
    const protagonist = getProtagonist(database, row.conversation_id);
    if (!protagonist) continue;
    migrated += insert.run(
      protagonist.id,
      row.conversation_id,
      jsonText(row.emotion_data, {}),
      row.updated_at || nowIso()
    ).changes;
  }
  return migrated;
}

function migrateEmotionHistory(database) {
  if (!tableExists(database, 'hmdt_emotion_history')) return 0;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_emotion_history (
       id, conversation_id, member_id, emotion_json, impact_json, trigger, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  let migrated = 0;
  for (const row of database.prepare('SELECT * FROM hmdt_emotion_history').all()) {
    const protagonist = getProtagonist(database, row.conversation_id);
    if (!protagonist) continue;
    migrated += insert.run(
      availableId(database, 'cast_emotion_history', row.id),
      row.conversation_id,
      protagonist.id,
      jsonText(row.emotion_vector_json, {}),
      jsonText(row.emotion_impact_json, {}),
      String(row.trigger || '').slice(0, 2_000),
      row.created_at || nowIso()
    ).changes;
  }
  return migrated;
}

function migrateOocValidations(database) {
  if (!tableExists(database, 'hmdt_ooc_validations')) return 0;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO cast_ooc_validations (
       id, conversation_id, member_id, response_text, match_score,
       passed, violations_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let migrated = 0;
  for (const row of database.prepare('SELECT * FROM hmdt_ooc_validations').all()) {
    const protagonist = getProtagonist(database, row.conversation_id);
    if (!protagonist) continue;
    migrated += insert.run(
      availableId(database, 'cast_ooc_validations', row.id),
      row.conversation_id,
      protagonist.id,
      String(row.response_text || '').slice(0, 50_000),
      Number(row.match_score || 0),
      row.passed ? 1 : 0,
      jsonText(row.violations_json, []),
      row.created_at || nowIso()
    ).changes;
  }
  return migrated;
}

function migrateEncounterParticipants(database) {
  if (!tableExists(database, 'encounter_participants')) return 0;
  const columns = tableColumns(database, 'encounter_participants');
  if (!columns.has('member_id')) {
    database.exec(
      'ALTER TABLE encounter_participants ADD COLUMN member_id TEXT REFERENCES cast_members(id) ON DELETE SET NULL'
    );
  }
  const rows = database.prepare(
    `SELECT encounter_participants.id, encounter_participants.actor_type,
            encounter_participants.actor_name, encounters.conversation_id
     FROM encounter_participants
     JOIN encounters ON encounters.id = encounter_participants.encounter_id
     WHERE encounter_participants.member_id IS NULL`
  ).all();
  const update = database.prepare(
    'UPDATE encounter_participants SET member_id = ? WHERE id = ?'
  );
  let migrated = 0;
  for (const row of rows) {
    const member = row.actor_type === 'player'
      ? getProtagonist(database, row.conversation_id)
      : database.prepare(
        `SELECT id FROM cast_members
         WHERE conversation_id = ? AND name_key = lower(trim(?))
         LIMIT 1`
      ).get(row.conversation_id, row.actor_name);
    if (member) migrated += update.run(member.id, row.id).changes;
  }
  return migrated;
}

function dropLegacyHmdtTables(database) {
  for (const tableName of [
    'hmdt_emotion_history',
    'hmdt_emotion_vectors',
    'hmdt_personality_anchors',
    'hmdt_ooc_validations',
  ]) {
    if (tableExists(database, tableName)) database.exec(`DROP TABLE ${tableName}`);
  }
}

function getProtagonist(database, conversationId) {
  return database.prepare(
    `SELECT id FROM cast_members
     WHERE conversation_id = ? AND member_type = 'protagonist'`
  ).get(conversationId);
}

function availableId(database, tableName, preferredId) {
  const candidate = String(preferredId || '').trim();
  if (candidate && !database.prepare(`SELECT 1 FROM ${tableName} WHERE id = ?`).get(candidate)) {
    return candidate;
  }
  return newId();
}

function jsonText(value, fallback) {
  if (value && typeof value === 'object') return JSON.stringify(value);
  try {
    return JSON.stringify(JSON.parse(String(value || '')));
  } catch {
    return JSON.stringify(fallback);
  }
}

function assertValidJson(database, tableName, columnName) {
  const invalid = database.prepare(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE json_valid(${columnName}) = 0`
  ).get();
  if (Number(invalid?.count || 0) > 0) {
    throw new Error(`Invalid JSON in ${tableName}.${columnName}`);
  }
}

function schemaVersion(database) {
  if (!tableExists(database, '_schema_meta')) return '';
  return database.prepare('SELECT value FROM _schema_meta WHERE key = ?').get(VERSION_KEY)?.value || '';
}

function tableExists(database, tableName) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName));
}

function tableColumns(database, tableName) {
  return new Set(database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}
