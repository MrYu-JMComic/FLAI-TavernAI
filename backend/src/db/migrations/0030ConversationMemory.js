import { createHash } from 'node:crypto';

/** Adds canonical story records; old text memories remain the editable review projection. */
export function migrateConversationMemory(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(conversation_memories)').all().map(row => row.name));
  if (!columns.has('lifecycle')) database.exec("ALTER TABLE conversation_memories ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'");
  if (!columns.has('visibility')) database.exec("ALTER TABLE conversation_memories ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
  if (!columns.has('truth_status')) database.exec("ALTER TABLE conversation_memories ADD COLUMN truth_status TEXT NOT NULL DEFAULT 'unverified'");
  if (!columns.has('actor_ids_json')) database.exec("ALTER TABLE conversation_memories ADD COLUMN actor_ids_json TEXT NOT NULL DEFAULT '[]'");
  database.exec(`
    UPDATE conversation_memories SET lifecycle = CASE
      WHEN merged_into_id IS NOT NULL THEN 'superseded'
      WHEN invalidated_at IS NOT NULL OR archived = 1 THEN 'rejected'
      WHEN enabled = 1 THEN 'active' ELSE 'candidate' END;
    CREATE TABLE IF NOT EXISTS conversation_memory_state (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0,
      core_message_id TEXT NOT NULL DEFAULT '', core_message_revision INTEGER NOT NULL DEFAULT 0,
      core_commit_id TEXT NOT NULL DEFAULT '',
      core_order INTEGER NOT NULL DEFAULT 0, summary_order INTEGER NOT NULL DEFAULT 0,
      index_order INTEGER NOT NULL DEFAULT 0, timeline_revision INTEGER NOT NULL DEFAULT 1,
      baseline_kind TEXT NOT NULL DEFAULT 'legacy', baseline_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, name TEXT NOT NULL, cast_key TEXT NOT NULL DEFAULT '',
      domain_kind TEXT NOT NULL DEFAULT '', domain_id TEXT NOT NULL DEFAULT '',
      created_commit_id TEXT,
      lifecycle TEXT NOT NULL DEFAULT 'active', created_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entity_aliases (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1,
      source_event_id TEXT NOT NULL DEFAULT '', created_order INTEGER NOT NULL DEFAULT 0,
      created_commit_id TEXT, created_at TEXT NOT NULL,
      UNIQUE(entity_id, normalized_alias, created_commit_id)
    );
    CREATE TABLE IF NOT EXISTS memory_source_versions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL, message_revision INTEGER NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, attachments_json TEXT NOT NULL DEFAULT '[]', content_hash TEXT NOT NULL,
      narrative_order INTEGER NOT NULL, recorded_at TEXT NOT NULL,
      UNIQUE(conversation_id, message_id, message_revision)
    );
    CREATE TABLE IF NOT EXISTS memory_commits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL, packet_hash TEXT NOT NULL, timeline_revision INTEGER NOT NULL,
      base_revision INTEGER NOT NULL, revision INTEGER NOT NULL, narrative_order INTEGER NOT NULL,
      message_id TEXT NOT NULL DEFAULT '', message_revision INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL, receipt_json TEXT NOT NULL, created_at TEXT NOT NULL,
      parent_commit_id TEXT REFERENCES memory_commits(id) ON DELETE SET NULL,
      UNIQUE(conversation_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      commit_id TEXT REFERENCES memory_commits(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL DEFAULT '', memory_revision INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL, subject_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      content TEXT NOT NULL, participants_json TEXT NOT NULL DEFAULT '[]',
      location_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      narrative_order INTEGER NOT NULL, narrative_time TEXT NOT NULL DEFAULT '',
      event_sequence INTEGER NOT NULL DEFAULT 0,
      lifecycle TEXT NOT NULL DEFAULT 'active', truth_status TEXT NOT NULL DEFAULT 'unverified',
      visibility TEXT NOT NULL DEFAULT 'public', actor_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 1, importance REAL NOT NULL DEFAULT 0,
      emotional_intensity REAL NOT NULL DEFAULT 0, layer TEXT NOT NULL DEFAULT 'history',
      supersedes_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
      source_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(conversation_id, memory_id, memory_revision)
    );
    CREATE TABLE IF NOT EXISTS memory_evidence (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      source_version_id TEXT REFERENCES memory_source_versions(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '', speaker_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      evidence_kind TEXT NOT NULL DEFAULT 'quote', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_claims (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      subject_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      predicate TEXT NOT NULL, object_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      value_json TEXT NOT NULL DEFAULT 'null', modality TEXT NOT NULL DEFAULT 'assertion',
      polarity INTEGER NOT NULL DEFAULT 1, truth_status TEXT NOT NULL DEFAULT 'unverified',
      valid_from INTEGER NOT NULL, valid_to INTEGER, recorded_at TEXT NOT NULL,
      supersedes_id TEXT REFERENCES memory_claims(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS memory_actor_knowledge (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      actor_entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      commit_id TEXT REFERENCES memory_commits(id) ON DELETE CASCADE,
      epistemic_state TEXT NOT NULL, learned_from_event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
      learned_order INTEGER NOT NULL, source_evidence_id TEXT REFERENCES memory_evidence(id) ON DELETE SET NULL,
      belief_content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_plot_threads (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      commit_id TEXT REFERENCES memory_commits(id) ON DELETE CASCADE,
      thread_key TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      owner_entity_id TEXT REFERENCES memory_entities(id) ON DELETE SET NULL,
      resolution_trigger TEXT NOT NULL DEFAULT '', resolved_event_id TEXT REFERENCES memory_events(id) ON DELETE SET NULL,
      created_order INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_domain_refs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
      domain TEXT NOT NULL, record_id TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '',
      outcome_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_summaries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      level TEXT NOT NULL CHECK(level IN ('scene','chapter','arc')),
      content TEXT NOT NULL, start_order INTEGER NOT NULL, end_order INTEGER NOT NULL,
      parent_id TEXT REFERENCES memory_summaries(id) ON DELETE SET NULL,
      source_hash TEXT NOT NULL, profile_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', visibility TEXT NOT NULL DEFAULT 'public',
      actor_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_summary_dependencies (
      summary_id TEXT NOT NULL REFERENCES memory_summaries(id) ON DELETE CASCADE,
      event_id TEXT REFERENCES memory_events(id) ON DELETE CASCADE,
      child_summary_id TEXT REFERENCES memory_summaries(id) ON DELETE CASCADE,
      source_hash TEXT NOT NULL, CHECK ((event_id IS NULL) <> (child_summary_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_scope ON memory_entities(user_id, conversation_id, lifecycle, name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_cast_key ON memory_entities(conversation_id,cast_key,created_commit_id) WHERE cast_key<>'';
    CREATE INDEX IF NOT EXISTS idx_memory_alias_lookup ON memory_entity_aliases(user_id, conversation_id, normalized_alias);
    CREATE INDEX IF NOT EXISTS idx_memory_events_scope ON memory_events(user_id, conversation_id, lifecycle, narrative_order);
    CREATE INDEX IF NOT EXISTS idx_memory_event_source ON memory_events(conversation_id, memory_id, memory_revision);
    CREATE INDEX IF NOT EXISTS idx_memory_event_supersedes ON memory_events(supersedes_id,narrative_order,lifecycle);
    CREATE INDEX IF NOT EXISTS idx_memory_event_order ON memory_events(user_id,conversation_id,narrative_order,event_sequence);
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_source ON memory_evidence(source_version_id, event_id);
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_event ON memory_evidence(event_id,source_version_id);
    CREATE INDEX IF NOT EXISTS idx_memory_claim_subject ON memory_claims(conversation_id, subject_entity_id, predicate, valid_from, valid_to);
    CREATE INDEX IF NOT EXISTS idx_memory_knowledge_actor ON memory_actor_knowledge(conversation_id, actor_entity_id, learned_order);
    CREATE INDEX IF NOT EXISTS idx_memory_threads_scope ON memory_plot_threads(user_id, conversation_id, status, created_order);
    CREATE INDEX IF NOT EXISTS idx_memory_summaries_scope ON memory_summaries(user_id, conversation_id, status, level, end_order);
    CREATE INDEX IF NOT EXISTS idx_memory_commits_scope ON memory_commits(conversation_id, revision, narrative_order);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_memory_events USING fts5(event_id UNINDEXED, user_id UNINDEXED, conversation_id UNINDEXED, content, tokenize='unicode61');
    DROP TRIGGER IF EXISTS memory_events_fts_insert;
    DROP TRIGGER IF EXISTS memory_events_fts_delete;
    DROP TRIGGER IF EXISTS memory_events_fts_update;
    CREATE TRIGGER IF NOT EXISTS memory_events_fts_insert AFTER INSERT ON memory_events BEGIN
      INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_events_fts_delete AFTER DELETE ON memory_events BEGIN
      DELETE FROM fts_memory_events WHERE rowid=OLD.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS memory_events_fts_update AFTER UPDATE OF content ON memory_events BEGIN
      DELETE FROM fts_memory_events WHERE rowid=OLD.rowid;
      INSERT INTO fts_memory_events(rowid,event_id,user_id,conversation_id,content) VALUES(NEW.rowid,NEW.id,NEW.user_id,NEW.conversation_id,NEW.content);
    END;
    DROP TRIGGER IF EXISTS fts_memories_insert;
    DROP TRIGGER IF EXISTS fts_memories_update;
    DROP TRIGGER IF EXISTS fts_memories_delete;
    DELETE FROM fts_memories;
    INSERT INTO fts_memories(rowid,entity_id,user_id,conversation_id,subject,content)
      SELECT rowid,id,user_id,conversation_id,subject,content FROM conversation_memories;
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
    CREATE TRIGGER IF NOT EXISTS memory_projection_lifecycle_insert AFTER INSERT ON conversation_memories BEGIN
      UPDATE conversation_memories SET lifecycle=CASE WHEN NEW.merged_into_id IS NOT NULL THEN 'superseded'
        WHEN NEW.invalidated_at IS NOT NULL OR NEW.archived=1 THEN 'rejected' WHEN NEW.enabled=1 THEN 'active' ELSE 'candidate' END WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS memory_projection_lifecycle_update AFTER UPDATE OF enabled,archived,invalidated_at,merged_into_id ON conversation_memories BEGIN
      UPDATE conversation_memories SET lifecycle=CASE WHEN NEW.merged_into_id IS NOT NULL THEN 'superseded'
        WHEN NEW.invalidated_at IS NOT NULL OR NEW.archived=1 THEN 'rejected' WHEN NEW.enabled=1 THEN 'active' ELSE 'candidate' END WHERE id=NEW.id;
    END;
    INSERT OR IGNORE INTO conversation_memory_state(conversation_id,user_id,timeline_revision,updated_at)
      SELECT id,user_id,timeline_revision,updated_at FROM conversations;
    INSERT INTO memory_events(id,user_id,conversation_id,memory_id,memory_revision,kind,content,narrative_order,lifecycle,truth_status,source_hash,created_at)
      SELECT 'legacy:'||id,user_id,conversation_id,id,revision,memory_type,content,0,lifecycle,'unverified','legacy:'||id||':'||revision,created_at FROM conversation_memories m WHERE NOT EXISTS(SELECT 1 FROM memory_events e WHERE e.memory_id=m.id AND e.conversation_id=m.conversation_id);
  `);
  // Preserve source versions for migrated records without inventing actors, truth, or unseen history.
  const sources=database.prepare(`SELECT DISTINCT messages.*, (SELECT COUNT(*) FROM messages prior WHERE prior.conversation_id=messages.conversation_id
    AND (prior.created_at<messages.created_at OR (prior.created_at=messages.created_at AND prior.rowid<=messages.rowid))) AS narrative_order
    FROM messages JOIN conversation_memories m ON m.source_message_id=messages.id AND m.conversation_id=messages.conversation_id AND m.user_id=messages.user_id`).all();
  const insertSource=database.prepare(`INSERT OR IGNORE INTO memory_source_versions(id,user_id,conversation_id,message_id,message_revision,role,content,attachments_json,content_hash,narrative_order,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for (const source of sources) {
    const id=`legacy-source:${source.id}:${source.revision}`;
    const canonical={attachments:JSON.parse(source.attachments_json||'[]'),content:source.content,role:source.role};
    insertSource.run(id,source.user_id,source.conversation_id,source.id,source.revision,source.role,source.content,source.attachments_json||'[]',createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),source.narrative_order,source.created_at);
    database.prepare(`UPDATE memory_events SET narrative_order=? WHERE memory_id IN(SELECT id FROM conversation_memories WHERE source_message_id=? AND conversation_id=?)`).run(source.narrative_order,source.id,source.conversation_id);
    const retained=database.prepare('SELECT id FROM memory_source_versions WHERE conversation_id=? AND message_id=? AND message_revision=?').get(source.conversation_id,source.id,source.revision);
    database.prepare(`INSERT OR IGNORE INTO memory_evidence(id,user_id,conversation_id,event_id,source_version_id,source_kind,quote,evidence_kind,created_at)
      SELECT 'legacy-evidence:'||m.id,m.user_id,m.conversation_id,e.id,?,'message',m.source_excerpt,'legacy',m.created_at FROM conversation_memories m JOIN memory_events e ON e.id='legacy:'||m.id WHERE m.source_message_id=? AND m.conversation_id=?`).run(retained.id,source.id,source.conversation_id);
  }
}
