import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppDatabase } from '../db/runtime.js';
import { initializeDatabase } from '../db/schema.js';
import { latestSchemaVersion, listAppliedMigrations } from '../db/migrations.js';
import { migrateMemoryProvenanceRepair } from '../db/migrations/0035MemoryProvenanceRepair.js';
import { createCharacter } from '../modules/characters.js';
import { branchConversation } from '../modules/branches.js';
import { memoryHash } from '../domain/conversationMemory/contracts.js';
import { captureMemoryCheckpoint, commitMemoryPacket, ensureMemoryBaseline, restoreMemoryCheckpoint } from '../services/conversationMemory/commit.js';
import { listCurrentMemoryKnowledge, listCurrentMemoryThreads, listMemoryEntities, listMemoryRecords, resolveMemoryEntity } from '../repositories/conversationMemoryRepository.js';
import { writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { retrieveMemoryContext } from '../services/conversationMemory/retrieval.js';
import { insertUser } from './routeTestUtils.js';

// This is the already-recorded early schema, including its table-level autoindexes.
// It intentionally does not derive its definitions from the current 0030 source.
const EARLY_MEMORY_DDL = `
  CREATE TABLE conversation_memory_state (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0, core_message_id TEXT NOT NULL DEFAULT '',
    core_message_revision INTEGER NOT NULL DEFAULT 0, core_order INTEGER NOT NULL DEFAULT 0,
    summary_order INTEGER NOT NULL DEFAULT 0, index_order INTEGER NOT NULL DEFAULT 0,
    timeline_revision INTEGER NOT NULL DEFAULT 1, baseline_kind TEXT NOT NULL DEFAULT 'legacy',
    baseline_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
  );
  CREATE TABLE memory_entities (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, cast_key TEXT NOT NULL DEFAULT '',
    domain_kind TEXT NOT NULL DEFAULT '', domain_id TEXT NOT NULL DEFAULT '',
    lifecycle TEXT NOT NULL DEFAULT 'active', created_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(conversation_id,cast_key)
  );
  CREATE TABLE memory_entity_aliases (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
    source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    UNIQUE(entity_id,normalized_alias)
  );
  CREATE TABLE memory_commits (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL, packet_hash TEXT NOT NULL, timeline_revision INTEGER NOT NULL,
    base_revision INTEGER NOT NULL, revision INTEGER NOT NULL, narrative_order INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '', message_revision INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(conversation_id,idempotency_key)
  );
  CREATE TABLE memory_events (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    commit_id TEXT REFERENCES memory_commits(id) ON DELETE CASCADE,
    memory_id TEXT NOT NULL DEFAULT '', memory_revision INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL, subject_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
    content TEXT NOT NULL, participants_json TEXT NOT NULL DEFAULT '[]',
    location_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
    narrative_order INTEGER NOT NULL, narrative_time TEXT NOT NULL DEFAULT '',
    lifecycle TEXT NOT NULL DEFAULT 'active', truth_status TEXT NOT NULL DEFAULT 'unverified',
    visibility TEXT NOT NULL DEFAULT 'public', actor_ids_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 1, importance REAL NOT NULL DEFAULT 0,
    emotional_intensity REAL NOT NULL DEFAULT 0, layer TEXT NOT NULL DEFAULT 'history',
    supersedes_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
    source_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(conversation_id,memory_id,memory_revision)
  );
  CREATE TABLE memory_actor_knowledge (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    actor_entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    epistemic_state TEXT NOT NULL, learned_from_event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
    learned_order INTEGER NOT NULL, source_evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, UNIQUE(actor_entity_id,event_id)
  );
  CREATE TABLE memory_plot_threads (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    owner_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
    resolution_trigger TEXT NOT NULL DEFAULT '', resolved_event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
    created_order INTEGER NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_memory_entities_scope ON memory_entities(user_id,conversation_id,lifecycle,name);
  CREATE INDEX idx_memory_alias_lookup ON memory_entity_aliases(user_id,conversation_id,normalized_alias);
  CREATE INDEX idx_memory_knowledge_actor ON memory_actor_knowledge(conversation_id,actor_entity_id,learned_order);
  CREATE INDEX idx_memory_threads_scope ON memory_plot_threads(user_id,conversation_id,status,created_order);
`;

const LEGACY_FTS_DDL = `
  CREATE TRIGGER memory_events_fts_insert AFTER INSERT ON memory_events BEGIN
    INSERT INTO fts_memory_events(event_id,user_id,conversation_id,content) VALUES(NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
  END;
  CREATE TRIGGER memory_events_fts_update AFTER UPDATE OF content ON memory_events BEGIN
    DELETE FROM fts_memory_events WHERE event_id=OLD.id;
    INSERT INTO fts_memory_events(event_id,user_id,conversation_id,content) VALUES(NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
  END;
  CREATE TRIGGER memory_events_fts_delete AFTER DELETE ON memory_events BEGIN
    DELETE FROM fts_memory_events WHERE event_id=OLD.id;
  END;
  CREATE TRIGGER fts_memories_insert AFTER INSERT ON conversation_memories BEGIN
    INSERT INTO fts_memories(entity_id,user_id,conversation_id,subject,content) VALUES(NEW.id,NEW.user_id,NEW.conversation_id,NEW.subject,NEW.content);
  END;
  CREATE TRIGGER fts_memories_update AFTER UPDATE ON conversation_memories BEGIN
    DELETE FROM fts_memories WHERE entity_id=OLD.id;
    INSERT INTO fts_memories(entity_id,user_id,conversation_id,subject,content) VALUES(NEW.id,NEW.user_id,NEW.conversation_id,NEW.subject,NEW.content);
  END;
  CREATE TRIGGER fts_memories_delete AFTER DELETE ON conversation_memories BEGIN
    DELETE FROM fts_memories WHERE entity_id=OLD.id;
  END;
`;

/** Replaces only empty in-memory memory tables while retaining the already-applied 0030-0033 ledger. */
function earlyFixture(t,partial=false) {
  const database=createAppDatabase(':memory:');
  t.after(()=>database.close());
  database.exec('PRAGMA foreign_keys=OFF');
  database.exec(`
    DROP TRIGGER memory_events_fts_insert; DROP TRIGGER memory_events_fts_update; DROP TRIGGER memory_events_fts_delete;
    DROP TRIGGER fts_memories_insert; DROP TRIGGER fts_memories_update; DROP TRIGGER fts_memories_delete;
    DROP TABLE memory_entity_aliases; DROP TABLE memory_actor_knowledge; DROP TABLE memory_plot_threads;
    DROP TABLE memory_events; DROP TABLE memory_commits; DROP TABLE memory_entities; DROP TABLE conversation_memory_state;
    DELETE FROM schema_migrations WHERE version IN ('0034','0035','0036');
    DELETE FROM _schema_meta WHERE key='memory_provenance_reconciled';
    DELETE FROM fts_memory_events; DELETE FROM fts_memories;
  `);
  database.exec(EARLY_MEMORY_DDL);
  database.exec(LEGACY_FTS_DDL);
  if(partial) database.exec(`
    ALTER TABLE conversation_memory_state ADD COLUMN core_commit_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE memory_entities ADD COLUMN created_commit_id TEXT;
    ALTER TABLE memory_events ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE memory_actor_knowledge ADD COLUMN belief_content TEXT NOT NULL DEFAULT '';
  `);
  database.exec('PRAGMA foreign_keys=ON');
  const userId='schema-upgrade-user'; const conversationId='schema-upgrade-conversation';
  const timestamp='2026-11-01T00:00:00.000Z';
  insertUser(database,userId);
  const character=createCharacter(database,userId,{name:'Upgrade Archivist'});
  const conversation=(id=conversationId)=>database.prepare(`INSERT INTO conversations(id,user_id,character_id,title,created_at,updated_at,state_status)
    VALUES(?,?,?,?,?,?,'ready')`).run(id,userId,character.id,'Upgrade story',timestamp,timestamp);
  conversation();
  const message=(id,content,selectedConversation=conversationId)=>{
    const count=database.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(selectedConversation).n;
    database.prepare(`INSERT INTO messages(id,user_id,conversation_id,role,content,created_at) VALUES(?,?,?,'assistant',?,?)`)
      .run(id,userId,selectedConversation,content,`2026-11-01T00:00:${String(count+1).padStart(2,'0')}.000Z`);
    return {id,content};
  };
  message('legacy-source-message','米拉把密信藏在地窖。旧塔的港口线索尚未解开。');
  database.prepare('INSERT INTO conversation_memory_state(conversation_id,user_id,updated_at) VALUES(?,?,?)').run(conversationId,userId,timestamp);
  for(const [id,name,kind,castKey] of [['legacy-mira','米拉','actor','mira'],['legacy-noel','诺埃尔','actor','noel'],['legacy-tower','月蚀钟楼','place','tower']]) {
    database.prepare(`INSERT INTO memory_entities(id,user_id,conversation_id,name,kind,cast_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(id,userId,conversationId,name,kind,castKey,timestamp,timestamp);
  }
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_at)
    VALUES('legacy-tower-alias',?,?,'legacy-tower','旧塔','旧塔',?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) VALUES(9000,'orphan-event',?,?,'orphan')`).run(userId,conversationId);
  database.prepare(`INSERT INTO fts_memories(rowid,entity_id,user_id,conversation_id,subject,content) VALUES(9000,'orphan-memory',?,?,'orphan','orphan')`).run(userId,conversationId);
  database.prepare(`INSERT INTO conversation_memories(id,user_id,conversation_id,memory_type,content,created_at,updated_at)
    VALUES('legacy-memory',?,?,'event','密信实际藏在地窖。',?,?)`).run(userId,conversationId,timestamp,timestamp);
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,subject_entity_id,content,narrative_order,
    truth_status,visibility,actor_ids_json,source_hash,created_at) VALUES('legacy-event',?,?,'legacy-memory','event','legacy-tower',
    '密信实际藏在地窖。',1,'established','restricted','["legacy-mira"]','legacy-source-hash',?)`).run(userId,conversationId,timestamp);
  const sourceHash=memoryHash({role:'assistant',content:'米拉把密信藏在地窖。旧塔的港口线索尚未解开。',attachments:[]});
  database.prepare(`INSERT INTO memory_source_versions(id,user_id,conversation_id,message_id,message_revision,role,content,content_hash,narrative_order,recorded_at)
    VALUES('legacy-source',?,?,'legacy-source-message',1,'assistant','米拉把密信藏在地窖。旧塔的港口线索尚未解开。',?,1,?)`).run(userId,conversationId,sourceHash,timestamp);
  database.prepare(`INSERT INTO memory_evidence(id,user_id,conversation_id,event_id,source_version_id,source_kind,quote,created_at)
    VALUES('legacy-evidence',?,?,'legacy-event','legacy-source','message','米拉把密信藏在地窖',?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,epistemic_state,learned_order,created_at)
    VALUES('legacy-knowledge',?,?,'legacy-noel','legacy-event','false_belief',1,?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,content,narrative_order,truth_status,source_hash,created_at)
    VALUES('legacy-public-event',?,?,'legacy-public-memory','event','钥匙实际藏在地下室。',1,'established','public-hash',?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,epistemic_state,learned_order,created_at)
    VALUES('legacy-public-belief',?,?,'legacy-noel','legacy-public-event','false_belief',1,?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO memory_plot_threads(id,user_id,conversation_id,event_id,kind,title,status,owner_entity_id,created_order,updated_at)
    VALUES('legacy-clue',?,?,'legacy-event','clue','解开港口线索','open','legacy-mira',1,?)`).run(userId,conversationId,timestamp);
  const ledger=listAppliedMigrations(database);
  assert.deepEqual(ledger.slice(-4).map(row=>row.version),['0030','0031','0032','0033']);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.notEqual(database.prepare("SELECT rowid FROM fts_memory_events WHERE event_id='legacy-event'").get().rowid,
    database.prepare("SELECT rowid FROM memory_events WHERE id='legacy-event'").get().rowid);
  return {database,userId,conversationId,timestamp,ledger,conversation,message};
}

/** Checks exact source-row identity rather than an FTS query that could pass with stale duplicates. */
function assertSearchProjection(database,source,fts,idColumn) {
  const rows=database.prepare(`SELECT s.rowid AS source_rowid,f.rowid AS indexed_rowid,s.id
    FROM ${source} s LEFT JOIN ${fts} f ON f.${idColumn}=s.id ORDER BY s.id`).all();
  assert.ok(rows.every(row=>row.source_rowid===row.indexed_rowid),`${fts} must use each source rowid`);
  assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${fts}`).get().n,rows.length);
}

