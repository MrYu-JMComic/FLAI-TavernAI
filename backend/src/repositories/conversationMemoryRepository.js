import { newId, nowIso } from '../security.js';
import { memoryHash, normalizeEntityAlias, MemoryRevisionError } from '../domain/conversationMemory/contracts.js';

export const MEMORY_TABLES = Object.freeze(['conversation_memory_state','memory_entities','memory_entity_aliases','memory_source_versions','memory_commits','memory_events','memory_evidence','memory_claims','memory_actor_knowledge','memory_plot_threads','memory_domain_refs','memory_summaries','memory_summary_dependencies']);

export function getMemoryState(database,userId,conversationId) {
  return database.prepare('SELECT * FROM conversation_memory_state WHERE user_id=? AND conversation_id=?').get(userId,conversationId) || null;
}

export function requireMemoryConversation(database,userId,conversationId) {
  const row=database.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(conversationId,userId);
  if (!row) throw new MemoryRevisionError('会话不存在或无权访问','MEMORY_CONVERSATION_UNAVAILABLE');
  return row;
}

/** Reads source order from the selected message history, rather than mutable rowid or wall-clock time. */
export function getMemoryMessage(database,userId,conversationId,messageId) {
  return database.prepare(`SELECT messages.*, (SELECT COUNT(*) FROM messages prior WHERE prior.conversation_id=messages.conversation_id
    AND (prior.created_at<messages.created_at OR (prior.created_at=messages.created_at AND prior.rowid<=messages.rowid))) AS narrative_order
    FROM messages WHERE id=? AND user_id=? AND conversation_id=?`).get(messageId,userId,conversationId) || null;
}

/**
 * Find the first unfinished predecessor before anchor using jobs from timelineRevision.
 * state selects the accepted lineage; bootstrap/manual commits alone never cover orphan turn flags.
 */
export function findMemoryCoreGap(database,userId,conversationId,anchor,state,timelineRevision) {
  return database.prepare(`WITH RECURSIVE coverage AS (
      SELECT id,parent_commit_id,kind,narrative_order FROM memory_commits
        WHERE id=? AND user_id=? AND conversation_id=?
      UNION
      SELECT parent.id,parent.parent_commit_id,parent.kind,parent.narrative_order
        FROM memory_commits parent JOIN coverage child ON parent.id=child.parent_commit_id
        WHERE child.kind NOT IN ('turn','adopted_baseline') AND parent.user_id=? AND parent.conversation_id=?
    ), ordered AS (
      SELECT id,role,revision,postprocess_state,ROW_NUMBER() OVER(ORDER BY created_at,rowid) AS narrative_order
        FROM messages WHERE user_id=? AND conversation_id=?
    ), current_jobs AS (
      SELECT source.id AS message_id,
        CASE WHEN job.status IN ('queued','running') OR (job.status IN ('failed','cancelled')
          AND (COALESCE(json_type(job.payload_json,'$.requiredStages'),'')<>'array'
            OR json_array_length(job.payload_json,'$.requiredStages')>0)) THEN 1 ELSE 0 END AS blocked
        FROM jobs job JOIN messages source ON source.id=json_extract(job.payload_json,'$.assistantMessageId')
          AND source.revision=json_extract(job.payload_json,'$.assistantRevision')
          AND source.user_id=job.user_id AND source.conversation_id=job.conversation_id
        WHERE job.user_id=? AND job.conversation_id=? AND job.source_timeline_revision=? AND job.stage='core'
    )
    SELECT message.id,message.narrative_order FROM ordered message
      WHERE message.role='assistant' AND message.narrative_order<? AND (
        message.id IN (SELECT message_id FROM current_jobs WHERE blocked=1)
        OR (message.id NOT IN (SELECT message_id FROM current_jobs) AND message.postprocess_state IN ('queued','pending','running','failed')
          AND message.narrative_order>(SELECT COALESCE(MAX(MIN(narrative_order,?)),0) FROM coverage
            WHERE kind IN ('turn','adopted_baseline'))))
      ORDER BY message.narrative_order LIMIT 1`)
    .get(state.core_commit_id||'',userId,conversationId,userId,conversationId,userId,conversationId,
      userId,conversationId,timelineRevision,anchor.narrative_order,state.core_order)||null;
}

