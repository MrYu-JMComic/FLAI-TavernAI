import assert from 'node:assert/strict';
import test from 'node:test';

// Set isolation before importing any application module that can transitively open a database.
process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'memory-projection-upgrade-tests';
const { createAppDatabase } = await import('../db/runtime.js');
const { initializeDatabase } = await import('../db/schema.js');
const { latestSchemaVersion, listAppliedMigrations } = await import('../db/migrations.js');
const { migrateMemoryProjectionUpgrade } = await import('../db/migrations/0036MemoryProjectionUpgrade.js');
const { createCharacter } = await import('../modules/characters.js');
const { pinConversationMemory } = await import('../modules/conversationMemories.js');
const { commitMemoryPacket, getMemoryProcessingState } = await import('../services/conversationMemory/commit.js');
const { insertUser } = await import('./routeTestUtils.js');

// Independent early review DDL: already-recorded 0030 contained lifecycle but omitted policy fields.
// Do not derive this table from the current 0030 migration, which already contains those fields.
const EARLY_REVIEW_DDL = `
  CREATE TABLE conversation_memories (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'event', subject TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 1,
    source_message_id TEXT NOT NULL DEFAULT '', source_kind TEXT NOT NULL DEFAULT 'manual',
    source_excerpt TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    layer TEXT NOT NULL DEFAULT 'short_term', importance REAL NOT NULL DEFAULT 0,
    emotional_intensity REAL NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1, invalidated_at TEXT, merged_into_id TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'active',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`;

const POLICY_FIELDS = {
  visibility: "TEXT NOT NULL DEFAULT 'public'",
  truth_status: "TEXT NOT NULL DEFAULT 'unverified'",
  actor_ids_json: "TEXT NOT NULL DEFAULT '[]'"
};
const FALLBACK_POLICY = { visibility: 'public', truth_status: 'unverified', actor_ids_json: '[]' };
const TIMESTAMP = '2026-11-01T00:00:00.000Z';