/** Exercises insert/update/delete after the repair with rowids that already diverged in the early schema. */
function assertSearchTriggers(fixture) {
  const {database,userId,conversationId,timestamp}=fixture;
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,content,narrative_order,source_hash,created_at)
    VALUES('fts-event-probe',?,?,'fts-event-probe','fact','upgradeftseventold',1,'probe',?)`).run(userId,conversationId,timestamp);
  database.prepare("UPDATE memory_events SET content='upgradeftseventnew' WHERE id='fts-event-probe'").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memory_events WHERE fts_memory_events MATCH 'upgradeftseventold'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memory_events WHERE fts_memory_events MATCH 'upgradeftseventnew'").get().n,1);
  database.prepare("DELETE FROM memory_events WHERE id='fts-event-probe'").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memory_events WHERE event_id='fts-event-probe'").get().n,0);
  database.prepare(`INSERT INTO conversation_memories(id,user_id,conversation_id,content,created_at,updated_at)
    VALUES('fts-flat-probe',?,?,'upgradeftsflatold',?,?)`).run(userId,conversationId,timestamp,timestamp);
  database.prepare("UPDATE conversation_memories SET content='upgradeftsflatnew' WHERE id='fts-flat-probe'").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memories WHERE fts_memories MATCH 'upgradeftsflatold'").get().n,0);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memories WHERE fts_memories MATCH 'upgradeftsflatnew'").get().n,1);
  database.prepare("DELETE FROM conversation_memories WHERE id='fts-flat-probe'").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM fts_memories WHERE entity_id='fts-flat-probe'").get().n,0);
  assertSearchProjection(database,'memory_events','fts_memory_events','event_id');
  assertSearchProjection(database,'conversation_memories','fts_memories','entity_id');
}

for(const partial of [false,true]) test(`recorded ${partial?'intermediate':'early'} memory schema upgrades without replaying 0030 and supports versioned writes`,t=>{
  const fixture=earlyFixture(t,partial); const {database,userId,conversationId}=fixture;
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM memory_commits').get().n,0);
  initializeDatabase(database);
  assert.deepEqual(listAppliedMigrations(database).filter(row=>row.version<='0033'),fixture.ledger);
  assert.equal(listAppliedMigrations(database).at(-1).version,latestSchemaVersion);
  for(const [table,columns] of Object.entries({
    conversation_memory_state:['core_commit_id'],memory_commits:['parent_commit_id'],memory_entities:['created_commit_id'],
    memory_entity_aliases:['created_order','created_commit_id'],memory_events:['event_sequence'],
    memory_actor_knowledge:['commit_id','belief_content'],memory_plot_threads:['commit_id','thread_key']
  })) {
    const actual=new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
    assert.ok(columns.every(column=>actual.has(column)),`${table} must expose every current runtime column`);
  }
  for(const [table,id] of [['memory_entities','legacy-mira'],['memory_entities','legacy-noel'],['memory_entities','legacy-tower'],
    ['memory_entity_aliases','legacy-tower-alias'],['memory_events','legacy-event'],['memory_source_versions','legacy-source'],
    ['memory_evidence','legacy-evidence'],['memory_actor_knowledge','legacy-knowledge'],['memory_plot_threads','legacy-clue']]) {
    assert.ok(database.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id),`the upgrade must preserve ${id}`);
  }
  assert.equal(database.prepare("SELECT thread_key FROM memory_plot_threads WHERE id='legacy-clue'").get().thread_key,'legacy-clue');
  assert.ok(database.prepare("SELECT event_sequence FROM memory_events WHERE id='legacy-event'").get().event_sequence>0);
  const missingBelief=database.prepare("SELECT epistemic_state,belief_content FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get();
  assert.equal(missingBelief.epistemic_state,'false_belief');
  assert.equal(missingBelief.belief_content,'');
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel'}).some(row=>/地窖|地下室/.test(row.content)),false);
  assertSearchProjection(database,'memory_events','fts_memory_events','event_id');
  assertSearchProjection(database,'conversation_memories','fts_memories','entity_id');

  const baseline=ensureMemoryBaseline(database,userId,conversationId,{kind:'adopted_baseline',messageId:'legacy-source-message',
    entities:[{key:'mira',id:'legacy-mira',name:'米拉',castKey:'mira'},{key:'noel',id:'legacy-noel',name:'诺埃尔',castKey:'noel'},
      {key:'tower',id:'legacy-tower',name:'月蚀钟楼',kind:'place',castKey:'tower',aliases:['旧塔']}]});
  assert.ok(baseline.commitId);
  database.prepare("UPDATE conversations SET state_status='ready' WHERE id=?").run(conversationId);
  const original=captureMemoryCheckpoint(database,userId,conversationId);
  fixture.message('second-source-message','米拉在月蚀钟楼承诺明晚归还星图，赛勒在场。');
  const first=commitMemoryPacket(database,userId,conversationId,{messageId:'second-source-message',sources:[{messageId:'second-source-message',revision:1}],
    entities:[{key:'guide',name:'赛勒',kind:'actor',castKey:'guide'},
      {key:'tower',id:'legacy-tower',name:'月蚀钟楼',kind:'place',aliases:['晨星塔']}],
    events:[{key:'promise',kind:'promise',subjectEntityId:'legacy-tower',participants:['guide'],content:'米拉承诺明晚归还星图。',
      evidence:[{messageId:'second-source-message',quote:'米拉在月蚀钟楼承诺明晚归还星图'}]}],
    knowledge:[{eventId:'legacy-event',actorEntityId:'legacy-noel',epistemicState:'false_belief',beliefContent:'诺埃尔相信密信在阁楼。'}]
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM memory_actor_knowledge WHERE actor_entity_id='legacy-noel' AND event_id='legacy-event'").get().n,2);
  const later=commitMemoryPacket(database,userId,conversationId,{messageId:'second-source-message',sources:[{messageId:'second-source-message',revision:1}],
    events:[{key:'answer',content:'诺埃尔解开了港口线索。',evidence:[{messageId:'second-source-message',quote:''}]}],
    knowledge:[{eventId:'legacy-event',actorEntityId:'legacy-noel',epistemicState:'knows'}],
    threads:[{id:'legacy-clue',eventKey:'answer',status:'resolved'}]
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM memory_actor_knowledge WHERE actor_entity_id='legacy-noel' AND event_id='legacy-event'").get().n,3);
  assert.equal(listCurrentMemoryKnowledge(database,userId,conversationId,{actorId:'legacy-noel'})[0].epistemic_state,'knows');
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel',commitId:first.commitId}).find(row=>row.id==='legacy-event').content,'诺埃尔相信密信在阁楼。');
  assert.equal(database.prepare('SELECT parent_commit_id FROM memory_commits WHERE id=?').get(later.commitId).parent_commit_id,first.commitId);

  restoreMemoryCheckpoint(database,userId,conversationId,original);
  assert.equal(resolveMemoryEntity(database,userId,conversationId,'晨星塔'),null);
  const alternate=commitMemoryPacket(database,userId,conversationId,{messageId:'second-source-message',sources:[{messageId:'second-source-message',revision:1}],
    entities:[{key:'guide',name:'莱恩',kind:'actor',castKey:'guide'},
      {key:'tower',id:'legacy-tower',name:'月蚀钟楼',kind:'place',aliases:['晨星塔']}],
    events:[{key:'alternate-promise',kind:'promise',subjectEntityId:'legacy-tower',participants:['guide'],content:'米拉另行承诺后天归还星图。',
      evidence:[{messageId:'second-source-message',quote:''}]}]
  });
  assert.notEqual(alternate.commitId,first.commitId);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM memory_entities WHERE conversation_id=? AND cast_key='guide'").get(conversationId).n,2);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM memory_entity_aliases WHERE entity_id='legacy-tower' AND normalized_alias='晨星塔'").get().n,2);
  assert.equal(listMemoryEntities(database,userId,conversationId).find(row=>row.cast_key==='guide').name,'莱恩');
  const recall=retrieveMemoryContext(database,userId,conversationId,{query:'晨星塔的星图承诺',limit:8});
  assert.ok(recall.entries.some(row=>row.eventId===alternate.eventIds[0]&&row.reasons.includes('entity_graph')));
  writeConversationCheckpoint(database,userId,conversationId);
  const branch=branchConversation(database,userId,conversationId,'second-source-message');
  assert.equal(listMemoryEntities(database,userId,branch.id).find(row=>row.cast_key==='guide').name,'莱恩');
  assert.equal(resolveMemoryEntity(database,userId,branch.id,'晨星塔').name,'月蚀钟楼');
  assert.equal(listMemoryRecords(database,userId,branch.id).some(row=>row.content==='米拉承诺明晚归还星图。'),false);

  fixture.conversation('post-upgrade-new-conversation');
  fixture.message('post-upgrade-opening','新故事的开场。','post-upgrade-new-conversation');
  const fresh=ensureMemoryBaseline(database,userId,'post-upgrade-new-conversation',{messageId:'post-upgrade-opening',entities:[{key:'new-main',name:'新主角',castKey:'main'}]});
  assert.equal(fresh.baselineKind,'bootstrap');
  assert.ok(fresh.commitId);
  assertSearchTriggers(fixture);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  const beforeRestart={ledger:listAppliedMigrations(database),events:database.prepare('SELECT * FROM memory_events ORDER BY id').all(),
    entities:database.prepare('SELECT * FROM memory_entities ORDER BY id').all(),knowledge:database.prepare('SELECT * FROM memory_actor_knowledge ORDER BY id').all()};
  initializeDatabase(database);
  assert.deepEqual({ledger:listAppliedMigrations(database),events:database.prepare('SELECT * FROM memory_events ORDER BY id').all(),
    entities:database.prepare('SELECT * FROM memory_entities ORDER BY id').all(),knowledge:database.prepare('SELECT * FROM memory_actor_knowledge ORDER BY id').all()},beforeRestart);
  assertSearchProjection(database,'memory_events','fts_memory_events','event_id');
  assertSearchProjection(database,'conversation_memories','fts_memories','entity_id');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('nonempty early commit history repairs only proven ancestry and does not backdate mutable actor knowledge',t=>{
  const fixture=earlyFixture(t,true); const {database,userId,conversationId,timestamp}=fixture;
  fixture.message('second-legacy-message','诺埃尔此时得知了密信的真相，港口线索得到解决。');
  const insert=database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,timeline_revision,
    base_revision,revision,narrative_order,message_id,message_revision,kind,receipt_json,created_at) VALUES(?,?,?,?,?,1,?,?,?,? ,1,'turn','{}',?)`);
  insert.run('old-first',userId,conversationId,'old-first','first-hash',0,1,1,'legacy-source-message',timestamp);
  insert.run('old-second',userId,conversationId,'old-second','second-hash',1,2,2,'second-legacy-message',timestamp);
  insert.run('old-unproven',userId,conversationId,'old-unproven','gap-hash',3,4,2,'second-legacy-message',timestamp);
  database.prepare("UPDATE conversation_memory_state SET revision=2,core_order=2,core_message_id='second-legacy-message',core_message_revision=1 WHERE conversation_id=?").run(conversationId);
  database.prepare("UPDATE memory_events SET commit_id='old-first' WHERE id='legacy-event'").run();
  database.prepare("UPDATE memory_events SET commit_id='old-second',narrative_order=2 WHERE id='legacy-public-event'").run();
  database.prepare("UPDATE memory_actor_knowledge SET epistemic_state='knows' WHERE id='legacy-knowledge'").run();
  database.prepare("UPDATE memory_plot_threads SET status='resolved',resolved_event_id='legacy-public-event' WHERE id='legacy-clue'").run();
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_at)
    VALUES('late-legacy-alias',?,?,'legacy-tower','后来塔名','后来塔名',?)`).run(userId,conversationId,timestamp);
  initializeDatabase(database);
  assert.equal(database.prepare("SELECT parent_commit_id FROM memory_commits WHERE id='old-second'").get().parent_commit_id,'old-first');
  assert.equal(database.prepare("SELECT parent_commit_id FROM memory_commits WHERE id='old-unproven'").get().parent_commit_id,null,
    'a missing base revision cannot be filled by the nearest preceding commit');
  assert.equal(database.prepare('SELECT core_commit_id FROM conversation_memory_state WHERE conversation_id=?').get(conversationId).core_commit_id,'old-second');
  assert.equal(database.prepare("SELECT learned_order FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get().learned_order,2);
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel',asOfOrder:1}).some(row=>row.content.includes('地窖')),false);
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel',commitId:'old-first',asOfOrder:1}).some(row=>row.content.includes('地窖')),false);
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel',asOfOrder:2}).some(row=>row.content.includes('地窖')),true);
  assert.equal(listMemoryRecords(database,userId,conversationId,{actorId:'legacy-noel',asOfOrder:2}).some(row=>row.content.includes('地下室')),false,
    'a missing false-belief text cannot fall back to a public author truth');
  assert.equal(resolveMemoryEntity(database,userId,conversationId,'后来塔名',{asOfOrder:1}),null);
  assert.equal(resolveMemoryEntity(database,userId,conversationId,'后来塔名',{asOfOrder:2}).id,'legacy-tower');
  assert.equal(listCurrentMemoryThreads(database,userId,conversationId,{asOfOrder:1}).some(row=>row.status==='resolved'),false);
  assert.equal(listCurrentMemoryThreads(database,userId,conversationId,{asOfOrder:2})[0].status,'resolved');
  assert.equal(database.prepare('SELECT state_status FROM conversations WHERE id=?').get(conversationId).state_status,'legacy_partial');
  assert.equal(JSON.parse(database.prepare('SELECT baseline_json FROM conversation_memory_state WHERE conversation_id=?').get(conversationId).baseline_json).historicalMemoryIncomplete,true);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  const revisions=database.prepare('SELECT id,parent_commit_id FROM memory_commits ORDER BY id').all();
  initializeDatabase(database);
  assert.deepEqual(database.prepare('SELECT id,parent_commit_id FROM memory_commits ORDER BY id').all(),revisions);
});

test('failed early schema repair rolls back DDL and FTS changes, restores FK enforcement and can retry',t=>{
  const fixture=earlyFixture(t); const {database,userId,conversationId,timestamp}=fixture;
  database.exec('PRAGMA foreign_keys=OFF');
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_at)
    VALUES('broken-alias',?,?,'missing-entity','broken','broken',?)`).run(userId,conversationId,timestamp);
  database.exec('PRAGMA foreign_keys=ON');
  const events=database.prepare('SELECT rowid,* FROM fts_memory_events ORDER BY rowid').all();
  assert.throws(()=>initializeDatabase(database),/Memory schema upgrade foreign key check failed/);
  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='0034'").get().n,0);
  assert.equal(database.prepare('PRAGMA table_info(conversation_memory_state)').all().some(row=>row.name==='core_commit_id'),false);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_upgrade_0034'").get().n,0);
  assert.deepEqual(database.prepare('SELECT rowid,* FROM fts_memory_events ORDER BY rowid').all(),events);
  assert.match(database.prepare("SELECT sql FROM sqlite_master WHERE name='memory_events_fts_delete'").get().sql,/WHERE event_id=OLD.id/);
  assert.ok(database.prepare("SELECT id FROM memory_entity_aliases WHERE id='broken-alias'").get());
  database.prepare("DELETE FROM memory_entity_aliases WHERE id='broken-alias'").run();
  initializeDatabase(database);
  assert.equal(listAppliedMigrations(database).at(-1).version,latestSchemaVersion);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  assertSearchProjection(database,'memory_events','fts_memory_events','event_id');
});

