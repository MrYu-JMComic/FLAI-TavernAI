/** Add review-projection policy fields omitted by already-recorded early 0030 databases. */
export function migrateMemoryProjectionUpgrade(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(conversation_memories)').all().map(row => row.name));
  const fields = {
    visibility: { definition: "TEXT NOT NULL DEFAULT 'public'", fallback: "'public'" },
    truth_status: { definition: "TEXT NOT NULL DEFAULT 'unverified'", fallback: "'unverified'" },
    actor_ids_json: { definition: "TEXT NOT NULL DEFAULT '[]'", fallback: "'[]'" }
  };
  database.exec('SAVEPOINT migration_0036_memory_projection');
  try {
    for (const [name,field] of Object.entries(fields)) {
      if (columns.has(name)) continue;
      database.exec(`ALTER TABLE conversation_memories ADD COLUMN ${name} ${field.definition}`);
      // Only the selected canonical lineage can supply missing policy metadata. Existing fields and
      // all review IDs/content/lifecycle remain intact; unstructured legacy text keeps provisional defaults.
      database.exec(`WITH RECURSIVE visible_commits(user_id,conversation_id,id) AS (
          SELECT user_id,conversation_id,core_commit_id FROM conversation_memory_state WHERE core_commit_id<>''
          UNION SELECT v.user_id,v.conversation_id,c.parent_commit_id FROM visible_commits v JOIN memory_commits c
            ON c.id=v.id AND c.user_id=v.user_id AND c.conversation_id=v.conversation_id WHERE c.parent_commit_id IS NOT NULL)
        UPDATE conversation_memories SET ${name}=COALESCE((SELECT e.${name} FROM memory_events e
          LEFT JOIN memory_commits c ON c.id=e.commit_id WHERE e.user_id=conversation_memories.user_id
            AND e.conversation_id=conversation_memories.conversation_id AND e.memory_id=conversation_memories.id
            AND (e.commit_id IS NULL OR EXISTS(SELECT 1 FROM visible_commits v
              WHERE v.id=e.commit_id AND v.user_id=e.user_id AND v.conversation_id=e.conversation_id))
          ORDER BY COALESCE(c.revision,0) DESC,e.memory_revision DESC,e.event_sequence DESC,e.rowid DESC LIMIT 1),${field.fallback})`);
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`Memory projection upgrade foreign key check failed (${violations.length})`);
    database.exec('RELEASE SAVEPOINT migration_0036_memory_projection');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0036_memory_projection');
    database.exec('RELEASE SAVEPOINT migration_0036_memory_projection');
    throw error;
  }
}