/** Audits every memory table, including review, canonical, summary, search and embedding projections. */
function memorySchemaColumns(database) {
  const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND (name LIKE 'memory_%' OR name LIKE 'conversation_memor%' OR name LIKE 'embedding_%'
      OR name LIKE 'fts_memor%') ORDER BY name`).all();
  return Object.fromEntries(tables.map(({ name }) => [name,
    database.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name).sort()]));
}

/** Replaces only an empty isolated review table and keeps every recorded migration through 0035. */
function earlyProjectionFixture(t, presentFields = []) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const currentSchema = memorySchemaColumns(database);
  const dependents = database.prepare(`SELECT sql FROM sqlite_master WHERE tbl_name='conversation_memories'
    AND type IN ('trigger','index') AND sql IS NOT NULL ORDER BY type,name`).all();
  database.exec('PRAGMA foreign_keys=OFF');
  database.exec('DROP TABLE conversation_memories');
  database.exec(EARLY_REVIEW_DDL);
  for (const field of presentFields) {
    database.exec(`ALTER TABLE conversation_memories ADD COLUMN ${field} ${POLICY_FIELDS[field]}`);
  }
  for (const { sql } of dependents) database.exec(sql);
  database.exec("DELETE FROM schema_migrations WHERE version='0036'");
  database.exec('PRAGMA foreign_keys=ON');
  const ledger = listAppliedMigrations(database);
  assert.equal(ledger.at(-1).version, '0035');
  const userId = 'projection-upgrade-user';
  const conversationId = 'projection-upgrade-conversation';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Projection Archivist' });
  const conversation = (id = conversationId, owner = userId) => {
    database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status)
      VALUES(?,?,?,'Projection upgrade',?,?,'ready')`).run(id, owner, character.id, TIMESTAMP, TIMESTAMP);
  };
  conversation();
  const review = (id, overrides = {}) => {
    const row = { id, user_id: userId, conversation_id: conversationId, memory_type: 'fact',
      subject: 'Archive', content: `Original review text for ${id}.`, confidence: 0.73,
      source_message_id: 'historic-source', source_kind: 'auto', source_excerpt: 'original excerpt',
      enabled: 1, archived: 0, created_at: TIMESTAMP, updated_at: '2026-11-01T00:00:01.000Z',
      layer: 'canon', importance: 0.81, emotional_intensity: 0.26, pinned: 1, revision: 7,
      invalidated_at: null, merged_into_id: null, lifecycle: 'active', ...overrides };
    const names = Object.keys(row);
    database.prepare(`INSERT INTO conversation_memories(${names.join(',')})
      VALUES(${names.map(() => '?').join(',')})`).run(...Object.values(row));
    return database.prepare('SELECT rowid,* FROM conversation_memories WHERE id=?').get(id);
  };
  const commit = (id, revision, parent = null, owner = userId, scope = conversationId) => {
    database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,
      timeline_revision,base_revision,revision,narrative_order,kind,receipt_json,created_at,parent_commit_id)
      VALUES(?,?,?,?,?,1,?,?,1,'turn','{}',?,?)`)
      .run(id, owner, scope, id, `hash:${id}`, revision - 1, revision, TIMESTAMP, parent);
    return id;
  };
  const event = (id, memoryId, overrides = {}) => {
    const row = { id, user_id: userId, conversation_id: conversationId, memory_id: memoryId,
      memory_revision: 1, commit_id: null, kind: 'fact', content: `Canonical text for ${id}.`,
      narrative_order: 1, event_sequence: 1, visibility: 'restricted', truth_status: 'false',
      actor_ids_json: '["historic-mira"]', source_hash: `source:${id}`, created_at: TIMESTAMP, ...overrides };
    const names = Object.keys(row);
    database.prepare(`INSERT INTO memory_events(${names.join(',')})
      VALUES(${names.map(() => '?').join(',')})`).run(...Object.values(row));
    return id;
  };
  const selectHead = (id, revision) => {
    database.prepare(`INSERT INTO conversation_memory_state(conversation_id,user_id,revision,core_commit_id,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET revision=excluded.revision,core_commit_id=excluded.core_commit_id`)
      .run(conversationId, userId, revision, id, TIMESTAMP);
  };
  return { database, currentSchema, ledger, userId, conversationId, conversation, review, commit, event, selectHead };
}

/** Compares all original column values and row identity while allowing only the three added fields. */
function assertPreservedReview(database, before) {
  const after = database.prepare('SELECT rowid,* FROM conversation_memories WHERE id=?').get(before.id);
  for (const [name, value] of Object.entries(before)) {
    assert.deepEqual(after[name], value, `${before.id}.${name} must survive the forward migration`);
  }
  return after;
}

function policy(row) {
  return Object.fromEntries(Object.keys(POLICY_FIELDS).map(name => [name, row[name]]));
}

test('recorded 0035 review upgrade preserves all fields and lifecycles and fills policy from the selected lineage', t => {
  const f = earlyProjectionFixture(t);
  const original = [
    f.review('old-active'),
    f.review('old-candidate', { lifecycle: 'candidate', enabled: 0, pinned: 0, layer: 'working' }),
    f.review('old-rejected', { lifecycle: 'rejected', enabled: 0, archived: 1, invalidated_at: TIMESTAMP }),
    f.review('old-superseded', { lifecycle: 'superseded', enabled: 0, merged_into_id: 'old-active' })
  ];
  const root = f.commit('selected-root', 1);
  const selected = f.commit('selected-head', 2, root);
  const discarded = f.commit('discarded-future', 999, root);
  f.selectHead(selected, 2);
  f.event('root-event', 'old-active', { commit_id: root, memory_revision: 50, visibility: 'author', truth_status: 'disputed' });
  f.event('selected-old', 'old-active', { commit_id: selected, memory_revision: 51, visibility: 'author', truth_status: 'unknown' });
  f.event('selected-latest', 'old-active', { commit_id: selected, memory_revision: 52 });
  f.event('discarded-newer', 'old-active', { commit_id: discarded, memory_revision: 999,
    visibility: 'public', truth_status: 'established', actor_ids_json: '[]' });
  f.event('baseline-high-revision', 'old-active', { memory_revision: 1000,
    visibility: 'public', truth_status: 'established', actor_ids_json: '[]' });
  f.event('baseline-only', 'old-candidate');
  f.event('discarded-only', 'old-superseded', { commit_id: discarded });
  // A matching memory ID is insufficient if either owner or conversation differs.
  const otherUser = 'projection-other-user';
  insertUser(f.database, otherUser);
  f.conversation('projection-sibling');
  f.event('other-owner-event', 'old-rejected', { user_id: otherUser });
  f.event('other-conversation-event', 'old-rejected', { conversation_id: 'projection-sibling' });
  const canonicalBefore = f.database.prepare('SELECT rowid,* FROM memory_events ORDER BY id').all();
  const commitsBefore = f.database.prepare('SELECT rowid,* FROM memory_commits ORDER BY id').all();

  migrateMemoryProjectionUpgrade(f.database);

  const after = original.map(row => assertPreservedReview(f.database, row));
  assert.deepEqual(policy(after[0]), { visibility: 'restricted', truth_status: 'false', actor_ids_json: '["historic-mira"]' });
  assert.deepEqual(policy(after[1]), policy(after[0]), 'unversioned baseline metadata remains available');
  assert.deepEqual(policy(after[2]), FALLBACK_POLICY, 'other scopes cannot supply policy');
  assert.deepEqual(policy(after[3]), FALLBACK_POLICY, 'discarded-only metadata cannot supply policy');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversation_memories').get().n, original.length);
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM memory_events ORDER BY id').all(), canonicalBefore);
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM memory_commits ORDER BY id').all(), commitsBefore);
  assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema, 'no current memory table may retain missing columns');
  assert.deepEqual(listAppliedMigrations(f.database), f.ledger, 'direct repair must not rewrite any old migration record');
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
  const columns = new Map(f.database.prepare('PRAGMA table_info(conversation_memories)').all().map(row => [row.name, row]));
  for (const [field, fallback] of Object.entries(FALLBACK_POLICY)) {
    assert.equal(columns.get(field).notnull, 1);
    assert.equal(columns.get(field).dflt_value, `'${fallback}'`);
  }
});

for (const existingField of Object.keys(POLICY_FIELDS)) {
  test(`partial review upgrade preserves an existing ${existingField} value while adding missing policy fields`, t => {
    const f = earlyProjectionFixture(t, [existingField]);
    const preserved = { visibility: 'author', truth_status: 'disputed', actor_ids_json: '["review-only-actor"]' };
    const before = f.review('partial-review', { [existingField]: preserved[existingField] });
    f.event('partial-canonical', before.id);
    migrateMemoryProjectionUpgrade(f.database);
    const after = assertPreservedReview(f.database, before);
    const expected = { visibility: 'restricted', truth_status: 'false', actor_ids_json: '["historic-mira"]',
      [existingField]: preserved[existingField] };
    assert.deepEqual(policy(after), expected);
    assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema);
    assert.deepEqual(listAppliedMigrations(f.database), f.ledger);
  });
}

test('startup applies forward 0036 to a recorded 0035 projection exactly once without replaying old migrations', t => {
  const f = earlyProjectionFixture(t);
  const before = f.review('startup-review', { lifecycle: 'candidate', enabled: 0 });
  f.event('startup-baseline', before.id);
  initializeDatabase(f.database);
  const after = assertPreservedReview(f.database, before);
  assert.deepEqual(policy(after), { visibility: 'restricted', truth_status: 'false', actor_ids_json: '["historic-mira"]' });
  const ledger = listAppliedMigrations(f.database);
  assert.deepEqual(ledger.filter(row => row.version <= '0035'), f.ledger);
  assert.equal(ledger.at(-1).version, '0036');
  assert.equal(ledger.length, f.ledger.length + 1);
  assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema);
  initializeDatabase(f.database);
  assert.deepEqual(listAppliedMigrations(f.database), ledger);
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM conversation_memories WHERE id=?').get(before.id), after);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('projection migration and startup are idempotent and keep already-present policy untouched', t => {
  const f = earlyProjectionFixture(t, Object.keys(POLICY_FIELDS));
  const before = f.review('already-complete', { visibility: 'author', truth_status: 'disputed', actor_ids_json: '["review-actor"]' });
  f.event('already-complete-canonical', before.id);
  migrateMemoryProjectionUpgrade(f.database);
  migrateMemoryProjectionUpgrade(f.database);
  assertPreservedReview(f.database, before);
  initializeDatabase(f.database);
  const restartLedger = listAppliedMigrations(f.database);
  assert.deepEqual(restartLedger.filter(row => row.version <= '0035'), f.ledger);
  assert.equal(restartLedger.at(-1).version, latestSchemaVersion);
  initializeDatabase(f.database);
  assert.deepEqual(listAppliedMigrations(f.database), restartLedger);
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM conversation_memories WHERE id=?').get(before.id), before);
  assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('projection repair rolls back added columns and backfill when the foreign-key audit fails', t => {
  const f = earlyProjectionFixture(t);
  const valid = f.review('rollback-valid');
  f.event('rollback-canonical', valid.id);
  f.database.exec('PRAGMA foreign_keys=OFF');
  f.review('rollback-invalid', { user_id: 'missing-owner' });
  f.database.exec('PRAGMA foreign_keys=ON');
  const schemaBefore = memorySchemaColumns(f.database);
  const rowsBefore = f.database.prepare('SELECT rowid,* FROM conversation_memories ORDER BY id').all();
  assert.throws(() => migrateMemoryProjectionUpgrade(f.database), /foreign key check failed/);
  assert.deepEqual(memorySchemaColumns(f.database), schemaBefore, 'failed ALTER TABLE operations must roll back');
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM conversation_memories ORDER BY id').all(), rowsBefore);
  assert.deepEqual(listAppliedMigrations(f.database), f.ledger);
  f.database.prepare('DELETE FROM conversation_memories WHERE id=?').run('rollback-invalid');
  migrateMemoryProjectionUpgrade(f.database);
  assertPreservedReview(f.database, valid);
  assert.deepEqual(policy(f.database.prepare('SELECT * FROM conversation_memories WHERE id=?').get(valid.id)),
    { visibility: 'restricted', truth_status: 'false', actor_ids_json: '["historic-mira"]' });
  assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('an upgraded recorded database accepts a real canonical packet and audited review revision atomically', t => {
  const f = earlyProjectionFixture(t);
  const messageId = 'projection-opening';
  const content = 'Mira says the key is in the attic, although it is hidden in the cellar.';
  f.database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,created_at)
    VALUES(?,?,?,'assistant',?,?)`).run(messageId, f.userId, f.conversationId, content, TIMESTAMP);
  const packet = { idempotencyKey: 'projection-opening-packet', messageId, sources: [{ messageId, revision: 1 }],
    entities: [{ key: 'mira', name: 'Mira', kind: 'actor' }],
    events: [{ key: 'false-location', kind: 'fact', content: 'The key is in the attic.',
      visibility: 'restricted', truthStatus: 'false', actorIds: ['mira'],
      evidence: [{ messageId, quote: 'Mira says the key is in the attic' }] }] };
  assert.throws(() => commitMemoryPacket(f.database, f.userId, f.conversationId, packet), /no column named visibility/);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversation_memories').get().n, 0);

  migrateMemoryProjectionUpgrade(f.database);
  const receipt = commitMemoryPacket(f.database, f.userId, f.conversationId, packet);
  assert.equal(receipt.accepted, 1);
  const canonical = f.database.prepare('SELECT * FROM memory_events').get();
  const projection = f.database.prepare('SELECT * FROM conversation_memories WHERE id=?').get(canonical.memory_id);
  const actor = f.database.prepare("SELECT id FROM memory_entities WHERE name='Mira'").get();
  assert.equal(projection.content, packet.events[0].content);
  assert.equal(projection.source_message_id, messageId);
  assert.deepEqual(policy(projection), { visibility: 'restricted', truth_status: 'false', actor_ids_json: JSON.stringify([actor.id]) });
  assert.deepEqual(policy(projection), policy(canonical));
  assert.equal(getMemoryProcessingState(f.database, f.userId, f.conversationId).commitId, receipt.commitId);
  assert.equal(commitMemoryPacket(f.database, f.userId, f.conversationId, packet).duplicate, true);

  const pinned = pinConversationMemory(f.database, f.userId, f.conversationId, projection.id,
    { pinned: true, revision: projection.revision });
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.revision, 2);
  const audited = f.database.prepare('SELECT * FROM memory_events WHERE memory_id=? ORDER BY memory_revision DESC LIMIT 1').get(projection.id);
  assert.equal(audited.memory_revision, 2);
  assert.equal(audited.supersedes_id, canonical.id);
  assert.deepEqual(policy(audited), policy(projection));
  const rowsBeforeRestart = f.database.prepare('SELECT rowid,* FROM conversation_memories ORDER BY id').all();
  initializeDatabase(f.database);
  initializeDatabase(f.database);
  assert.deepEqual(f.database.prepare('SELECT rowid,* FROM conversation_memories ORDER BY id').all(), rowsBeforeRestart);
  assert.deepEqual(listAppliedMigrations(f.database).filter(row => row.version <= '0035'), f.ledger);
  assert.deepEqual(memorySchemaColumns(f.database), f.currentSchema);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(), []);
});
