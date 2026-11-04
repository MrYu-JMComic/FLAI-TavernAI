/** Fixed canonical table catalogue shared by quota sizing and private diagnostics. */
export const MEMORY_STORAGE_TABLES = Object.freeze([
  'conversation_memory_state', 'memory_entities', 'memory_entity_aliases', 'memory_source_versions',
  'memory_commits', 'memory_events', 'memory_evidence', 'memory_claims', 'memory_actor_knowledge',
  'memory_plot_threads', 'memory_domain_refs', 'memory_summaries', 'memory_embedding_indexes',
  'memory_embedding_documents', 'memory_embedding_usage'
]);

/** Count source text in UTF-8 bytes and stored float32 vector payloads, scoped to their owner. */
export function sumMemoryStorageBytes(database, userId) {
  let bytes = 0;
  for (const table of MEMORY_STORAGE_TABLES) {
    if (!exists(database, table)) continue;
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    // This is logical payload storage, consistent with other domain quota counters.
    const expression = columns.map((column) => `LENGTH(CAST(COALESCE("${column.name}",'') AS BLOB))`).join('+');
    bytes += Number(database.prepare(`SELECT COALESCE(SUM(${expression}),0) AS bytes FROM ${table} WHERE user_id=?`).get(userId).bytes);
  }
  if (exists(database, 'memory_summary_dependencies')) {
    bytes += Number(database.prepare(`SELECT COALESCE(SUM(LENGTH(CAST(d.summary_id AS BLOB))+LENGTH(CAST(COALESCE(d.event_id,'') AS BLOB))
      +LENGTH(CAST(COALESCE(d.child_summary_id,'') AS BLOB))+LENGTH(CAST(d.source_hash AS BLOB))),0) AS bytes
      FROM memory_summary_dependencies d JOIN memory_summaries s ON s.id=d.summary_id WHERE s.user_id=?`).get(userId).bytes);
  }
  if (exists(database, 'memory_embedding_documents')) {
    // Persisting a document and its exact-dimension float32 vector is atomic.
    bytes += Number(database.prepare('SELECT COALESCE(SUM(dimensions*4),0) AS bytes FROM memory_embedding_documents WHERE user_id=?').get(userId).bytes);
  }
  return bytes;
}

export function countMemoryRecords(database, userId) {
  const result = {};
  for (const table of MEMORY_STORAGE_TABLES) {
    result[table] = exists(database, table)
      ? Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?`).get(userId).count) : 0;
  }
  result.memory_summary_dependencies = exists(database, 'memory_summary_dependencies')
    ? Number(database.prepare(`SELECT COUNT(*) AS count FROM memory_summary_dependencies d
      JOIN memory_summaries s ON s.id=d.summary_id WHERE s.user_id=?`).get(userId).count) : 0;
  return result;
}

/** Trace readers also support pre-memory diagnostic databases without claiming a revision. */
export function readMemoryRevision(database, userId, conversationId) {
  if (!exists(database, 'conversation_memory_state')) return 0;
  return Number(database.prepare('SELECT revision FROM conversation_memory_state WHERE conversation_id=? AND user_id=?')
    .get(conversationId, userId)?.revision || 0);
}

function exists(database, table) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
