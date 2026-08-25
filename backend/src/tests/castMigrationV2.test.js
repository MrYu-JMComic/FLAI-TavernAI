import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-cast-migration-v2';

const { createAppDatabase } = await import('../db.js');
const { migrateCastDomainV2 } = await import('../db/migrations/castDomainV2.js');
const { ensureConversationProtagonist } = await import('../services/cast/castCommandService.js');
const { newId, nowIso } = await import('../security.js');

test('cast v2 migration preserves legacy HMDT and encounter member identity transactionally', () => {
  const env = setupLegacyHmdt();
  try {
    const result = migrateCastDomainV2(env.database);
    assert.equal(result.migrated, true);
    assert.equal(result.stats.personalityAnchors, 1);
    assert.equal(result.stats.emotionStates, 1);
    assert.equal(result.stats.emotionHistory, 1);
    assert.equal(result.stats.oocValidations, 1);
    assert.equal(result.stats.encounterParticipants, 1);
    assert.equal(
      JSON.parse(env.database.prepare('SELECT anchor_json FROM cast_personality_anchors').get().anchor_json).identity,
      '旧身份'
    );
    assert.equal(
      JSON.parse(env.database.prepare('SELECT emotion_json FROM cast_emotion_states').get().emotion_json).joy,
      77
    );
    assert.equal(
      env.database.prepare('SELECT member_id FROM encounter_participants WHERE id = ?').get('legacy-player').member_id,
      env.protagonist.id
    );
    for (const tableName of [
      'hmdt_personality_anchors',
      'hmdt_emotion_vectors',
      'hmdt_emotion_history',
      'hmdt_ooc_validations',
    ]) {
      assert.equal(tableExists(env.database, tableName), false, tableName);
    }
    assert.deepEqual(env.database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    env.database.close();
  }
});

test('cast v2 migration rolls back old-table removal when migration fails', () => {
  const env = setupLegacyHmdt();
  try {
    env.database.exec(`
      CREATE TRIGGER fail_cast_v2_anchor
      BEFORE INSERT ON cast_personality_anchors
      BEGIN SELECT RAISE(ABORT, 'blocked v2 migration'); END;
    `);
    assert.throws(() => migrateCastDomainV2(env.database), /blocked v2 migration/);
    assert.equal(tableExists(env.database, 'hmdt_personality_anchors'), true);
    assert.equal(
      env.database.prepare("SELECT value FROM _schema_meta WHERE key = 'cast_domain_v2'").get(),
      undefined
    );
  } finally {
    env.database.close();
  }
});

function setupLegacyHmdt() {
  const database = createAppDatabase(':memory:');
  database.prepare("DELETE FROM _schema_meta WHERE key = 'cast_domain_v2'").run();
  const userId = newId();
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, userId, 'hash', timestamp);
  database.prepare('INSERT INTO characters (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(characterId, userId, '旅者', timestamp, timestamp);
  database.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId, userId, characterId, '旧 HMDT', timestamp, timestamp);
  const protagonist = ensureConversationProtagonist(database, userId, conversationId);
  database.exec(`
    CREATE TABLE hmdt_personality_anchors (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL UNIQUE,
      anchor_data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE hmdt_emotion_vectors (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL UNIQUE,
      emotion_data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE hmdt_emotion_history (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
      emotion_vector_json TEXT NOT NULL, emotion_impact_json TEXT NOT NULL,
      trigger TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE hmdt_ooc_validations (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, character_id TEXT NOT NULL,
      response_text TEXT NOT NULL, match_score REAL NOT NULL, passed INTEGER NOT NULL,
      violations_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  database.prepare('INSERT INTO hmdt_personality_anchors VALUES (?, ?, ?, ?, ?)')
    .run('old-anchor', characterId, JSON.stringify({ identity: '旧身份' }), timestamp, timestamp);
  database.prepare('INSERT INTO hmdt_emotion_vectors VALUES (?, ?, ?, ?)')
    .run('old-emotion', conversationId, JSON.stringify({ joy: 77 }), timestamp);
  database.prepare('INSERT INTO hmdt_emotion_history VALUES (?, ?, ?, ?, ?, ?)')
    .run('old-history', conversationId, JSON.stringify({ joy: 77 }), JSON.stringify({ joy: 2 }), '旧触发', timestamp);
  database.prepare('INSERT INTO hmdt_ooc_validations VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('old-ooc', conversationId, characterId, '旧回复', 80, 1, '[]', timestamp);
  database.prepare(
    `INSERT INTO encounters (
       id, conversation_id, title, status, round_number, turn_index, outcome,
       source, created_at, updated_at
     ) VALUES (?, ?, ?, 'completed', 1, 0, 'ended', 'legacy', ?, ?)`
  ).run('legacy-encounter', conversationId, '旧遭遇', timestamp, timestamp);
  database.prepare(
    `INSERT INTO encounter_participants (
       id, encounter_id, actor_type, actor_name, initiative, max_hp, current_hp,
       defense, status, conditions_json, created_at, updated_at, member_id
     ) VALUES (?, ?, 'player', ?, 10, 20, 20, 10, 'active', '[]', ?, ?, NULL)`
  ).run('legacy-player', 'legacy-encounter', '旅者', timestamp, timestamp);
  return { database, userId, characterId, conversationId, protagonist };
}

function tableExists(database, tableName) {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName));
}