test('sequence repair is deterministic without automatic indexes and preserves positive intermediate sequences',t=>{
  const fixture=earlyFixture(t,true); const {database,userId,conversationId}=fixture;
  database.exec('PRAGMA automatic_index=OFF');
  database.prepare("UPDATE memory_events SET event_sequence=7,created_at='2026-11-01T00:00:06.000Z' WHERE id='legacy-event'").run();
  database.prepare("UPDATE memory_events SET created_at='2026-11-01T00:00:05.000Z' WHERE id='legacy-public-event'").run();
  const insert=database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,memory_id,kind,content,narrative_order,source_hash,created_at)
    VALUES(?,?,?,?,'event','历史排序样例',1,'sequence-fixture',?)`);
  insert.run('row-first',userId,conversationId,'row-first','2026-11-01T00:00:03.000Z');
  insert.run('row-second',userId,conversationId,'row-second','2026-11-01T00:00:01.000Z');
  insert.run('row-third',userId,conversationId,'row-third','2026-11-01T00:00:03.000Z');
  initializeDatabase(database);
  const sequences=()=>Object.fromEntries(database.prepare('SELECT id,event_sequence FROM memory_events ORDER BY id').all()
    .map(row=>[row.id,row.event_sequence]));
  assert.equal(database.prepare('PRAGMA automatic_index').get().automatic_index,0);
  assert.deepEqual(sequences(),{'legacy-event':7,'legacy-public-event':11,'row-first':9,'row-second':8,'row-third':10});
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  initializeDatabase(database);
  assert.deepEqual(sequences(),{'legacy-event':7,'legacy-public-event':11,'row-first':9,'row-second':8,'row-third':10});
});

for(const ambiguous of [false,true]) test(`${ambiguous?'ambiguous':'missing'} legacy head quarantines unproven metadata without guessing current ancestry`,t=>{
  const fixture=earlyFixture(t,true); const {database,userId,conversationId,timestamp}=fixture;
  fixture.message('later-legacy-message','后来诺埃尔得知真相，一名新角色来到后来塔名所指的钟楼。');
  const insert=database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,timeline_revision,
    base_revision,revision,narrative_order,message_id,message_revision,kind,receipt_json,created_at) VALUES(?,?,?,?,?,1,?,?,?,? ,1,'turn','{}',?)`);
  insert.run('head-old-first',userId,conversationId,'head-old-first','old-first-hash',0,1,1,'legacy-source-message',timestamp);
  insert.run('head-old-second',userId,conversationId,'head-old-second','old-second-hash',1,2,2,'later-legacy-message',timestamp);
  const oldIds=['head-old-first','head-old-second'];
  if(ambiguous) {
    insert.run('head-old-shadow',userId,conversationId,'head-old-shadow','old-shadow-hash',1,2,2,'later-legacy-message',timestamp);
    oldIds.push('head-old-shadow');
  }
  database.prepare("UPDATE conversation_memory_state SET revision=?,core_order=2,core_message_id='later-legacy-message',core_message_revision=1 WHERE conversation_id=?")
    .run(ambiguous?2:99,conversationId);
  database.prepare("UPDATE memory_events SET commit_id='head-old-first' WHERE id='legacy-event'").run();
  database.prepare("UPDATE memory_events SET commit_id='head-old-second',narrative_order=2 WHERE id='legacy-public-event'").run();
  database.prepare("UPDATE memory_actor_knowledge SET epistemic_state='knows' WHERE id='legacy-knowledge'").run();
  database.prepare(`INSERT INTO memory_entities(id,user_id,conversation_id,kind,name,cast_key,created_order,created_at,updated_at)
    VALUES('late-unproven-entity',?,?,'actor','后来角色','later-cast',2,?,?)`).run(userId,conversationId,timestamp,timestamp);
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_at)
    VALUES('late-unproven-alias',?,?,'legacy-tower','后来塔名','后来塔名',?)`).run(userId,conversationId,timestamp);
  initializeDatabase(database);
  const state=database.prepare('SELECT * FROM conversation_memory_state WHERE conversation_id=?').get(conversationId);
  assert.equal(state.core_commit_id,'','an unavailable head must never be guessed or replaced by the quarantine receipt');
  assert.equal(state.baseline_kind,'legacy_partial');
  const quarantined=database.prepare("SELECT * FROM memory_commits WHERE conversation_id=? AND kind='schema_upgrade_quarantine'").all(conversationId);
  assert.equal(quarantined.length,1);
  const quarantine=quarantined[0];
  assert.equal(quarantine.parent_commit_id,null);
  assert.equal(quarantine.revision,-1);
  assert.equal(quarantine.base_revision,0);
  assert.equal(quarantine.packet_hash,'migration:0034:unproven-metadata');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM memory_commits WHERE parent_commit_id=?').get(quarantine.id).n,0);
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entities WHERE id='late-unproven-entity'").get().created_commit_id,quarantine.id);
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entity_aliases WHERE id='late-unproven-alias'").get().created_commit_id,quarantine.id);
  assert.equal(database.prepare("SELECT commit_id FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get().commit_id,quarantine.id);
  assert.equal(database.prepare("SELECT commit_id FROM memory_plot_threads WHERE id='legacy-clue'").get().commit_id,quarantine.id);
  for(const commitId of [undefined,'',...oldIds]) {
    const scope={commitId,asOfOrder:Number.MAX_SAFE_INTEGER};
    assert.equal(resolveMemoryEntity(database,userId,conversationId,'后来塔名',scope),null);
    assert.equal(listMemoryEntities(database,userId,conversationId,scope).some(row=>row.id==='late-unproven-entity'),false);
    assert.equal(listCurrentMemoryKnowledge(database,userId,conversationId,{...scope,actorId:'legacy-noel'}).length,0);
    assert.equal(listCurrentMemoryThreads(database,userId,conversationId,scope).length,0);
    assert.equal(listMemoryRecords(database,userId,conversationId,{...scope,actorId:'legacy-noel'}).some(row=>row.content.includes('地窖')),false);
  }
  assert.ok(listMemoryRecords(database,userId,conversationId,{commitId:'head-old-first',actorId:'legacy-mira'}).some(row=>row.id==='legacy-event'),
    'proven original events remain readable through their original historical commit');
  for(const [table,id] of [['memory_entities','late-unproven-entity'],['memory_entities','legacy-mira'],['memory_entity_aliases','late-unproven-alias'],
    ['memory_entity_aliases','legacy-tower-alias'],['memory_actor_knowledge','legacy-knowledge'],['memory_actor_knowledge','legacy-public-belief'],
    ['memory_plot_threads','legacy-clue'],['memory_events','legacy-event'],['memory_evidence','legacy-evidence']]) {
    assert.ok(database.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id),`unproven provenance must preserve original row ${id}`);
  }
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  const beforeRestart={commits:database.prepare('SELECT * FROM memory_commits ORDER BY id').all(),state,
    aliases:database.prepare('SELECT * FROM memory_entity_aliases ORDER BY id').all(),
    knowledge:database.prepare('SELECT * FROM memory_actor_knowledge ORDER BY id').all()};
  initializeDatabase(database);
  assert.deepEqual({commits:database.prepare('SELECT * FROM memory_commits ORDER BY id').all(),
    state:database.prepare('SELECT * FROM conversation_memory_state WHERE conversation_id=?').get(conversationId),
    aliases:database.prepare('SELECT * FROM memory_entity_aliases ORDER BY id').all(),
    knowledge:database.prepare('SELECT * FROM memory_actor_knowledge ORDER BY id').all()},beforeRestart);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
});

/** Simulates a database that already recorded the first 0034, before its data-only safeguards existed. */
function recordedProvenanceFixture(t) {
  const fixture=earlyFixture(t); const {database,userId,conversationId,timestamp}=fixture;
  initializeDatabase(database);
  const cutoff='2026-11-01T00:00:20.000Z'; const modernDate='2026-11-01T00:00:21.000Z';
  database.prepare("DELETE FROM schema_migrations WHERE version IN ('0035','0036')").run();
  database.prepare("UPDATE schema_migrations SET applied_at=? WHERE version='0034'").run(cutoff);
  database.prepare("DELETE FROM _schema_meta WHERE key='memory_provenance_reconciled'").run();
  for(let order=2;order<=9;order+=1) fixture.message(`recorded-message-${order}`,`已登记升级后的第${order}个剧情节点。`);
  const commit=database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,timeline_revision,
    base_revision,revision,narrative_order,message_id,message_revision,kind,receipt_json,created_at,parent_commit_id)
    VALUES(?,?,?,?,?,1,?,?,?,? ,1,'turn','{}',?,?)`);
  commit.run('provenance-bound',userId,conversationId,'provenance-bound','bound-hash',0,1,2,'recorded-message-2',timestamp,null);
  commit.run('provenance-current',userId,conversationId,'provenance-current','current-hash',1,2,9,'recorded-message-9',timestamp,'provenance-bound');
  database.prepare("UPDATE conversation_memory_state SET revision=2,core_order=9,core_commit_id='provenance-current',core_message_id='recorded-message-9',core_message_revision=1 WHERE conversation_id=?")
    .run(conversationId);
  database.prepare("UPDATE memory_actor_knowledge SET commit_id='provenance-bound',learned_order=1,epistemic_state='knows' WHERE id='legacy-knowledge'").run();
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,commit_id,memory_id,kind,content,narrative_order,source_hash,created_at)
    VALUES('provenance-disclosure',?,?,'provenance-current','provenance-disclosure','event','第三个节点出现的来源证据。',3,'disclosure-hash',?)`).run(userId,conversationId,timestamp);
  database.prepare("UPDATE memory_actor_knowledge SET commit_id='provenance-bound',learned_order=1,learned_from_event_id='provenance-disclosure' WHERE id='legacy-public-belief'").run();
  database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,epistemic_state,learned_order,created_at)
    VALUES('old-unbound-knowledge',?,?,'legacy-mira','legacy-event','knows',1,?)`).run(userId,conversationId,timestamp);
  database.prepare(`INSERT INTO memory_entities(id,user_id,conversation_id,kind,name,cast_key,created_order,created_at,updated_at)
    VALUES('old-unbound-entity',?,?,'actor','来源待确认的角色','unbound-old',2,?,?)`).run(userId,conversationId,timestamp,timestamp);
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_order,created_at)
    VALUES('old-unbound-alias',?,?,'legacy-tower','待确认塔名','待确认塔名',2,?)`).run(userId,conversationId,timestamp);
  database.prepare("UPDATE memory_entity_aliases SET created_commit_id='provenance-bound' WHERE id='legacy-tower-alias'").run();
  database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,commit_id,epistemic_state,learned_order,created_at)
    VALUES('modern-bound-knowledge',?,?,'legacy-mira','legacy-public-event','provenance-current','knows',1,?)`).run(userId,conversationId,modernDate);
  database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,epistemic_state,learned_order,created_at)
    VALUES('modern-unbound-knowledge',?,?,'legacy-noel','legacy-public-event','knows',1,?)`).run(userId,conversationId,modernDate);
  database.prepare(`INSERT INTO memory_entities(id,user_id,conversation_id,kind,name,cast_key,created_order,created_at,updated_at)
    VALUES('modern-unbound-entity',?,?,'actor','升级后新角色','unbound-modern',5,?,?)`).run(userId,conversationId,modernDate,modernDate);
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_order,created_at)
    VALUES('modern-unbound-alias',?,?,'legacy-tower','升级后塔名','升级后塔名',5,?)`).run(userId,conversationId,modernDate);
  database.prepare(`INSERT INTO memory_plot_threads(id,user_id,conversation_id,event_id,thread_key,kind,title,status,created_order,updated_at)
    VALUES('modern-unbound-thread',?,?,'legacy-event','modern-unbound-thread','clue','升级后的新线索','open',5,?)`).run(userId,conversationId,modernDate);
  const modernConversation='modern-bootstrap-conversation';
  fixture.conversation(modernConversation);
  fixture.message('modern-bootstrap-message','现代基线开场。',modernConversation);
  ensureMemoryBaseline(database,userId,modernConversation,{messageId:'modern-bootstrap-message',entities:[{key:'modern-main',name:'现代主角',castKey:'main'}]});
  // Even an older timestamp cannot make an explicitly modern bootstrap eligible for legacy repair.
  database.prepare('UPDATE memory_commits SET created_at=? WHERE conversation_id=?').run(timestamp,modernConversation);
  database.prepare('UPDATE memory_entities SET created_at=?,updated_at=? WHERE conversation_id=?').run(timestamp,timestamp,modernConversation);
  const modernRows=()=>({state:database.prepare('SELECT * FROM conversation_memory_state WHERE conversation_id=?').get(modernConversation),
    conversation:database.prepare('SELECT * FROM conversations WHERE id=?').get(modernConversation),
    entities:database.prepare('SELECT * FROM memory_entities WHERE conversation_id=? ORDER BY id').all(modernConversation),
    commits:database.prepare('SELECT * FROM memory_commits WHERE conversation_id=? ORDER BY id').all(modernConversation),
    recentKnowledge:database.prepare('SELECT * FROM memory_actor_knowledge WHERE created_at>? ORDER BY id').all(cutoff),
    recentAliases:database.prepare('SELECT * FROM memory_entity_aliases WHERE created_at>? ORDER BY id').all(cutoff),
    recentEntities:database.prepare('SELECT * FROM memory_entities WHERE created_at>? ORDER BY id').all(cutoff),
    recentThreads:database.prepare('SELECT * FROM memory_plot_threads WHERE updated_at>? ORDER BY id').all(cutoff)});
  return {...fixture,modernRows};
}

