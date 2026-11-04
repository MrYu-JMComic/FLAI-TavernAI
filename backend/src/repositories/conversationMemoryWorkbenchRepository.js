import { newId,nowIso } from '../security.js';

/** Join retained evidence to its message revision without exposing another conversation's records. */
export function listMemoryWorkbenchEvidence(database,userId,conversationId,eventId) {
  return database.prepare(`SELECT e.*,s.message_id,s.message_revision FROM memory_evidence e
    LEFT JOIN memory_source_versions s ON s.id=e.source_version_id WHERE e.event_id=? AND e.user_id=? AND e.conversation_id=?`)
    .all(eventId,userId,conversationId);
}

/** Domain receipts remain scoped by both owner and conversation, and are selected only for eligible events. */
export function listMemoryWorkbenchDomainRefs(database,userId,conversationId,eventIds) {
  const rows=[];
  for(let offset=0;offset<eventIds.length;offset+=400) {
    const ids=eventIds.slice(offset,offset+400);
    rows.push(...database.prepare(`SELECT * FROM memory_domain_refs WHERE user_id=? AND conversation_id=?
      AND event_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at,id`).all(userId,conversationId,...ids));
  }
  return rows;
}

/** Reads a scene item without granting ownership merely because a name matches a memory entity. */
export function readMemoryWorkbenchSceneItem(database,conversationId,id) {
  return database.prepare('SELECT * FROM scene_objects WHERE id=? AND conversation_id=?').get(id,conversationId)||null;
}

/** Look up a durable author receipt before validating a retry against its now-advanced revision. */
export function readMemoryWorkbenchCommit(database,userId,conversationId,idempotencyKey) {
  return database.prepare(`WITH RECURSIVE visible_commits(id) AS (
    SELECT core_commit_id FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND core_commit_id<>''
    UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT *,id IN (SELECT id FROM visible_commits) AS in_current_lineage FROM memory_commits
    WHERE user_id=? AND conversation_id=? AND idempotency_key=?`)
    .get(userId,conversationId,userId,conversationId,idempotencyKey)||null;
}

/** Preserve scheduled/expired propositions during a text-only revision without reviving superseded claims. */
export function listMemoryWorkbenchEventClaims(database,userId,conversationId,eventId,eligibleEventIds) {
  const superseded=new Set();
  for(let offset=0;offset<eligibleEventIds.length;offset+=400) {
    const ids=eligibleEventIds.slice(offset,offset+400);
    for(const row of database.prepare(`SELECT supersedes_id FROM memory_claims WHERE user_id=? AND conversation_id=?
      AND event_id IN (${ids.map(()=>'?').join(',')}) AND supersedes_id IS NOT NULL`).all(userId,conversationId,...ids))
      superseded.add(row.supersedes_id);
  }
  return database.prepare('SELECT * FROM memory_claims WHERE user_id=? AND conversation_id=? AND event_id=?')
    .all(userId,conversationId,eventId).filter(row=>!superseded.has(row.id)).map(row=>({...row,value:JSON.parse(row.value_json)}));
}

/** Append the same typed inheritance bundle used by canonical packets inside the legacy review's existing savepoint. */
export function appendMemoryWorkbenchAssociations(database,userId,conversationId,eventId,commitId,order,associations,evidenceId=null) {
  const timestamp=nowIso();
  for(const row of associations.claims) database.prepare(`INSERT INTO memory_claims
    (id,user_id,conversation_id,event_id,subject_entity_id,predicate,object_entity_id,value_json,modality,polarity,truth_status,valid_from,valid_to,recorded_at,supersedes_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(),userId,conversationId,eventId,row.subjectEntityId,row.predicate,row.objectEntityId,
    JSON.stringify(row.value),row.modality,row.polarity,row.truthStatus,row.validFrom,row.validTo,timestamp,row.supersedesId);
  for(const row of associations.knowledge) database.prepare(`INSERT INTO memory_actor_knowledge
    (id,user_id,conversation_id,actor_entity_id,event_id,commit_id,epistemic_state,learned_from_event_id,learned_order,source_evidence_id,belief_content,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(),userId,conversationId,row.actorEntityId,eventId,commitId,row.epistemicState,
    row.learnedFromEventId||eventId,Math.max(order,row.learnedOrder||0),evidenceId,row.beliefContent,timestamp);
  for(const row of associations.threads) database.prepare(`INSERT INTO memory_plot_threads
    (id,user_id,conversation_id,event_id,commit_id,thread_key,kind,title,status,owner_entity_id,resolution_trigger,resolved_event_id,created_order,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(),userId,conversationId,eventId,commitId,row.id,row.kind,row.title,row.status,row.ownerEntityId,
    row.resolutionTrigger,row.status==='resolved'?eventId:null,Math.max(order,row.createdOrder||0),timestamp);
  for(const row of associations.domainRefs) database.prepare(`INSERT INTO memory_domain_refs
    (id,user_id,conversation_id,event_id,domain,record_id,revision,outcome_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(newId(),userId,conversationId,eventId,row.domain,row.recordId,row.revision,JSON.stringify(row.outcome),timestamp);
}