export function ensureMemoryStateRow(database,userId,conversationId,kind='legacy',baseline={}) {
  const conversation=requireMemoryConversation(database,userId,conversationId);
  database.prepare(`INSERT OR IGNORE INTO conversation_memory_state(conversation_id,user_id,timeline_revision,baseline_kind,baseline_json,updated_at)
    VALUES(?,?,?,?,?,?)`).run(conversationId,userId,conversation.timeline_revision,kind,JSON.stringify(baseline),nowIso());
  return getMemoryState(database,userId,conversationId);
}

export function retainMemorySource(database,userId,conversationId,message) {
  const hash=memoryHash({role:message.role,content:message.content,attachments:JSON.parse(message.attachments_json||'[]')});
  const existing=database.prepare('SELECT * FROM memory_source_versions WHERE conversation_id=? AND message_id=? AND message_revision=?').get(conversationId,message.id,message.revision);
  if (existing) {
    if (existing.content_hash!==hash) throw new MemoryRevisionError('同一来源版本的内容不一致');
    return existing;
  }
  const id=newId();
  database.prepare(`INSERT INTO memory_source_versions(id,user_id,conversation_id,message_id,message_revision,role,content,attachments_json,content_hash,narrative_order,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,userId,conversationId,message.id,message.revision,message.role,message.content,message.attachments_json||'[]',hash,message.narrative_order,nowIso());
  return database.prepare('SELECT * FROM memory_source_versions WHERE id=?').get(id);
}

/** Resolves IDs or visible names/aliases; a collision stays unresolved, or fails a strict write request. */
export function resolveMemoryEntity(database,userId,conversationId,reference,options={}) {
  if (!reference) return null;
  const visible=listMemoryEntities(database,userId,conversationId,options);
  const direct=visible.find(entity=>entity.id===reference);
  if (direct) return direct;
  const normalized=normalizeEntityAlias(reference);
  const eligible=visible.filter(entity=>[entity.name,...entity.aliases].some(alias=>normalizeEntityAlias(alias)===normalized));
  if (eligible.length>1&&options.rejectAmbiguous) throw new MemoryRevisionError(`实体引用未解析或有歧义：${reference}`,'MEMORY_ENTITY_UNRESOLVED');
  return eligible.length===1 ? eligible[0] : null;
}

export function insertMemoryEntity(database,userId,conversationId,entity,order=0,commitId=null) {
  const id=entity.id||newId(); const timestamp=nowIso();
  database.prepare(`INSERT INTO memory_entities(id,user_id,conversation_id,kind,name,cast_key,created_order,created_commit_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id,userId,conversationId,entity.kind,entity.name,entity.castKey||'',order,commitId,timestamp,timestamp);
  appendMemoryEntityAliases(database,userId,conversationId,id,[entity.name,...(entity.aliases||[])],{order,commitId});
  return database.prepare('SELECT * FROM memory_entities WHERE id=?').get(id);
}

/** Appends newly learned aliases without exposing them to an earlier commit or discarded branch. */
export function appendMemoryEntityAliases(database,userId,conversationId,entityId,aliases,{order=0,commitId=null}={}) {
  const entity=listMemoryEntities(database,userId,conversationId,{asOfOrder:order,commitId}).find(row=>row.id===entityId);
  if (!entity) throw new MemoryRevisionError('实体不属于当前记忆提交');
  const known=new Set(entity.aliases.map(normalizeEntityAlias));
  for (const alias of aliases) {
    const normalized=normalizeEntityAlias(alias);
    if (!normalized||known.has(normalized)) continue;
    database.prepare(`INSERT OR IGNORE INTO memory_entity_aliases(id,user_id,conversation_id,entity_id,alias,normalized_alias,created_order,created_commit_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(newId(),userId,conversationId,entityId,String(alias).trim(),normalized,order,commitId,nowIso());
    known.add(normalized);
  }
}

export function insertMemoryEvent(database,userId,conversationId,event,commitId,order) {
  const id=event.id||newId(); const timestamp=nowIso();
  const sequence=database.prepare('SELECT COALESCE(MAX(event_sequence),0)+1 AS sequence FROM memory_events WHERE user_id=? AND conversation_id=? AND narrative_order=?').get(userId,conversationId,order).sequence;
  database.prepare(`INSERT INTO memory_events(id,user_id,conversation_id,commit_id,memory_id,memory_revision,kind,subject_entity_id,content,participants_json,location_entity_id,narrative_order,narrative_time,lifecycle,truth_status,visibility,actor_ids_json,confidence,importance,emotional_intensity,layer,supersedes_id,source_hash,created_at,event_sequence)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,userId,conversationId,commitId||null,event.memoryId||id,event.memoryRevision||1,event.kind,event.subjectEntityId||null,event.content,JSON.stringify(event.participants||[]),event.locationEntityId||null,order,event.narrativeTime||'',event.lifecycle||'active',event.truthStatus||'unverified',event.visibility||'public',JSON.stringify(event.actorIds||[]),event.confidence??1,event.importance||0,event.emotionalIntensity||0,event.layer||'history',event.supersedesId||null,memoryHash(event),timestamp,sequence);
  return database.prepare('SELECT * FROM memory_events WHERE id=?').get(id);
}

export function getCurrentMemoryEvent(database,userId,conversationId,memoryId) {
  return database.prepare(`WITH RECURSIVE visible_commits(id) AS (
      SELECT core_commit_id FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND core_commit_id<>''
      UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT e.* FROM memory_events e LEFT JOIN memory_commits c ON c.id=e.commit_id WHERE e.user_id=? AND e.conversation_id=? AND e.memory_id=?
      AND (e.commit_id IS NULL OR e.commit_id IN(SELECT id FROM visible_commits)) ORDER BY COALESCE(c.revision,0) DESC,e.memory_revision DESC LIMIT 1`)
    .get(userId,conversationId,userId,conversationId,memoryId)||null;
}

export function insertMemoryEvidence(database,userId,conversationId,eventId,source,quote='',kind='quote') {
  const id=newId();
  database.prepare(`INSERT INTO memory_evidence(id,user_id,conversation_id,event_id,source_version_id,source_kind,quote,evidence_kind,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(id,userId,conversationId,eventId,source?.id||null,source?'message':'author',quote,kind,nowIso());
  return id;
}

/** Materializes a new structured event for the existing review UI; the canonical event remains its provenance. */
export function insertMemoryReviewProjection(database,userId,conversationId,event,source=null,quote='') {
  const subject=event.subject_entity_id?database.prepare('SELECT name FROM memory_entities WHERE id=?').get(event.subject_entity_id)?.name||'':'';
  database.prepare(`INSERT OR IGNORE INTO conversation_memories(id,user_id,conversation_id,memory_type,subject,content,confidence,source_message_id,source_kind,source_excerpt,enabled,archived,pinned,revision,invalidated_at,created_at,updated_at,layer,importance,emotional_intensity,visibility,truth_status,actor_ids_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(event.memory_id,userId,conversationId,['event','relationship','location','preference','fact','summary','intent','hypothesis'].includes(event.kind)?event.kind:'event',subject,event.content,event.confidence,source?.message_id||'',source?'auto':'manual',quote,event.lifecycle==='active'?1:0,event.lifecycle==='rejected'?1:0,event.layer==='canon'?1:0,event.memory_revision,event.lifecycle==='rejected'?nowIso():null,event.created_at,event.created_at,event.layer,event.importance,event.emotional_intensity,event.visibility,event.truth_status,event.actor_ids_json);
}

/** Canonical eligibility is shared by structured, FTS and vector candidate filters. */
export function listMemoryRecords(database,userId,conversationId,options={}) {
  requireMemoryConversation(database,userId,conversationId);
  assertMemoryReadCommit(database,userId,conversationId,options.commitId);
  const asOf=Number.isFinite(Number(options.asOfOrder)) ? Number(options.asOfOrder) : Number.MAX_SAFE_INTEGER;
  const limit=Math.max(1,Math.min(10000,Number(options.limit)||1000));
  const ids=Array.isArray(options.ids)?[...new Set(options.ids.filter(id=>typeof id==='string'))].slice(0,500):null;
  if (ids&&!ids.length) return [];
  const idSql=ids?` AND e.id IN (${ids.map(()=>'?').join(',')})`:'';
  const records=database.prepare(`WITH RECURSIVE visible_commits(id) AS (
      SELECT COALESCE(?,core_commit_id) FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND COALESCE(?,core_commit_id)<>''
      UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT e.* FROM memory_events e WHERE e.user_id=? AND e.conversation_id=? AND e.narrative_order<=?
    AND (e.commit_id IS NULL OR e.commit_id IN (SELECT id FROM visible_commits))
    AND (e.lifecycle='active' OR (?=1 AND e.lifecycle='candidate') OR (?=1))
    AND NOT EXISTS (SELECT 1 FROM memory_events newer WHERE newer.supersedes_id=e.id AND newer.narrative_order<=? AND newer.lifecycle IN ('active','rejected','superseded')
      AND (newer.commit_id IS NULL OR newer.commit_id IN (SELECT id FROM visible_commits)))
    AND (?='' OR e.layer=?)
    AND NOT EXISTS (SELECT 1 FROM memory_evidence evidence JOIN memory_source_versions source ON source.id=evidence.source_version_id
      LEFT JOIN messages live ON live.id=source.message_id AND live.conversation_id=source.conversation_id
      WHERE evidence.event_id=e.id AND (live.id IS NULL OR live.revision<>source.message_revision))
    AND (?='' OR (e.visibility<>'author' AND ((e.visibility='public' AND e.truth_status<>'false') OR EXISTS(SELECT 1 FROM memory_actor_knowledge k
      WHERE k.event_id=e.id AND k.actor_entity_id=? AND k.learned_order<=? AND k.epistemic_state<>'unknown'
      AND (k.commit_id IS NULL OR k.commit_id IN(SELECT id FROM visible_commits)))
      OR (e.visibility='restricted' AND EXISTS(SELECT 1 FROM json_each(e.actor_ids_json) WHERE value=?)))))${idSql}
    ORDER BY e.narrative_order DESC,e.event_sequence DESC,e.id LIMIT ?`).all(options.commitId??null,userId,conversationId,options.commitId??null,userId,conversationId,asOf,options.includeCandidates?1:0,options.includeAllLifecycle?1:0,asOf,options.layer||'',options.layer||'',options.actorId||'',options.actorId||'',asOf,options.actorId||'',...(ids||[]),limit);
  return records.map(row=>{
    const knowledge=options.actorId?database.prepare(`WITH RECURSIVE visible_commits(id) AS (
      SELECT COALESCE(?,core_commit_id) FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND COALESCE(?,core_commit_id)<>''
      UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
      SELECT k.* FROM memory_actor_knowledge k LEFT JOIN memory_commits c ON c.id=k.commit_id WHERE k.event_id=? AND k.actor_entity_id=? AND k.learned_order<=?
        AND (k.commit_id IS NULL OR k.commit_id IN(SELECT id FROM visible_commits)) ORDER BY COALESCE(c.revision,0) DESC,k.learned_order DESC LIMIT 1`).get(options.commitId??null,userId,conversationId,options.commitId??null,row.id,options.actorId,asOf):null;
    return {...row,content:knowledge?.epistemic_state==='false_belief'?knowledge.belief_content:row.content,
      truth_status:knowledge?.epistemic_state==='false_belief'?'false':['believes','suspects'].includes(knowledge?.epistemic_state)?'unverified':row.truth_status,
      participants:JSON.parse(row.participants_json),actorIds:JSON.parse(row.actor_ids_json),epistemicState:options.actorId?knowledge?.epistemic_state||'public':null};
  }).filter(row=>!options.actorId||row.visibility==='public'||row.epistemicState!=='unknown');
}

/** Page canonical IDs before applying shared eligibility so restore never truncates a long event log. */
export function* iterateMemoryRecords(database,userId,conversationId,options={}) {
  let cursor='';
  for (;;) {
    const rows=database.prepare('SELECT id FROM memory_events WHERE user_id=? AND conversation_id=? AND id>? ORDER BY id LIMIT 500').all(userId,conversationId,cursor);
    if (!rows.length) break;
    for (const record of listMemoryRecords(database,userId,conversationId,{...options,ids:rows.map(row=>row.id),limit:500})) yield record;
    cursor=rows.at(-1).id;
  }
}

/** Returns entities and only aliases introduced in the selected lineage before its narrative cutoff. */
export function listMemoryEntities(database,userId,conversationId,options={}) {
  assertMemoryReadCommit(database,userId,conversationId,options.commitId);
  const asOf=Number.isFinite(Number(options.asOfOrder))?Number(options.asOfOrder):Number.MAX_SAFE_INTEGER;
  return database.prepare(`WITH RECURSIVE visible_commits(id) AS (
      SELECT COALESCE(?,core_commit_id) FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND COALESCE(?,core_commit_id)<>''
      UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT e.*,json_group_array(DISTINCT a.alias) FILTER(WHERE a.id IS NOT NULL) AS aliases_json
      FROM memory_entities e LEFT JOIN memory_entity_aliases a ON a.entity_id=e.id AND a.user_id=e.user_id AND a.conversation_id=e.conversation_id
        AND a.created_order<=? AND (a.created_commit_id IS NULL OR a.created_commit_id IN(SELECT id FROM visible_commits))
      WHERE e.user_id=? AND e.conversation_id=? AND e.lifecycle='active' AND e.created_order<=?
      AND (e.created_commit_id IS NULL OR e.created_commit_id IN(SELECT id FROM visible_commits)) GROUP BY e.id ORDER BY e.created_order,e.name`)
    .all(options.commitId??null,userId,conversationId,options.commitId??null,asOf,userId,conversationId,asOf)
    .map(({aliases_json,...entity})=>({...entity,aliases:JSON.parse(aliases_json)}));
}

/** Reads knowledge revisions only from the selected commit lineage and narrative cutoff. */
export function listCurrentMemoryKnowledge(database,userId,conversationId,options={}) {
  assertMemoryReadCommit(database,userId,conversationId,options.commitId);
  const asOf=Number.isFinite(Number(options.asOfOrder))?Number(options.asOfOrder):Number.MAX_SAFE_INTEGER;
  const rows=database.prepare(`WITH RECURSIVE visible_commits(id) AS (
    SELECT COALESCE(?,core_commit_id) FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND COALESCE(?,core_commit_id)<>''
    UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT k.* FROM memory_actor_knowledge k LEFT JOIN memory_commits c ON c.id=k.commit_id WHERE k.user_id=? AND k.conversation_id=?
    AND k.learned_order<=? AND (?='' OR k.actor_entity_id=?) AND (k.commit_id IS NULL OR k.commit_id IN(SELECT id FROM visible_commits))
    ORDER BY COALESCE(c.revision,0) DESC,k.learned_order DESC,k.created_at DESC`).all(options.commitId??null,userId,conversationId,options.commitId??null,userId,conversationId,asOf,options.actorId||'',options.actorId||'');
  const seen=new Set();
  return rows.filter(row=>{const key=`${row.actor_entity_id}:${row.event_id}`;if(seen.has(key))return false;seen.add(key);return true;});
}

/** Plot-thread status changes append revisions; a rewind selects the status from its own lineage. */
export function listCurrentMemoryThreads(database,userId,conversationId,options={}) {
  assertMemoryReadCommit(database,userId,conversationId,options.commitId);
  const asOf=Number.isFinite(Number(options.asOfOrder))?Number(options.asOfOrder):Number.MAX_SAFE_INTEGER;
  const rows=database.prepare(`WITH RECURSIVE visible_commits(id) AS (
    SELECT COALESCE(?,core_commit_id) FROM conversation_memory_state WHERE user_id=? AND conversation_id=? AND COALESCE(?,core_commit_id)<>''
    UNION SELECT c.parent_commit_id FROM memory_commits c JOIN visible_commits v ON c.id=v.id WHERE c.parent_commit_id IS NOT NULL)
    SELECT t.* FROM memory_plot_threads t LEFT JOIN memory_commits c ON c.id=t.commit_id WHERE t.user_id=? AND t.conversation_id=?
    AND t.created_order<=? AND (t.commit_id IS NULL OR t.commit_id IN(SELECT id FROM visible_commits))
    ORDER BY COALESCE(c.revision,0) DESC,t.created_order DESC,t.updated_at DESC`).all(options.commitId??null,userId,conversationId,options.commitId??null,userId,conversationId,asOf);
  const seen=new Set();return rows.filter(row=>{const key=row.thread_key||row.id;if(seen.has(key))return false;seen.add(key);return true;});
}

/** Current temporal propositions default to the selected message count; beliefs never expose their underlying truth value. */
export function listCurrentMemoryClaims(database,userId,conversationId,options={}) {
  const asOf=Number.isFinite(Number(options.asOfOrder))?Number(options.asOfOrder)
    :database.prepare('SELECT COUNT(*) AS n FROM messages WHERE user_id=? AND conversation_id=?').get(userId,conversationId).n;
  const events=new Map([...iterateMemoryRecords(database,userId,conversationId,{...options,asOfOrder:asOf})].map(event=>[event.id,event]));
  const rows=database.prepare(`SELECT * FROM memory_claims WHERE user_id=? AND conversation_id=? AND valid_from<=?
    AND (?='' OR subject_entity_id=?) AND (?='' OR predicate=?) ORDER BY valid_from DESC,recorded_at DESC,id`).all(userId,conversationId,asOf,options.subjectEntityId||'',options.subjectEntityId||'',options.predicate||'',options.predicate||'')
    .filter(row=>events.has(row.event_id)&&!['false_belief','believes','suspects','unknown'].includes(events.get(row.event_id).epistemicState));
  const superseded=new Set(rows.map(row=>row.supersedes_id).filter(Boolean));
  return rows.filter(row=>!superseded.has(row.id)&&(row.valid_to===null||row.valid_to>asOf)).map(row=>({...row,value:JSON.parse(row.value_json)}));
}

/** Full portability snapshot. Per-turn checkpoints must use the state receipt instead. */
export function captureMemorySnapshot(database,userId,conversationId) {
  requireMemoryConversation(database,userId,conversationId);
  return Object.fromEntries(MEMORY_TABLES.map(table=>[table,table==='memory_summary_dependencies'
    ? database.prepare(`SELECT d.* FROM memory_summary_dependencies d JOIN memory_summaries s ON s.id=d.summary_id WHERE s.user_id=? AND s.conversation_id=?`).all(userId,conversationId)
    : database.prepare(`SELECT * FROM ${table} WHERE user_id=? AND conversation_id=?`).all(userId,conversationId)]));
}

/** Copies only the selected immutable commit ancestry and its referenced source/entity closure for a branch. */
export function captureMemoryPrefix(database,userId,conversationId,checkpoint={}) {
  const snapshot=captureMemorySnapshot(database,userId,conversationId);
  const commits=new Map(snapshot.memory_commits.map(row=>[row.id,row]));
  const visible=new Set(); let current=checkpoint.commitId||'';
  while (current) {
    if (visible.has(current)) throw new MemoryRevisionError('记忆提交链存在循环');
    const commit=commits.get(current);
    if (!commit) throw new MemoryRevisionError('检查点日志已经缺失','MEMORY_CHECKPOINT_MISSING');
    visible.add(current); current=commit.parent_commit_id||'';
  }
  const order=Math.max(0,Number(checkpoint.viewOrder??checkpoint.coreOrder)||0);
  snapshot.memory_commits=snapshot.memory_commits.filter(row=>visible.has(row.id));
  snapshot.memory_events=snapshot.memory_events.filter(row=>(!row.commit_id||visible.has(row.commit_id))&&row.narrative_order<=order);
  const eventIds=new Set(snapshot.memory_events.map(row=>row.id));
  for (const event of snapshot.memory_events) if (event.supersedes_id&&!eventIds.has(event.supersedes_id)) event.supersedes_id=null;
  for (const table of ['memory_evidence','memory_claims','memory_actor_knowledge','memory_plot_threads','memory_domain_refs']) snapshot[table]=snapshot[table].filter(row=>eventIds.has(row.event_id));
  for (const table of ['memory_actor_knowledge','memory_plot_threads']) snapshot[table]=snapshot[table].filter(row=>!row.commit_id||visible.has(row.commit_id));
  for (const row of snapshot.memory_actor_knowledge) if (row.learned_from_event_id&&!eventIds.has(row.learned_from_event_id)) row.learned_from_event_id=null;
  for (const row of snapshot.memory_plot_threads) if (row.resolved_event_id&&!eventIds.has(row.resolved_event_id)) { row.resolved_event_id=null;row.status='open'; }
  const sourceIds=new Set(snapshot.memory_evidence.map(row=>row.source_version_id).filter(Boolean));
  snapshot.memory_source_versions=snapshot.memory_source_versions.filter(row=>sourceIds.has(row.id));
  const entityIds=new Set();
  const entityColumns=['subject_entity_id','location_entity_id','speaker_entity_id','object_entity_id','actor_entity_id','owner_entity_id'];
  for (const table of ['memory_events','memory_evidence','memory_claims','memory_actor_knowledge','memory_plot_threads']) for (const row of snapshot[table]) {
    for (const key of entityColumns) if (row[key]) entityIds.add(row[key]);
    for (const key of ['participants_json','actor_ids_json']) if (row[key]) for (const id of JSON.parse(row[key])) entityIds.add(id);
  }
  // Bootstrap cast is part of canon even before its first event; future cast remains excluded.
  snapshot.memory_entities=snapshot.memory_entities.filter(row=>entityIds.has(row.id)||(!row.created_commit_id&&row.created_order===0)||(visible.has(row.created_commit_id)&&row.created_order<=order));
  const keptEntities=new Set(snapshot.memory_entities.map(row=>row.id));
  snapshot.memory_entity_aliases=snapshot.memory_entity_aliases.filter(row=>keptEntities.has(row.entity_id)
    &&row.created_order<=order&&(!row.created_commit_id||visible.has(row.created_commit_id)));
  for (const row of snapshot.memory_entity_aliases) if (row.source_event_id&&!eventIds.has(row.source_event_id)) row.source_event_id='';
  const claims=new Set(snapshot.memory_claims.map(row=>row.id));
  for (const row of snapshot.memory_claims) if (row.supersedes_id&&!claims.has(row.supersedes_id)) row.supersedes_id=null;
  snapshot.memory_summaries=[];snapshot.memory_summary_dependencies=[];
  snapshot.conversation_memory_state=snapshot.conversation_memory_state.map(row=>({...row,core_order:checkpoint.coreOrder||0,core_message_id:checkpoint.coreMessageId||'',core_message_revision:checkpoint.coreMessageRevision||0,core_commit_id:checkpoint.commitId||'',summary_order:0,index_order:0}));
  return snapshot;
}

/** Restores owner-scoped canonical records; vectors are deliberately excluded and rebuilt independently. */
export function restoreMemorySnapshot(database,userId,conversationId,snapshot,{idMap=null}={}) {
  requireMemoryConversation(database,userId,conversationId);
  const remap=value=>idMap instanceof Map ? idMap.get(value)||value : idMap?.[value]||value;
  const sourceConversation=MEMORY_TABLES.flatMap(table=>snapshot?.[table]||[]).find(row=>row.conversation_id)?.conversation_id;
  for (const table of MEMORY_TABLES) {
    if (snapshot?.[table]!==undefined&&!Array.isArray(snapshot[table])) throw new MemoryRevisionError('记忆存档表格式无效','SNAPSHOT_INVALID');
    const allowed=new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
    for (const row of snapshot?.[table]||[]) {
      if ((row.user_id&&row.user_id!==userId)||(row.conversation_id&&row.conversation_id!==sourceConversation)) throw new MemoryRevisionError('记忆存档混入其他用户或会话','SNAPSHOT_SCOPE_INVALID');
      if (Object.keys(row).some(key=>!allowed.has(key))) throw new MemoryRevisionError('记忆存档字段无效','SNAPSHOT_INVALID');
    }
  }
  const referenceColumns=new Set(['id','entity_id','source_event_id','commit_id','created_commit_id','parent_commit_id','core_commit_id','memory_id','message_id','core_message_id','subject_entity_id','location_entity_id','supersedes_id','event_id','source_version_id','speaker_entity_id','object_entity_id','actor_entity_id','learned_from_event_id','source_evidence_id','owner_entity_id','resolved_event_id','thread_key','parent_id','summary_id','child_summary_id']);
  for (const table of [...MEMORY_TABLES].reverse()) {
    if (table==='memory_summary_dependencies') database.prepare('DELETE FROM memory_summary_dependencies WHERE summary_id IN (SELECT id FROM memory_summaries WHERE user_id=? AND conversation_id=?)').run(userId,conversationId);
    else database.prepare(`DELETE FROM ${table} WHERE user_id=? AND conversation_id=?`).run(userId,conversationId);
  }
  database.exec('PRAGMA defer_foreign_keys=ON');
  for (const table of MEMORY_TABLES) for (const original of snapshot?.[table]||[]) {
    const row={...original};
    for (const key of Object.keys(row)) if (referenceColumns.has(key)&&typeof row[key]==='string') row[key]=remap(row[key]);
    if ('user_id' in row) row.user_id=userId;
    if ('conversation_id' in row) row.conversation_id=conversationId;
    for (const key of ['participants_json','actor_ids_json']) if (row[key]) row[key]=JSON.stringify(JSON.parse(row[key]).map(remap));
    // Domain record identifiers are typed references; arbitrary outcome/provider identifiers remain unchanged.
    if (table==='memory_domain_refs'&&['scene_object','scene_item'].includes(row.domain)) row.record_id=remap(row.record_id);
    if (table==='memory_commits') row.receipt_json=JSON.stringify(remapMemoryReferences(JSON.parse(row.receipt_json),remap));
    if (table==='memory_events') row.source_hash=memoryHash({...row,source_hash:undefined});
    const columns=Object.keys(row);
    database.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(key=>row[key]));
  }
  database.prepare("UPDATE memory_summaries SET status='stale' WHERE user_id=? AND conversation_id=?").run(userId,conversationId);
  database.prepare('UPDATE conversation_memory_state SET index_order=0 WHERE user_id=? AND conversation_id=?').run(userId,conversationId);
  if (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding_indexes'").get()) {
    database.prepare("UPDATE memory_embedding_indexes SET status='stale' WHERE user_id=? AND conversation_id=? AND status IN ('active','building')").run(userId,conversationId);
  }
}

function remapMemoryReferences(value,remap) {
  if (Array.isArray(value)) return value.map(item=>remapMemoryReferences(item,remap));
  if (!value||typeof value!=='object') return value;
  const keys=new Set(['id','eventId','entityId','memoryId','sourceVersionId','commitId','messageId','actorId','subjectEntityId','objectEntityId','sourceMessageId','targetId']);
  const arrayKeys=new Set(['actorIds','participants','eventIds','sourceIds','memoryIds']);
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,(keys.has(key)||(key==='recordId'&&['scene_object','scene_item'].includes(value.domain)))&&typeof item==='string'?remap(item):arrayKeys.has(key)&&Array.isArray(item)?item.map(ref=>typeof ref==='string'?remap(ref):remapMemoryReferences(ref,remap)):remapMemoryReferences(item,remap)]));
}

function assertMemoryReadCommit(database,userId,conversationId,commitId) {
  if (commitId!==undefined&&commitId!==null&&commitId!==''&&!database.prepare('SELECT id FROM memory_commits WHERE id=? AND user_id=? AND conversation_id=?').get(commitId,userId,conversationId))
    throw new MemoryRevisionError('历史记忆提交不属于当前会话','MEMORY_CUTOFF_INVALID');
}
