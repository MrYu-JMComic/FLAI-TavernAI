import { randomUUID } from 'node:crypto';

/** Upgrade already-recorded early V1 schemas without replaying migration 0030 or its data import. */
export function migrateConversationMemoryUpgrade(database) {
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get().foreign_keys;
  database.exec('PRAGMA foreign_keys=OFF');
  if (database.prepare('PRAGMA foreign_keys').get().foreign_keys) {
    throw new Error('Memory schema upgrade requires a standalone startup transaction');
  }
  let started = false;
  try {
    database.exec('SAVEPOINT migration_0034_memory_upgrade');
    started = true;
    const added = new Set();
    const oldSearch = database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='memory_events_fts_delete'").get();
    let legacySchema = Boolean(oldSearch && !/WHERE\s+rowid\s*=/i.test(oldSearch.sql));
    for (const [table, fields] of Object.entries({
      conversation_memory_state: { core_commit_id: "TEXT NOT NULL DEFAULT ''" },
      memory_commits: { parent_commit_id: 'TEXT REFERENCES memory_commits(id) ON DELETE SET NULL' },
      memory_entities: { created_commit_id: 'TEXT' },
      memory_entity_aliases: { created_order: 'INTEGER NOT NULL DEFAULT 0', created_commit_id: 'TEXT' },
      memory_events: { event_sequence: 'INTEGER NOT NULL DEFAULT 0' },
      memory_actor_knowledge: { commit_id: 'TEXT REFERENCES memory_commits(id) ON DELETE CASCADE', belief_content: "TEXT NOT NULL DEFAULT ''" },
      memory_plot_threads: { commit_id: 'TEXT REFERENCES memory_commits(id) ON DELETE CASCADE', thread_key: "TEXT NOT NULL DEFAULT ''" }
    })) {
      const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      for (const [name, definition] of Object.entries(fields)) if (!columns.has(name)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        added.add(`${table}.${name}`);
      }
    }

    // Table UNIQUE constraints create SQLite autoindexes; adding columns alone cannot remove them.
    legacySchema = rebuildObsoleteUnique(database, 'memory_entities', ['conversation_id', 'cast_key'], `
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, name TEXT NOT NULL, cast_key TEXT NOT NULL DEFAULT '',
      domain_kind TEXT NOT NULL DEFAULT '', domain_id TEXT NOT NULL DEFAULT '', created_commit_id TEXT,
      lifecycle TEXT NOT NULL DEFAULT 'active', created_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL`) || legacySchema;
    legacySchema = rebuildObsoleteUnique(database, 'memory_entity_aliases', ['entity_id', 'normalized_alias'], `
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
      source_event_id TEXT NOT NULL DEFAULT '', created_order INTEGER NOT NULL DEFAULT 0,
      created_commit_id TEXT, created_at TEXT NOT NULL,
      UNIQUE(entity_id, normalized_alias, created_commit_id)`) || legacySchema;
    legacySchema = rebuildObsoleteUnique(database, 'memory_actor_knowledge', ['actor_entity_id', 'event_id'], `
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      actor_entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      commit_id TEXT REFERENCES memory_commits(id) ON DELETE CASCADE,
      epistemic_state TEXT NOT NULL, learned_from_event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
      learned_order INTEGER NOT NULL, source_evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
      belief_content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL`) || legacySchema;

    backfillLegacyProvenance(database, added, legacySchema || added.size > 0);
    database.exec(`
      DROP INDEX IF EXISTS idx_memory_cast_key;
      CREATE UNIQUE INDEX idx_memory_cast_key ON memory_entities(conversation_id,cast_key,created_commit_id) WHERE cast_key<>'';
      CREATE INDEX IF NOT EXISTS idx_memory_event_supersedes ON memory_events(supersedes_id,narrative_order,lifecycle);
      CREATE INDEX IF NOT EXISTS idx_memory_event_order ON memory_events(user_id,conversation_id,narrative_order,event_sequence);
      CREATE INDEX IF NOT EXISTS idx_memory_evidence_event ON memory_evidence(event_id,source_version_id);
    `);
    rebuildMemorySearch(database);
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`Memory schema upgrade foreign key check failed (${violations.length})`);
    database.prepare("INSERT OR REPLACE INTO _schema_meta(key,value) VALUES('memory_provenance_reconciled','2')").run();
    database.exec('RELEASE SAVEPOINT migration_0034_memory_upgrade');
  } catch (error) {
    if (started) {
      database.exec('ROLLBACK TO SAVEPOINT migration_0034_memory_upgrade');
      database.exec('RELEASE SAVEPOINT migration_0034_memory_upgrade');
    }
    throw error;
  } finally {
    database.exec(`PRAGMA foreign_keys=${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

/** Preserve IDs, rows and unrelated schema objects while removing an obsolete two-column uniqueness rule. */
function rebuildObsoleteUnique(database, table, obsoleteColumns, definition) {
  const obsolete = database.prepare(`PRAGMA index_list(${table})`).all().filter(index => index.unique &&
    database.prepare(`PRAGMA index_info("${index.name}")`).all().map(row => row.name).join(',') === obsoleteColumns.join(','));
  if (!obsolete.length) return false;
  const obsoleteNames = new Set(obsolete.map(index => index.name));
  if (obsolete.every(index => index.origin === 'c')) {
    for (const index of obsolete) database.exec(`DROP INDEX "${index.name}"`);
    return true;
  }
  const objects = database.prepare("SELECT name,sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL")
    .all(table).filter(object => !obsoleteNames.has(object.name));
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map(row => `"${row.name}"`).join(',');
  const temporary = `${table}_upgrade_0034`;
  database.exec(`CREATE TABLE ${temporary} (${definition});
    INSERT INTO ${temporary}(${columns}) SELECT ${columns} FROM ${table};
    DROP TABLE ${table};
    ALTER TABLE ${temporary} RENAME TO ${table};`);
  for (const object of objects) database.exec(object.sql);
  return true;
}

/** Only explicit revision references establish ancestry; mutable legacy metadata is visible at the current tip. */
function backfillLegacyProvenance(database, added, legacySchema) {
  const incomplete = new Set();
  if (legacySchema) {
    const predecessors = database.prepare(`SELECT id FROM memory_commits WHERE user_id=? AND conversation_id=?
      AND revision=? AND revision<? AND timeline_revision=? AND narrative_order<=?`);
    const update = database.prepare('UPDATE memory_commits SET parent_commit_id=? WHERE id=?');
    for (const row of database.prepare('SELECT * FROM memory_commits WHERE base_revision>0 AND parent_commit_id IS NULL').all()) {
      const candidates = predecessors.all(row.user_id,row.conversation_id,row.base_revision,row.revision,row.timeline_revision,row.narrative_order);
      if (candidates.length === 1) update.run(candidates[0].id,row.id);
      else incomplete.add(row.conversation_id);
    }
  }
  if (legacySchema) {
    const find = database.prepare('SELECT id FROM memory_commits WHERE user_id=? AND conversation_id=? AND revision=?');
    for (const row of database.prepare("SELECT * FROM conversation_memory_state WHERE core_commit_id=''").all()) {
      const candidates = find.all(row.user_id,row.conversation_id,row.revision);
      if (candidates.length === 1) database.prepare('UPDATE conversation_memory_state SET core_commit_id=? WHERE conversation_id=?').run(candidates[0].id,row.conversation_id);
      else if (database.prepare('SELECT 1 FROM memory_commits WHERE user_id=? AND conversation_id=? LIMIT 1').get(row.user_id,row.conversation_id)) incomplete.add(row.conversation_id);
    }
    // A missing head cannot make late mutable metadata globally visible through NULL provenance.
    // Keep it in an unselected recovery snapshot, with no invented parent or current-head assignment.
    for (const row of database.prepare(`SELECT s.* FROM conversation_memory_state s WHERE s.core_commit_id=''
      AND EXISTS(SELECT 1 FROM memory_commits c WHERE c.user_id=s.user_id AND c.conversation_id=s.conversation_id)`).all()) {
      ensureLegacyMemoryQuarantine(database,row);
      incomplete.add(row.conversation_id);
    }
  }
  database.exec(`WITH ordered AS MATERIALIZED (
      SELECT e.id,ROW_NUMBER() OVER (PARTITION BY e.user_id,e.conversation_id,e.narrative_order ORDER BY e.created_at,e.rowid)
        +MAX(0,COALESCE((SELECT MAX(prior.event_sequence) FROM memory_events prior WHERE prior.user_id=e.user_id
          AND prior.conversation_id=e.conversation_id AND prior.narrative_order=e.narrative_order),0)) AS sequence
      FROM memory_events e WHERE e.event_sequence<=0)
    UPDATE memory_events SET event_sequence=(SELECT sequence FROM ordered WHERE ordered.id=memory_events.id) WHERE event_sequence<=0`);

  const tip = table => `COALESCE(
    (SELECT NULLIF(s.core_commit_id,'') FROM conversation_memory_state s WHERE s.user_id=${table}.user_id AND s.conversation_id=${table}.conversation_id),
    (SELECT c.id FROM memory_commits c WHERE c.user_id=${table}.user_id AND c.conversation_id=${table}.conversation_id
      AND c.kind='schema_upgrade_quarantine' AND c.packet_hash='migration:0034:unproven-metadata'))`;
  if (legacySchema) database.exec(`UPDATE memory_entities SET created_commit_id=${tip('memory_entities')} WHERE created_order>0 AND created_commit_id IS NULL`);
  if (legacySchema) database.exec(`UPDATE memory_entity_aliases SET created_commit_id=${tip('memory_entity_aliases')} WHERE created_commit_id IS NULL`);
  if (legacySchema) database.exec(`UPDATE memory_entity_aliases SET created_order=MAX(
    COALESCE((SELECT created_order FROM memory_entities e WHERE e.id=memory_entity_aliases.entity_id),0),
    COALESCE((SELECT core_order FROM conversation_memory_state s WHERE s.conversation_id=memory_entity_aliases.conversation_id),0)) WHERE created_order=0`);
  if (legacySchema) database.exec(`UPDATE memory_actor_knowledge SET commit_id=${tip('memory_actor_knowledge')},learned_order=MAX(learned_order,
    COALESCE((SELECT core_order FROM conversation_memory_state s WHERE s.user_id=memory_actor_knowledge.user_id AND s.conversation_id=memory_actor_knowledge.conversation_id),0),
    COALESCE((SELECT narrative_order FROM memory_events e WHERE e.id=memory_actor_knowledge.learned_from_event_id),0)) WHERE commit_id IS NULL`);
  // Keep false_belief with empty text if its content was never stored. Actor retrieval substitutes that empty
  // belief and excludes its truth claims; changing it to unknown could fall back to public author truth.
  if (legacySchema) database.exec(`UPDATE memory_plot_threads SET commit_id=${tip('memory_plot_threads')},created_order=MAX(created_order,
    COALESCE((SELECT core_order FROM conversation_memory_state s WHERE s.conversation_id=memory_plot_threads.conversation_id),0),
    COALESCE((SELECT narrative_order FROM memory_events e WHERE e.id=memory_plot_threads.resolved_event_id),0)) WHERE commit_id IS NULL`);
  database.exec("UPDATE memory_plot_threads SET thread_key=id WHERE thread_key=''");
  for (const table of ['memory_entity_aliases','memory_actor_knowledge','memory_plot_threads']) {
    const changed = legacySchema || [...added].some(field => field.startsWith(`${table}.`));
    if (changed) for (const row of database.prepare(`SELECT DISTINCT conversation_id FROM ${table}`).all()) incomplete.add(row.conversation_id);
  }
  for (const conversationId of incomplete) markLegacyMemoryIncomplete(database,conversationId);
}

/** Preserve unprovable legacy metadata in one recovery commit that belongs to no selected lineage. */
export function ensureLegacyMemoryQuarantine(database,state) {
  const key = 'migration:0034:unproven-metadata';
  const existing = database.prepare('SELECT id,kind,packet_hash FROM memory_commits WHERE user_id=? AND conversation_id=? AND idempotency_key=?')
    .get(state.user_id,state.conversation_id,key);
  if (existing) {
    if (existing.kind !== 'schema_upgrade_quarantine' || existing.packet_hash !== key) throw new Error('Legacy memory recovery commit key conflict');
    return existing.id;
  }
  const id = randomUUID();
  database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,
    timeline_revision,base_revision,revision,narrative_order,kind,receipt_json,created_at)
    VALUES(?,?,?,?,?,?,0,-1,?,'schema_upgrade_quarantine',?,?)`)
    .run(id,state.user_id,state.conversation_id,key,key,state.timeline_revision,state.core_order,
      JSON.stringify({ commitId: id, schemaUpgrade: '0034', quarantined: true, historicalMemoryIncomplete: true }),state.updated_at);
  return id;
}

