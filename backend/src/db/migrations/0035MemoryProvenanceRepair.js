import { ensureLegacyMemoryQuarantine, markLegacyMemoryIncomplete } from './0034ConversationMemoryUpgrade.js';

/** Reconcile databases that recorded the first 0034 before its provenance safeguards were finalized. */
export function migrateMemoryProvenanceRepair(database) {
  if (database.prepare("SELECT value FROM _schema_meta WHERE key='memory_provenance_reconciled'").get()?.value === '2') return;
  const cutoff = database.prepare("SELECT applied_at FROM schema_migrations WHERE version='0034'").get()?.applied_at;
  if (!cutoff) throw new Error('Memory provenance repair requires recorded migration 0034');
  const metadata = [
    ['memory_entities','created_commit_id','created_at','AND created_order>0'],
    ['memory_entity_aliases','created_commit_id','created_at',''],
    ['memory_actor_knowledge','commit_id','created_at',''],
    ['memory_plot_threads','commit_id','updated_at','']
  ];
  database.exec('SAVEPOINT migration_0035_provenance');
  try {
    for (const state of database.prepare('SELECT * FROM conversation_memory_state').all()) {
      let baseline;
      try { baseline = JSON.parse(state.baseline_json); } catch { baseline = {}; }
      const oldHistory = database.prepare(`SELECT 1 FROM memory_commits WHERE user_id=? AND conversation_id=?
        AND created_at<=? AND revision>=0 LIMIT 1`).get(state.user_id,state.conversation_id,cutoff);
      if (baseline?.schemaUpgrade !== '0034' && !(state.core_commit_id === '' && oldHistory)) continue;
      const scope = [state.user_id,state.conversation_id,cutoff];
      const existingRecovery = database.prepare(`SELECT id FROM memory_commits WHERE user_id=? AND conversation_id=?
        AND idempotency_key='migration:0034:unproven-metadata'`).get(state.user_id,state.conversation_id);
      // A proven bound commit supplies its own time, even if the selected head has since advanced.
      database.prepare(`UPDATE memory_actor_knowledge SET learned_order=MAX(learned_order,
        COALESCE((SELECT narrative_order FROM memory_commits c WHERE c.id=memory_actor_knowledge.commit_id),0),
        COALESCE((SELECT narrative_order FROM memory_events e WHERE e.id=memory_actor_knowledge.learned_from_event_id),0))
        WHERE user_id=? AND conversation_id=? AND created_at<=? AND commit_id IS NOT NULL`).run(...scope);

      // NULL was a universal baseline in early schemas. With old commit history, its branch is unprovable.
      const unresolved = metadata.filter(([table,column,date,extra]) => database.prepare(`SELECT 1 FROM ${table}
        WHERE user_id=? AND conversation_id=? AND ${date}<=? AND ${column} IS NULL ${extra} LIMIT 1`).get(...scope));
      if ((oldHistory || existingRecovery) && unresolved.length) {
        const recovery = ensureLegacyMemoryQuarantine(database,state);
        for (const [table,column,date,extra] of unresolved) database.prepare(`UPDATE ${table} SET ${column}=? WHERE user_id=? AND conversation_id=? AND ${date}<=? AND ${column} IS NULL ${extra}`)
          .run(recovery,...scope);
      }
      markLegacyMemoryIncomplete(database,state.conversation_id);
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`Memory provenance repair foreign key check failed (${violations.length})`);
    database.prepare("INSERT OR REPLACE INTO _schema_meta(key,value) VALUES('memory_provenance_reconciled','2')").run();
    database.exec('RELEASE SAVEPOINT migration_0035_provenance');
  } catch (error) {
    database.exec('ROLLBACK TO SAVEPOINT migration_0035_provenance');
    database.exec('RELEASE SAVEPOINT migration_0035_provenance');
    throw error;
  }
}
