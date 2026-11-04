import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { memoryHash, normalizeMemoryPacket, MemoryRevisionError, MEMORY_EPISTEMIC_STATES, MEMORY_TRUTH_STATES, text, oneOf } from '../../domain/conversationMemory/contracts.js';
import { ensureMemoryStateRow, getMemoryState, requireMemoryConversation, getMemoryMessage, findMemoryCoreGap, retainMemorySource, resolveMemoryEntity, insertMemoryEntity, appendMemoryEntityAliases, listMemoryEntities, insertMemoryEvent, insertMemoryEvidence, listMemoryRecords, getCurrentMemoryEvent, insertMemoryReviewProjection, listCurrentMemoryThreads, iterateMemoryRecords } from '../../repositories/conversationMemoryRepository.js';
import { readMemoryRevisionAssociations, readMemoryRevisionGraph, hasMemoryRevisionAssociations } from './revisionAssociations.js';
import { appendMemoryWorkbenchAssociations } from '../../repositories/conversationMemoryWorkbenchRepository.js';

const committingProjections=new WeakSet();
export function isMemoryPacketCommit(database) { return committingProjections.has(database); }

/** Validate owned current revision targets once per packet; return prior events for the final atomic insert loop. */
export function assertMemoryEventRevisionTargets(database,userId,conversationId,events,{projectedMemoryIds=new Set()}={}) {
  const parents=new Set(); const memories=new Set(); const targets=new Map();
  for (const event of events) {
    const parentId=event.supersedesId;
    const owned=parentId?database.prepare('SELECT memory_id FROM memory_events WHERE id=? AND user_id=? AND conversation_id=?')
      .get(parentId,userId,conversationId):null;
    if (parentId&&!owned) throw new MemoryRevisionError('被替代的事件不属于当前会话');
    const memoryId=owned?.memory_id||event.memoryId;
    if ((parentId&&parents.has(parentId))||(memoryId&&memories.has(memoryId)))
      throw new MemoryRevisionError('同一提取包不能多次修订同一条记忆；请保留一个完整修订','MEMORY_REVISION_TARGET_CONFLICT');
    if (parentId&&projectedMemoryIds.has(memoryId))
      throw new MemoryRevisionError('同一轮不能同时通过记忆工具和 packet.events 修订同一条记忆；请从 packet.events 移除该修订','MEMORY_REVISION_PATH_CONFLICT');
    if (parentId) {
      const prior=getCurrentMemoryEvent(database,userId,conversationId,memoryId);
      if (!prior||prior.id!==parentId) throw new MemoryRevisionError('被替代的事件不是当前会话的有效版本');
      targets.set(event,prior); parents.add(parentId);
    }
    if (memoryId) memories.add(memoryId);
  }
  return targets;
}

/** Returns independent watermarks. Derived lag never makes a successful core commit unready. */
export function getMemoryProcessingState(database,userId,conversationId) {
  const row=ensureMemoryStateRow(database,userId,conversationId);
  return {revision:row.revision,coreMessageId:row.core_message_id,coreMessageRevision:row.core_message_revision,
    coreOrder:row.core_order,summaryOrder:row.summary_order,indexOrder:row.index_order,
    timelineRevision:row.timeline_revision,baselineKind:row.baseline_kind,commitId:row.core_commit_id||'',
    coreReady:true,summaryPending:row.summary_order<row.core_order,indexPending:row.index_order<row.core_order};
}

/** Validate predecessor work before providers and again at commit; return the live anchor without advancing its watermark. */
export function assertMemoryCoreOrder(database,userId,conversationId,messageId,{
  state=ensureMemoryStateRow(database,userId,conversationId),timelineRevision=state.timeline_revision,enforceOrder=true
}={}) {
  const anchor=getMemoryMessage(database,userId,conversationId,messageId);
  if (!anchor) throw new MemoryRevisionError('核心消息不存在','JOB_SOURCE_STALE');
  if (anchor.narrative_order<state.core_order) throw new MemoryRevisionError('不能越过或回退核心提交水位','MEMORY_CORE_ORDER');
  const gap=enforceOrder?findMemoryCoreGap(database,userId,conversationId,anchor,state,timelineRevision):null;
  if (gap) throw Object.assign(new MemoryRevisionError('前一轮核心处理尚未完成，请在记忆工作台重试该轮或重建状态','MEMORY_CORE_GAP'),{blockingMessageId:gap.id});
  return anchor;
}

