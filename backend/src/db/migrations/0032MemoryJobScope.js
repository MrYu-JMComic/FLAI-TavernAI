/** Separate durable task ownership from its scheduling key; backfill existing jobs. */
export function migrateMemoryJobScope(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(jobs)').all().map(row => row.name));
  for (const [name, definition] of Object.entries({
    conversation_id: "TEXT NOT NULL DEFAULT ''", source_timeline_revision: 'INTEGER NOT NULL DEFAULT 0',
    stage: "TEXT NOT NULL DEFAULT ''", index_generation: "TEXT NOT NULL DEFAULT ''"
  })) if (!columns.has(name)) database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
  database.exec(`UPDATE jobs SET
    conversation_id = COALESCE(json_extract(payload_json, '$.conversationId'), ''),
    source_timeline_revision = COALESCE(json_extract(payload_json, '$.timelineRevision'), 0),
    stage = CASE WHEN type IN ('conversation.postprocess','memory.extract') THEN 'core'
      WHEN type = 'memory.summarize' THEN 'summary' WHEN type = 'memory.index' THEN 'index' ELSE '' END;
    UPDATE jobs SET serial_key=json_array(user_id,conversation_id,stage) WHERE conversation_id<>'';
    CREATE INDEX IF NOT EXISTS idx_jobs_conversation_scope
      ON jobs(user_id,conversation_id,source_timeline_revision,stage,status);
    CREATE TRIGGER IF NOT EXISTS conversation_memory_jobs_delete AFTER DELETE ON conversations BEGIN
      DELETE FROM jobs WHERE user_id=old.user_id AND conversation_id=old.id;
    END;`);
}