/** Label incomplete history while preserving its previous baseline and invalidating only derived projections. */
export function markLegacyMemoryIncomplete(database,conversationId) {
  database.prepare("UPDATE conversations SET state_status='legacy_partial' WHERE id=?").run(conversationId);
  const state = database.prepare('SELECT baseline_json FROM conversation_memory_state WHERE conversation_id=?').get(conversationId);
  let previous;
  try { previous = JSON.parse(state?.baseline_json || '{}'); } catch { previous = state?.baseline_json; }
  const baseline = previous?.schemaUpgrade === '0034' ? previous : { previous, schemaUpgrade: '0034' };
  database.prepare("UPDATE conversation_memory_state SET baseline_kind='legacy_partial',baseline_json=?,summary_order=0,index_order=0 WHERE conversation_id=?")
    .run(JSON.stringify({ ...baseline, historicalMemoryIncomplete: true }),conversationId);
  database.prepare("UPDATE memory_summaries SET status='stale' WHERE conversation_id=?").run(conversationId);
  database.prepare("UPDATE memory_embedding_indexes SET status='stale' WHERE conversation_id=? AND status IN ('active','building')").run(conversationId);
}

/** Rebind both FTS projections to source rowids before installing rowid-based update/delete triggers. */
function rebuildMemorySearch(database) {
  for (const name of ['memory_events_fts_insert','memory_events_fts_update','memory_events_fts_delete','fts_memories_insert','fts_memories_update','fts_memories_delete']) {
    database.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
  database.exec(`
    DELETE FROM fts_memory_events;
    INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) SELECT rowid,id,user_id,conversation_id,content FROM memory_events;
    DELETE FROM fts_memories;
    INSERT INTO fts_memories(rowid,entity_id,user_id,conversation_id,subject,content) SELECT rowid,id,user_id,conversation_id,subject,content FROM conversation_memories;
    CREATE TRIGGER memory_events_fts_insert AFTER INSERT ON memory_events BEGIN
      INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
    END;
    CREATE TRIGGER memory_events_fts_update AFTER UPDATE OF content ON memory_events BEGIN
      DELETE FROM fts_memory_events WHERE rowid=OLD.rowid;
      INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
    END;
    CREATE TRIGGER memory_events_fts_delete AFTER DELETE ON memory_events BEGIN
      DELETE FROM fts_memory_events WHERE rowid=OLD.rowid;
    END;
    CREATE TRIGGER fts_memories_insert AFTER INSERT ON conversation_memories BEGIN
      INSERT INTO fts_memories(rowid,entity_id,user_id,conversation_id,subject,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.subject,NEW.content);
    END;
    CREATE TRIGGER fts_memories_update AFTER UPDATE OF subject,content,user_id,conversation_id ON conversation_memories
      WHEN OLD.subject IS NOT NEW.subject OR OLD.content IS NOT NEW.content OR OLD.user_id IS NOT NEW.user_id OR OLD.conversation_id IS NOT NEW.conversation_id BEGIN
      DELETE FROM fts_memories WHERE rowid=OLD.rowid;
      INSERT INTO fts_memories(rowid,entity_id,user_id,conversation_id,subject,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.subject,NEW.content);
    END;
    CREATE TRIGGER fts_memories_delete AFTER DELETE ON conversation_memories BEGIN
      DELETE FROM fts_memories WHERE rowid=OLD.rowid;
    END;
  `);
}