/** Captures all rows the data repair may touch, including its global marker and recovery receipt. */
function provenanceSnapshot(database) {
  const tables=['conversations','memory_commits','memory_entities','memory_entity_aliases','memory_actor_knowledge','memory_plot_threads','memory_summaries','memory_embedding_indexes'];
  return {tables:Object.fromEntries(tables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])),
    states:database.prepare('SELECT * FROM conversation_memory_state ORDER BY conversation_id').all(),
    meta:database.prepare('SELECT * FROM _schema_meta ORDER BY key').all(),ledger:listAppliedMigrations(database)};
}

test('recorded first 0034 receives data-only repair at bound narrative time while modern rows remain byte-for-byte unchanged',t=>{
  const fixture=recordedProvenanceFixture(t); const {database,conversationId}=fixture;
  const modern=fixture.modernRows();
  migrateMemoryProvenanceRepair(database);
  assert.equal(database.prepare("SELECT learned_order FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get().learned_order,2,
    'use the bound commit order rather than the later current core order nine');
  assert.equal(database.prepare("SELECT learned_order FROM memory_actor_knowledge WHERE id='legacy-public-belief'").get().learned_order,3,
    'a later explicit source event also bounds when knowledge can be recalled');
  assert.deepEqual(fixture.modernRows(),modern);
  const quarantine=database.prepare("SELECT * FROM memory_commits WHERE conversation_id=? AND kind='schema_upgrade_quarantine'").all(conversationId);
  assert.equal(quarantine.length,1);
  const recovery=quarantine[0].id;
  assert.equal(database.prepare("SELECT commit_id FROM memory_actor_knowledge WHERE id='old-unbound-knowledge'").get().commit_id,recovery);
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entities WHERE id='old-unbound-entity'").get().created_commit_id,recovery);
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entity_aliases WHERE id='old-unbound-alias'").get().created_commit_id,recovery);
  assert.equal(database.prepare("SELECT commit_id FROM memory_plot_threads WHERE id='legacy-clue'").get().commit_id,recovery);
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entity_aliases WHERE id='legacy-tower-alias'").get().created_commit_id,'provenance-bound');
  assert.equal(database.prepare("SELECT created_commit_id FROM memory_entities WHERE id='legacy-mira'").get().created_commit_id,null,
    'a real order-zero baseline remains a baseline');
  assert.equal(database.prepare('SELECT core_commit_id FROM conversation_memory_state WHERE conversation_id=?').get(conversationId).core_commit_id,'provenance-current');
  assert.equal(database.prepare("SELECT value FROM _schema_meta WHERE key='memory_provenance_reconciled'").get().value,'2');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
  const repaired=provenanceSnapshot(database);
  migrateMemoryProvenanceRepair(database);
  assert.deepEqual(provenanceSnapshot(database),repaired);
  initializeDatabase(database);
  const restarted=provenanceSnapshot(database);
  assert.deepEqual({...restarted,ledger:repaired.ledger},repaired);
  assert.deepEqual(restarted.ledger.filter(row=>row.version<='0034'),repaired.ledger);
  assert.equal(restarted.ledger.at(-1).version,latestSchemaVersion);
});

test('provenance version two marker makes data repair a true no-op',t=>{
  const fixture=recordedProvenanceFixture(t); const {database}=fixture;
  database.prepare("INSERT INTO _schema_meta(key,value) VALUES('memory_provenance_reconciled','2')").run();
  const before=provenanceSnapshot(database);
  const changes=database.prepare('SELECT total_changes() AS n').get().n;
  migrateMemoryProvenanceRepair(database);
  assert.equal(database.prepare('SELECT total_changes() AS n').get().n,changes);
  assert.deepEqual(provenanceSnapshot(database),before);
  assert.equal(database.prepare("SELECT learned_order FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get().learned_order,1);
});

test('data reconciliation rolls back knowledge, quarantine receipts and marker together on an FK failure',t=>{
  const fixture=recordedProvenanceFixture(t); const {database,userId,conversationId,timestamp}=fixture;
  database.exec('PRAGMA foreign_keys=OFF');
  database.prepare(`INSERT INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_at)
    VALUES('repair-broken-alias',?,?,'missing-repair-entity','repair-broken','repair-broken',?)`).run(userId,conversationId,timestamp);
  database.exec('PRAGMA foreign_keys=ON');
  const before=provenanceSnapshot(database);
  assert.throws(()=>migrateMemoryProvenanceRepair(database),/Memory provenance repair foreign key check failed/);
  assert.deepEqual(provenanceSnapshot(database),before);
  assert.equal(database.prepare("SELECT value FROM _schema_meta WHERE key='memory_provenance_reconciled'").get(),undefined);
  assert.equal(database.prepare("SELECT learned_order FROM memory_actor_knowledge WHERE id='legacy-knowledge'").get().learned_order,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM memory_commits WHERE kind='schema_upgrade_quarantine'").get().n,0);
  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  database.prepare("DELETE FROM memory_entity_aliases WHERE id='repair-broken-alias'").run();
  migrateMemoryProvenanceRepair(database);
  assert.equal(database.prepare("SELECT value FROM _schema_meta WHERE key='memory_provenance_reconciled'").get().value,'2');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
});
