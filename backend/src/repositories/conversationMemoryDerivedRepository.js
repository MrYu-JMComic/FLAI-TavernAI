import { iterateMemoryRecords } from './conversationMemoryRepository.js';
import { nowIso } from '../security.js';

/** Enumerate accepted source records through the canonical paged eligibility reader. */
export function enumerateMemoryRecords(database,userId,conversationId,options={}) {
  return [...iterateMemoryRecords(database,userId,conversationId,options)];
}

export function findReusableMemorySummary(database,userId,conversationId,{sourceHash,level,profileFingerprint}) {
  return database.prepare(`SELECT * FROM memory_summaries WHERE user_id=? AND conversation_id=? AND source_hash=? AND level=? AND profile_fingerprint=? AND status='active'`)
    .get(userId,conversationId,sourceHash,level,profileFingerprint)||null;
}

/** Persist a complete hierarchy inside the caller's guarded savepoint, including source and parent links. */
export function persistMemorySummaryGeneration(database,userId,conversationId,{items,records,profileFingerprint,throughOrder}) {
  for(const item of items) {
    database.prepare(`INSERT INTO memory_summaries(id,user_id,conversation_id,level,content,start_order,end_order,source_hash,profile_fingerprint,status,visibility,actor_ids_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'active',?,'[]',?)`).run(item.id,userId,conversationId,item.level,item.content,item.start,item.end,item.hash,
        profileFingerprint,item.visibility,nowIso());
    for(const id of item.eventIds) {
      const source=records.find(row=>row.id===id);
      database.prepare('INSERT INTO memory_summary_dependencies(summary_id,event_id,source_hash) VALUES(?,?,?)').run(item.id,id,source.source_hash);
    }
    for(const child of item.children)if(child.kind==='summary')database.prepare('UPDATE memory_summaries SET parent_id=? WHERE id=?').run(item.id,child.id);
  }
  database.prepare('UPDATE conversation_memory_state SET summary_order=? WHERE user_id=? AND conversation_id=?').run(throughOrder,userId,conversationId);
}

export function updateMemoryIndexWatermark(database,userId,conversationId,throughOrder) {
  database.prepare('UPDATE conversation_memory_state SET index_order=? WHERE user_id=? AND conversation_id=?').run(throughOrder,userId,conversationId);
}