/** Commits a complete validated packet synchronously after providers finish. guard and enqueueDerived must be synchronous. */
export function commitMemoryPacket(database,userId,conversationId,input,options={}) {
  const packet=normalizeMemoryPacket(input);
  const hash=memoryHash(packet);
  const conversation=requireMemoryConversation(database,userId,conversationId);
  const expectedTimeline=options.expectedTimelineRevision??conversation.timeline_revision;
  const initial=ensureMemoryStateRow(database,userId,conversationId);
  const expectedRevision=options.expectedRevision??initial.revision;
  const key=packet.idempotencyKey||`turn:${packet.messageId||hash}:${expectedTimeline}:${hash}`;
  const prior=database.prepare('SELECT * FROM memory_commits WHERE user_id=? AND conversation_id=? AND idempotency_key=?').get(userId,conversationId,key);
  if (prior) {
    if (prior.packet_hash!==hash) throw new MemoryRevisionError('相同提交键对应了不同的记忆内容');
    return {...JSON.parse(prior.receipt_json),duplicate:true};
  }
  return withSavepoint(database,'sp_memory_packet',()=>{
    options.guard?.();
    const current=requireMemoryConversation(database,userId,conversationId);
    const state=getMemoryState(database,userId,conversationId);
    if (current.timeline_revision!==expectedTimeline) throw new MemoryRevisionError('会话时间线已变化','CONVERSATION_TIMELINE_CHANGED');
    if (state.revision!==expectedRevision) throw new MemoryRevisionError();
    const events=packet.events.filter(event=>!options.projectedEventKeys?.has(event.key));
    assertMemoryEventRevisionTargets(database,userId,conversationId,events);
    const sources=new Map();
    for (const source of packet.sources) {
      const live=getMemoryMessage(database,userId,conversationId,source.messageId);
      if (!live||live.revision!==source.revision) throw new MemoryRevisionError('证据消息版本已变化','JOB_SOURCE_STALE');
      const retained=retainMemorySource(database,userId,conversationId,live);
      if (source.contentHash&&retained.content_hash!==source.contentHash) throw new MemoryRevisionError('证据内容已变化','JOB_SOURCE_STALE');
      sources.set(source.messageId,retained);
    }
    const anchor=packet.messageId?assertMemoryCoreOrder(database,userId,conversationId,packet.messageId,{
      state,timelineRevision:expectedTimeline,enforceOrder:options.enforceOrder!==false
    }):null;
    const order=anchor?.narrative_order??state.core_order;
    const commitId=newId(); const revision=state.revision+1; const timestamp=nowIso();
    // The row is inserted first for immediate FK checks, and its receipt is filled before the savepoint releases.
    database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,timeline_revision,base_revision,revision,narrative_order,message_id,message_revision,kind,receipt_json,created_at,parent_commit_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(commitId,userId,conversationId,key,hash,expectedTimeline,state.revision,revision,order,anchor?.id||'',anchor?.revision||0,options.kind||'turn','{}',timestamp,state.core_commit_id||null);
    const entityMap=new Map();
    const entityScope={commitId,asOfOrder:order,rejectAmbiguous:true};
    for (const entity of packet.entities) {
      let resolved=entity.id?resolveMemoryEntity(database,userId,conversationId,entity.id,entityScope):null;
      if (!resolved&&entity.id) throw new MemoryRevisionError('实体不属于本会话');
      if (resolved&&entity.castKey&&resolved.cast_key!==entity.castKey)
        throw new MemoryRevisionError('实体 ID 与角色标识不一致','MEMORY_ENTITY_UNRESOLVED');
      if (!resolved&&entity.castKey) {
        const matches=listMemoryEntities(database,userId,conversationId,entityScope).filter(row=>row.cast_key===entity.castKey);
        if (matches.length>1) throw new MemoryRevisionError('角色标识对应多个实体','MEMORY_ENTITY_UNRESOLVED');
        resolved=matches[0]||null;
      }
      // A supplied cast key identifies an actor independently of any same-name entity in this lineage.
      if (!resolved&&!entity.castKey) resolved=resolveMemoryEntity(database,userId,conversationId,entity.name,entityScope);
      if (!resolved) resolved=insertMemoryEntity(database,userId,conversationId,{...entity,id:''},order,commitId);
      else appendMemoryEntityAliases(database,userId,conversationId,resolved.id,[entity.name,...entity.aliases],{order,commitId});
      entityMap.set(entity.key,resolved.id);
    }
    const entityRef=ref=>{
      if (!ref) return null;
      const id=entityMap.get(ref)||resolveMemoryEntity(database,userId,conversationId,ref,entityScope)?.id;
      if (!id) throw new MemoryRevisionError(`实体引用未解析或有歧义：${text(ref,100)}`,'MEMORY_ENTITY_UNRESOLVED');
      return id;
    };
    // Keep the pre-action scope so text/pin tools cannot silently detach or reassign canonical graph records.
    const priorProjections=new Map(options.applyActions ? database.prepare(`SELECT id,memory_type,subject,truth_status,visibility,actor_ids_json
      FROM conversation_memories WHERE user_id=? AND conversation_id=?`).all(userId,conversationId).map(row=>[row.id,row]) : []);
    let projectionResult;
    committingProjections.add(database);
    try {
      projectionResult=options.applyActions?.(packet.actions);
      if (projectionResult&&typeof projectionResult.then==='function') throw new Error('Memory commit callbacks must be synchronous');
    } finally { committingProjections.delete(database); }
    // Validate actual server-applied targets rather than trusting model-supplied actions or generated event keys.
    assertMemoryEventRevisionTargets(database,userId,conversationId,events,{
      projectedMemoryIds:new Set((projectionResult?.memories||[]).map(memory=>memory.id))
    });
    const inheritedEvidence=new WeakMap();
    const inheritedAssociations=new WeakMap();
    let revisionGraph;
    if (Array.isArray(projectionResult?.memories)) for (const memory of projectionResult.memories) {
      const priorEvent=getCurrentMemoryEvent(database,userId,conversationId,memory.id);
      if (priorEvent?.memory_revision===memory.revision) continue;
      const previous=priorProjections.get(memory.id);
      const unchangedSubject=priorEvent&&previous?.subject===memory.subject;
      const proposal={key:memory.id,memoryId:memory.id,memoryRevision:memory.revision,
        kind:priorEvent&&previous?.memory_type===memory.memoryType?priorEvent.kind:memory.memoryType,content:memory.content,
        confidence:memory.confidence,lifecycle:memory.lifecycle||(memory.enabled&&!memory.archived?'active':memory.archived?'rejected':'candidate'),
        subjectEntityId:unchangedSubject?priorEvent.subject_entity_id:resolveMemoryEntity(database,userId,conversationId,memory.subject,entityScope)?.id||null,
        participants:priorEvent?JSON.parse(priorEvent.participants_json):[],
        locationEntityId:priorEvent?.location_entity_id||null,narrativeTime:priorEvent?.narrative_time||'',
        supersedesId:priorEvent?.id,truthStatus:memory.truthStatus||'unverified',visibility:memory.visibility||'public',
        actorIds:memory.actorIds||[],importance:memory.importance||0,emotionalIntensity:memory.emotionalIntensity||0,
        layer:memory.pinned?'canon':['working','current','history'].includes(memory.layer)?memory.layer:'history',
        evidence:memory.sourceMessageId?[{messageId:memory.sourceMessageId,quote:memory.sourceExcerpt}]:[]};
      if (priorEvent&&['active','candidate'].includes(priorEvent.lifecycle)&&['active','candidate'].includes(proposal.lifecycle)) {
        revisionGraph ||= readMemoryRevisionGraph(database,userId,conversationId);
        const associations=readMemoryRevisionAssociations(database,userId,conversationId,priorEvent.id,revisionGraph);
        if (hasMemoryRevisionAssociations(associations)) {
          const audience=ids=>JSON.stringify([...ids].sort());
          if (!previous||previous.subject!==memory.subject||previous.memory_type!==memory.memoryType
            ||priorEvent.truth_status!==proposal.truthStatus||priorEvent.visibility!==proposal.visibility
            ||audience(JSON.parse(priorEvent.actor_ids_json||'[]'))!==audience(proposal.actorIds))
            throw new MemoryRevisionError('结构化记忆的角色、类型、真伪或知情范围应通过结构化修订更新','MEMORY_STRUCTURED_SCOPE_CHANGED');
          // Explicit packet corrections win over inherited rows, independent of insertion timestamps.
          const targets=entry=>[memory.id,`projection:${memory.id}`].includes(entry.eventKey||entry.eventId);
          const correctedClaims=new Set(packet.claims.filter(targets).map(row=>row.supersedesId).filter(Boolean));
          const correctedActors=new Set(packet.knowledge.filter(targets).map(row=>entityRef(row.actorEntityId||row.actorKey)));
          const correctedThreads=new Set(packet.threads.filter(targets).map(row=>revisionGraph.threads
            .find(thread=>thread.id===row.id||thread.thread_key===row.id)?.thread_key||row.id).filter(Boolean));
          const correctedRefs=new Set(packet.domainRefs.filter(targets).map(row=>JSON.stringify([row.domain,row.recordId])));
          inheritedAssociations.set(proposal,{
            claims:associations.claims.filter(row=>!correctedClaims.has(row.supersedesId)),
            knowledge:associations.knowledge.filter(row=>!correctedActors.has(row.actorEntityId)),
            threads:associations.threads.filter(row=>!correctedThreads.has(row.id)),
            domainRefs:associations.domainRefs.filter(row=>!correctedRefs.has(JSON.stringify([row.domain,row.recordId])))
          });
        }
      }
      const merge = options.mergeProvenance?.findLast(entry => entry.targetId === memory.id);
      if ((priorEvent&&memory.content===priorEvent.content) || merge) {
        // A trusted staged merge compresses accepted sources; it does not fabricate fresh current-turn evidence.
        const memberIds = new Set([memory.id]);
        if (merge) {
          const visit = id => {
            for (const entry of options.mergeProvenance.filter(item => item.targetId === id)) for (const sourceId of entry.sourceIds) {
              if (!memberIds.has(sourceId)) { memberIds.add(sourceId); visit(sourceId); }
            }
          };
          visit(memory.id);
        }
        const priorEvidence = [];
        for (const id of memberIds) {
          const previous = getCurrentMemoryEvent(database,userId,conversationId,id);
          if (previous) priorEvidence.push(...database.prepare(`SELECT evidence.*,source.message_id,source.message_revision,source.content_hash FROM memory_evidence evidence
            LEFT JOIN memory_source_versions source ON source.id=evidence.source_version_id WHERE evidence.event_id=?`).all(previous.id));
          const staged = projectionResult.memories.find(item => item.id === id);
          const source = staged?.sourceMessageId ? sources.get(staged.sourceMessageId) : null;
          if (source) {
            const quote = staged.sourceExcerpt || '';
            const exact = quote && source.content.replace(/\s+/g,' ').includes(quote.replace(/\s+/g,' '));
            priorEvidence.push({ source_version_id:source.id, message_id:source.message_id, message_revision:source.message_revision,
              content_hash:source.content_hash, quote, evidence_kind:exact?'quote':quote?'paraphrase':'unsourced' });
          }
        }
        for (const item of priorEvidence) if (item.source_version_id) {
          const live=getMemoryMessage(database,userId,conversationId,item.message_id);
          if (!live||live.revision!==item.message_revision || memoryHash({role:live.role,content:live.content,attachments:JSON.parse(live.attachments_json||'[]')})!==item.content_hash)
            throw new MemoryRevisionError('旧证据来源已失效');
        }
        const unique = new Map(priorEvidence.map(item => [JSON.stringify([item.source_version_id,item.quote,item.evidence_kind]),item]));
        inheritedEvidence.set(proposal,[...unique.values()]);
        // The inherited set includes any validated current source, so do not insert it twice below.
        proposal.evidence=[];
      }
      events.push(proposal);
    }
    const revisionTargets=assertMemoryEventRevisionTargets(database,userId,conversationId,events);
    const eventMap=new Map(); const eventIds=[]; const evidenceMap=new Map();
    for (const proposal of events) {
      const event={...proposal,subjectEntityId:entityRef(proposal.subjectEntityId),locationEntityId:entityRef(proposal.locationEntityId),
        participants:(proposal.participants||[]).map(entityRef),actorIds:(proposal.actorIds||[]).map(entityRef)};
      if (event.visibility==='restricted'&&!event.actorIds.length) throw new Error('受限事件必须明确知情角色');
      const evidence=proposal.evidence||[];
      if (!evidence.length&&!inheritedEvidence.has(proposal)&&!['manual','author_correction','bootstrap','adopted_baseline'].includes(options.kind)) throw new Error('提取事件必须关联来源证据');
      if (event.supersedesId) {
        const prior=revisionTargets.get(proposal);
        if (packet.events.includes(proposal)) {
          event.memoryId=prior.memory_id;
          const max=database.prepare('SELECT MAX(memory_revision) AS revision FROM memory_events WHERE user_id=? AND conversation_id=? AND memory_id=?').get(userId,conversationId,prior.memory_id);
          event.memoryRevision=(max?.revision||prior.memory_revision)+1;
          database.prepare('DELETE FROM conversation_memories WHERE id=? AND user_id=? AND conversation_id=?').run(prior.memory_id,userId,conversationId);
        }
      }
      for (const item of evidence) {
        const source=sources.get(item.messageId);
        if (!source) throw new MemoryRevisionError('事件证据不在本轮已验证来源中');
        if (item.revision&&item.revision!==source.message_revision) throw new MemoryRevisionError();
        const quote=text(item.quote,1000); const exact=quote&&source.content.replace(/\s+/g,' ').includes(quote.replace(/\s+/g,' '));
        event.confidence=Math.min(event.confidence??1,exact?1:quote?0.6:0.5);
      }
      const stored=insertMemoryEvent(database,userId,conversationId,event,commitId,order);
      insertMemoryReviewProjection(database,userId,conversationId,stored,evidence.length?sources.get(evidence[0].messageId):null,evidence[0]?.quote||'');
      eventMap.set(proposal.key||stored.id,stored.id); eventIds.push(stored.id);
      if (proposal.memoryId) eventMap.set(`projection:${proposal.memoryId}`,stored.id);
      for (const item of evidence) {
        const source=sources.get(item.messageId); const quote=text(item.quote,1000);
        evidenceMap.set(stored.id,insertMemoryEvidence(database,userId,conversationId,stored.id,source,quote,quote&&source.content.replace(/\s+/g,' ').includes(quote.replace(/\s+/g,' '))?'quote':quote?'paraphrase':'unsourced'));
      }
      if (inheritedEvidence.has(proposal)) {
        const inherited=inheritedEvidence.get(proposal);
        for (const item of inherited) {
          const source=item.source_version_id?database.prepare('SELECT * FROM memory_source_versions WHERE id=?').get(item.source_version_id):null;
          const evidenceId=insertMemoryEvidence(database,userId,conversationId,stored.id,source,item.quote,item.evidence_kind);
          if(!evidenceMap.has(stored.id)) evidenceMap.set(stored.id,evidenceId);
        }
        if (!inherited.length) evidenceMap.set(stored.id,insertMemoryEvidence(database,userId,conversationId,stored.id,null,'','author'));
      } else if (!evidence.length) evidenceMap.set(stored.id,insertMemoryEvidence(database,userId,conversationId,stored.id,null,'','author'));
      if(inheritedAssociations.has(proposal)) appendMemoryWorkbenchAssociations(database,userId,conversationId,stored.id,commitId,order,
        inheritedAssociations.get(proposal),evidenceMap.get(stored.id)||null);
    }
    const eventRef=ref=>{
      const id=eventMap.get(ref)||ref;
      if (!database.prepare('SELECT id FROM memory_events WHERE id=? AND user_id=? AND conversation_id=?').get(id,userId,conversationId)) throw new MemoryRevisionError('事件引用不属于本会话');
      return id;
    };
    for (const claim of packet.claims) {
      const eventId=eventRef(claim.eventKey||claim.eventId);
      const modality=oneOf(claim.modality,['assertion','utterance','promise','attempt','inference','rumor','hypothesis','intent'],'assertion');
      let truth=oneOf(claim.truthStatus,MEMORY_TRUTH_STATES,'unverified');
      if (modality!=='assertion'&&truth==='established') truth='unverified';
      const validFrom=Number.isInteger(claim.validFrom)?claim.validFrom:order;
      const validTo=claim.validTo==null?null:Number(claim.validTo);
      if (validTo!==null&&(!Number.isInteger(validTo)||validTo<validFrom)) throw new Error('事实有效时间范围无效');
      const supersedes=claim.supersedesId?database.prepare('SELECT * FROM memory_claims WHERE id=? AND user_id=? AND conversation_id=?').get(claim.supersedesId,userId,conversationId):null;
      if (claim.supersedesId&&!supersedes) throw new MemoryRevisionError('被替代事实不属于本会话');
      database.prepare(`INSERT INTO memory_claims(id,user_id,conversation_id,event_id,subject_entity_id,predicate,object_entity_id,value_json,modality,polarity,truth_status,valid_from,valid_to,recorded_at,supersedes_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(),userId,conversationId,eventId,entityRef(claim.subjectEntityId||claim.subjectKey),text(claim.predicate,160),entityRef(claim.objectEntityId||claim.objectKey),JSON.stringify(claim.value??null),modality,claim.polarity===false||claim.polarity===-1?-1:1,truth,validFrom,validTo,timestamp,supersedes?.id||null);
    }
    for (const knowledge of packet.knowledge) {
      const eventId=eventRef(knowledge.eventKey||knowledge.eventId);
      const actorId=entityRef(knowledge.actorEntityId||knowledge.actorKey);
      if (!actorId) throw new Error('知情记录必须指定角色');
      const epistemic=oneOf(knowledge.epistemicState,MEMORY_EPISTEMIC_STATES,'unknown');
      const beliefContent=text(knowledge.beliefContent,5000);
      if (epistemic==='false_belief'&&!beliefContent) throw new Error('错误信念必须保存角色所相信的内容，不能暴露真实事实');
      database.prepare(`INSERT INTO memory_actor_knowledge(id,user_id,conversation_id,actor_entity_id,event_id,commit_id,epistemic_state,learned_from_event_id,learned_order,source_evidence_id,belief_content,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(newId(),userId,conversationId,actorId,eventId,commitId,epistemic,knowledge.learnedFromEventId?eventRef(knowledge.learnedFromEventId):eventId,order,evidenceMap.get(eventId)||null,beliefContent,timestamp);
    }
    for (const thread of packet.threads) {
      const eventId=eventRef(thread.eventKey||thread.eventId); const threadId=text(thread.id,160)||newId();
      const existing=listCurrentMemoryThreads(database,userId,conversationId).find(row=>row.id===threadId||row.thread_key===threadId);
      const status=oneOf(thread.status,['open','resolved','abandoned'],'open');
      database.prepare(`INSERT INTO memory_plot_threads(id,user_id,conversation_id,event_id,commit_id,thread_key,kind,title,status,owner_entity_id,resolution_trigger,resolved_event_id,created_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(newId(),userId,conversationId,eventId,commitId,existing?.thread_key||threadId,oneOf(thread.kind,['goal','promise','conflict','clue','question'],existing?.kind||'question'),text(thread.title||existing?.title,1000),status,thread.ownerEntityId||thread.ownerKey?entityRef(thread.ownerEntityId||thread.ownerKey):existing?.owner_entity_id||null,text(thread.resolutionTrigger??existing?.resolution_trigger,1000),status==='resolved'?eventId:null,order,timestamp);
    }
    // Domain writes are performed by their authoritative service in applyActions; memory keeps typed receipts only.
    for (const ref of packet.domainRefs) database.prepare(`INSERT INTO memory_domain_refs(id,user_id,conversation_id,event_id,domain,record_id,revision,outcome_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(newId(),userId,conversationId,eventRef(ref.eventKey||ref.eventId),text(ref.domain,80),text(ref.recordId,160),text(ref.revision,160),JSON.stringify(ref.outcome||{}),timestamp);
    invalidateMemoryDerived(database,userId,conversationId,eventIds);
    database.prepare(`UPDATE conversation_memory_state SET revision=?,core_message_id=?,core_message_revision=?,core_order=?,timeline_revision=?,core_commit_id=?,updated_at=? WHERE user_id=? AND conversation_id=?`)
      .run(revision,anchor?.id||state.core_message_id,anchor?.revision||state.core_message_revision,order,expectedTimeline,commitId,timestamp,userId,conversationId);
    const receipt={version:1,commitId,revision,coreOrder:order,messageId:anchor?.id||'',messageRevision:anchor?.revision||0,eventIds,packet,
      accepted:eventIds.length,summaryPending:true,indexPending:true,...(projectionResult||{})};
    options.guard?.();
    const derived=options.enqueueDerived?.({commitId,revision,coreOrder:order,eventIds,sourceHash:hash});
    if (derived&&typeof derived.then==='function') throw new Error('Memory outbox callback must be synchronous');
    if (derived) receipt.jobs=derived;
    database.prepare('UPDATE memory_commits SET receipt_json=? WHERE id=?').run(JSON.stringify(receipt),commitId);
    return receipt;
  });
}

export function invalidateMemoryDerived(database,userId,conversationId,eventIds=[]) {
  // Dependencies are transitive through parent summaries. Conservative scope invalidation is safe until rebuilt.
  database.prepare("UPDATE memory_summaries SET status='stale' WHERE user_id=? AND conversation_id=? AND status='active'").run(userId,conversationId);
  database.prepare('UPDATE conversation_memory_state SET summary_order=0,index_order=0 WHERE user_id=? AND conversation_id=?').run(userId,conversationId);
}

/** Captures only projections/watermarks in per-turn checkpoints, keeping immutable logs linear in chat length. */
export function captureMemoryCheckpoint(database,userId,conversationId) {
  const viewOrder=database.prepare('SELECT COUNT(*) AS count FROM messages WHERE user_id=? AND conversation_id=?').get(userId,conversationId).count;
  return {version:1,...getMemoryProcessingState(database,userId,conversationId),viewOrder};
}

/** Changes current membership without dropping the retained evidence log. */
export function restoreMemoryCheckpoint(database,userId,conversationId,checkpoint={}) {
  const current=requireMemoryConversation(database,userId,conversationId);
  const order=Math.max(0,Number(checkpoint.coreOrder)||0);
  const commitId=checkpoint.commitId||'';
  if (commitId&&!database.prepare('SELECT id FROM memory_commits WHERE id=? AND user_id=? AND conversation_id=?').get(commitId,userId,conversationId)) throw new MemoryRevisionError('检查点引用的记忆日志不存在','MEMORY_CHECKPOINT_MISSING');
  database.prepare(`UPDATE conversation_memory_state SET revision=revision+1,core_order=?,core_message_id=?,core_message_revision=?,core_commit_id=?,timeline_revision=?,summary_order=0,index_order=0,updated_at=? WHERE user_id=? AND conversation_id=?`)
    .run(order,checkpoint.coreMessageId||checkpoint.messageId||'',checkpoint.coreMessageRevision||checkpoint.messageRevision||0,commitId,current.timeline_revision,nowIso(),userId,conversationId);
  rebuildMemoryReviewProjection(database,userId,conversationId,checkpoint.viewOrder??order);
  invalidateMemoryDerived(database,userId,conversationId);
}

/** Reconstructs the editable review projection from the selected immutable commit lineage. */
export function rebuildMemoryReviewProjection(database,userId,conversationId,asOfOrder=Number.MAX_SAFE_INTEGER) {
  const records=iterateMemoryRecords(database,userId,conversationId,{asOfOrder,includeAllLifecycle:true});
  database.prepare('DELETE FROM conversation_memory_review_operations WHERE user_id=? AND conversation_id=?').run(userId,conversationId);
  database.prepare('DELETE FROM conversation_memories WHERE user_id=? AND conversation_id=?').run(userId,conversationId);
  const insert=database.prepare(`INSERT INTO conversation_memories(id,user_id,conversation_id,memory_type,subject,content,confidence,source_message_id,source_kind,source_excerpt,enabled,archived,pinned,revision,invalidated_at,created_at,updated_at,layer,importance,emotional_intensity,visibility,truth_status,actor_ids_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const event of records) {
    if (event.kind==='deletion') continue;
    const evidence=database.prepare(`SELECT e.*,s.message_id FROM memory_evidence e LEFT JOIN memory_source_versions s ON s.id=e.source_version_id WHERE e.event_id=? ORDER BY e.created_at LIMIT 1`).get(event.id);
    const subject=event.subject_entity_id?database.prepare('SELECT name FROM memory_entities WHERE id=?').get(event.subject_entity_id)?.name||'':'';
    const max=database.prepare('SELECT MAX(memory_revision) AS revision FROM memory_events WHERE user_id=? AND conversation_id=? AND memory_id=?').get(userId,conversationId,event.memory_id);
    const timestamp=nowIso();
    insert.run(event.memory_id||event.id,userId,conversationId,['event','relationship','location','preference','fact','summary','intent','hypothesis'].includes(event.kind)?event.kind:'event',subject,event.content,event.confidence,evidence?.message_id||'',evidence?.source_kind==='message'?'auto':'manual',evidence?.quote||'',event.lifecycle==='active'?1:0,event.lifecycle==='rejected'||event.lifecycle==='superseded'?1:0,event.layer==='canon'?1:0,(max?.revision||event.memory_revision)+1,event.lifecycle==='rejected'?timestamp:null,event.created_at,timestamp,event.layer,event.importance,event.emotional_intensity,event.visibility,event.truth_status,event.actor_ids_json);
  }
}

export function materializeMemoryAsOf(database,userId,conversationId,order) { return {state:getMemoryProcessingState(database,userId,conversationId),events:listMemoryRecords(database,userId,conversationId,{asOfOrder:order})}; }

/** Establishes explicit provenance for opening canon or an adopted state without inventing unseen historical events. */
export function ensureMemoryBaseline(database,userId,conversationId,{kind='bootstrap',sources={},messageId='',entities=[]}={}) {
  const state=ensureMemoryStateRow(database,userId,conversationId);
  if (kind!=='adopted_baseline'&&state.baseline_kind!=='legacy') return getMemoryProcessingState(database,userId,conversationId);
  return withSavepoint(database,'sp_memory_baseline',()=>{
    const message=messageId?getMemoryMessage(database,userId,conversationId,messageId):null;
    const receipt=commitMemoryPacket(database,userId,conversationId,{version:1,messageId,entities,sources:message?[{messageId:message.id,revision:message.revision}]:[],events:[],idempotencyKey:`baseline:${kind}:${messageId}:${kind==='adopted_baseline'?state.revision:1}`},{kind,enforceOrder:false});
    database.prepare('UPDATE conversation_memory_state SET baseline_kind=?,baseline_json=? WHERE user_id=? AND conversation_id=?').run(kind,JSON.stringify({sources,historyCoverage:kind==='adopted_baseline'?'not_extracted':'opening'}),userId,conversationId);
    return {...getMemoryProcessingState(database,userId,conversationId),commitId:receipt.commitId};
  });
}

export function invalidateMemorySources(database,userId,conversationId) {
  const invalid=database.prepare(`SELECT DISTINCT e.id FROM memory_events e JOIN memory_evidence evidence ON evidence.event_id=e.id
    JOIN memory_source_versions source ON source.id=evidence.source_version_id LEFT JOIN messages live ON live.id=source.message_id
    WHERE e.user_id=? AND e.conversation_id=? AND (live.id IS NULL OR live.revision<>source.message_revision)`).all(userId,conversationId);
  database.prepare('UPDATE conversation_memory_state SET revision=revision+1,timeline_revision=(SELECT timeline_revision FROM conversations WHERE id=?),updated_at=? WHERE user_id=? AND conversation_id=?').run(conversationId,nowIso(),userId,conversationId);
  invalidateMemoryDerived(database,userId,conversationId,invalid.map(row=>row.id));
  return invalid.map(row=>row.id);
}
