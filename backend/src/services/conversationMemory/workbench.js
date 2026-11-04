import { listMemoryEntities,listMemoryRecords,getMemoryState,requireMemoryConversation,listCurrentMemoryKnowledge,listCurrentMemoryThreads,listCurrentMemoryClaims,iterateMemoryRecords } from '../../repositories/conversationMemoryRepository.js';
import { listMemoryWorkbenchEvidence,listMemoryWorkbenchDomainRefs,readMemoryWorkbenchSceneItem,readMemoryWorkbenchCommit } from '../../repositories/conversationMemoryWorkbenchRepository.js';
import { listMemorySummaryCandidates } from '../../repositories/conversationMemoryContextRepository.js';
import { readProjectedContextCheckpoint } from '../../repositories/projectedContextRepository.js';
import { memoryReadScope } from './retrieval.js';
import { getConversationProcessingSummary, submitJob } from '../jobs/jobQueue.js';
import { getConversationForUser } from '../../routes/helpers.js';
import { getActiveEmbeddingIndex, embeddingUsageSummary } from '../embeddings/index.js';
import { commitMemoryPacket } from './commit.js';
import { enqueueMemoryDerivedJobs } from './derivedJobs.js';
import { newId } from '../../security.js';
import { ACTOR_POSSESSION_PREDICATES,actorMemoryRecord,eventActorIds,possessionQuantity } from '../../domain/conversationMemory/actorDossier.js';
import { memoryHash,MemoryRevisionError,MEMORY_EVENT_KINDS,MEMORY_VISIBILITIES,MEMORY_TRUTH_STATES,MEMORY_LAYERS } from '../../domain/conversationMemory/contracts.js';
import { z } from 'zod';
import { readMemoryRevisionAssociations,bindMemoryRevisionAssociations } from './revisionAssociations.js';

const authorRevision=z.number().int().nonnegative();
const authorKey=z.string().trim().min(1).max(200);
const actorRefs=z.array(z.string().trim().min(1).max(160)).max(20);
const actorRecord=z.object({content:z.string().trim().min(1).max(5000),kind:z.enum(MEMORY_EVENT_KINDS).optional(),
  visibility:z.enum(MEMORY_VISIBILITIES).optional(),truthStatus:z.enum(MEMORY_TRUTH_STATES).optional(),layer:z.enum(MEMORY_LAYERS).optional(),
  confidence:z.number().min(0).max(1).optional(),importance:z.number().min(0).max(1).optional(),emotionalIntensity:z.number().min(0).max(1).optional(),
  participants:actorRefs.optional(),actorIds:actorRefs.optional(),narrativeTime:z.string().trim().max(160).optional()}).strict();
const actorBatchSchema=z.object({expectedRevision:authorRevision,idempotencyKey:authorKey,records:z.array(actorRecord).min(1).max(80)}).strict();
const actorTextPatchSchema=z.object({expectedRevision:authorRevision,revision:z.number().int().positive(),eventId:z.string().trim().min(1).max(160),
  content:z.string().trim().min(1).max(5000),idempotencyKey:authorKey}).strict();

/** Author inspection is owner scoped; an actor view returns only eligible propositions and learning records. */
export function readMemoryWorkbench(database,userId,conversationId,options={}) {
  requireMemoryConversation(database,userId,conversationId);
  const checkpoint=readProjectedContextCheckpoint(database,userId,conversationId,options);
  const scope=memoryReadScope(database,userId,conversationId,{...options,
    ...(checkpoint?{commitId:checkpoint.memoryCheckpoint.commitId||'',asOfOrder:checkpoint.cutoff}:{})});
  const entities=listMemoryEntities(database,userId,conversationId,scope);
  if(scope.actorId&&!entities.some(row=>row.id===scope.actorId&&row.kind==='actor'))
    throw Object.assign(new Error('严格视角需要选择此会话中有效的角色'),{status:400,code:'MEMORY_ACTOR_REQUIRED'});
  const events=listMemoryRecords(database,userId,conversationId,{...scope,includeCandidates:!scope.actorId,limit:1000});
  const ids=new Set(events.map(row=>row.id));
  const processing=getConversationProcessingSummary(database,userId,conversationId);
  const state=getMemoryState(database,userId,conversationId);
  const index=getActiveEmbeddingIndex(database,userId,conversationId);
  const latest=stage=>processing?.stages?.[stage]?.at(-1)||null;
  return {version:1,revision:state?.revision||0,baselineKind:state?.baseline_kind||'legacy',
    coreReady:processing?.coreReady??true,requiredStages:processing?.requiredStages||[],
    watermarks:{core:checkpoint?.memoryCheckpoint.coreOrder??state?.core_order??0,summary:checkpoint?0:state?.summary_order||0,index:checkpoint?0:state?.index_order||0},
    stages:Object.fromEntries(['core','summary','index'].map(stage=>[stage,latest(stage)])),
    stageJobs:processing?.stages||{},
    entities:entities.filter(row=>row.created_order<=scope.asOfOrder&&(!scope.actorId||row.id===scope.actorId))
      .map(row=>({...row,canonicalName:row.name,castKey:row.cast_key})),
    events:events.map(row=>({...row,eventId:row.id,memoryId:row.memory_id,narrativeOrder:row.narrative_order,
      truthStatus:row.truth_status,evidenceRefs:scope.actorId?[]:listMemoryWorkbenchEvidence(database,userId,conversationId,row.id)})),
    claims:scope.actorId?[]:listCurrentMemoryClaims(database,userId,conversationId,scope).filter(row=>ids.has(row.event_id)),
    knowledge:listCurrentMemoryKnowledge(database,userId,conversationId,scope).filter(row=>ids.has(row.event_id))
      .map(row=>({...row,actorId:row.actor_entity_id,eventId:row.event_id,epistemicState:row.epistemic_state})),
    // Plot triggers are author instructions without actor audience metadata, even when their source event is known.
    threads:scope.actorId?[]:listCurrentMemoryThreads(database,userId,conversationId,scope).filter(row=>ids.has(row.event_id)),
    summaries:scope.actorId?[]:listMemorySummaryCandidates(database,userId,conversationId,scope.asOfOrder).filter(summary=>{
      if(!summary.dependencies.length)return false;
      const visible=new Map();
      for(let offset=0;offset<summary.dependencies.length;offset+=500) for(const event of listMemoryRecords(database,userId,conversationId,
        {...scope,ids:summary.dependencies.slice(offset,offset+500).map(row=>row.event_id),limit:500}))visible.set(event.id,event.source_hash);
      return summary.dependencies.every(row=>visible.get(row.event_id)===row.source_hash);
    }),
    index:index?{id:index.id,status:index.status,fingerprint:index.fingerprint,dimensions:index.dimensions,sourceRevision:index.source_revision}:null,
    usage:embeddingUsageSummary(database,userId,conversationId)};
}

/** Reindex the current committed state; idempotency and job scope prevent duplicate rebuilds. */
export function requestMemoryReindex(database,userId,conversationId,options={}) {
  const conversation=getConversationForUser(database,userId,conversationId,{includeUsage:false});
  if(!conversation)return null;
  if(conversation.settings?.accessorySkills?.memoryAgent?.embedding?.enabled!==true)
    throw Object.assign(new Error('请先启用并配置独立向量模型'),{status:400,code:'EMBEDDING_CONFIGURATION_REQUIRED'});
  const state=getMemoryState(database,userId,conversationId);
  if(options.revision!==undefined&&Number(options.revision)!==state?.revision)
    throw Object.assign(new Error('记忆版本已变化，请刷新后重建'),{status:409,code:'MEMORY_REVISION_CHANGED'});
  return submitJob(database,userId,'memory.index',{conversationId,timelineRevision:conversation.timelineRevision,operation:'rebuild',
    memoryRevision:state?.revision||0,coreOrder:state?.core_order||0,commitId:state?.core_commit_id||''},
  {internal:true,idempotencyKey:`memory.index:${conversationId}:${state?.revision||0}:${state?.core_commit_id||''}`});
}

/** Apply an explicit author correction without fabricating a processed turn or advancing its watermark. */
export function applyAuthorMemoryPacket(database,userId,conversationId,{expectedRevision,packet}={}) {
  requireMemoryConversation(database,userId,conversationId);
  if(!Number.isInteger(expectedRevision)||expectedRevision<0)
    throw Object.assign(new Error('结构化修订必须携带当前记忆版本'),{status:400,code:'MEMORY_REVISION_REQUIRED'});
  return commitMemoryPacket(database,userId,conversationId,{...packet,messageId:'',idempotencyKey:packet?.idempotencyKey||`author:${newId()}`},
    {expectedRevision,kind:'author_correction',enforceOrder:false,
      enqueueDerived:receipt=>enqueueMemoryDerivedJobs(database,userId,conversationId,receipt)});
}

/** List canonical story and card actors; selecting an author dossier never grants that actor extra knowledge. */
export function listMemoryActors(database,userId,conversationId,options={}) {
  const graph=readActorGraph(database,userId,conversationId,options);
  const query=String(options.query||'').normalize('NFKC').trim().toLocaleLowerCase().slice(0,200);
  const actors=graph.actors.filter(actor=>!query||[actor.name,...actor.aliases].some(name=>name.normalize('NFKC').toLocaleLowerCase().includes(query)))
    .map(actor=>actorDossier(graph,actor,database,userId,conversationId,{...options,countsOnly:true}).actor);
  return {version:1,revision:graph.revision,actors};
}

/** Read a target actor's native records under a separately selected viewer scope and historical lineage. */
export function readMemoryActorDossier(database,userId,conversationId,actorId,options={}) {
  const graph=readActorGraph(database,userId,conversationId,options);
  const actor=graph.actors.find(row=>row.id===actorId);
  if(!actor)throw actorError('角色不存在或不属于当前可见历史','MEMORY_ACTOR_NOT_FOUND',404);
  return actorDossier(graph,actor,database,userId,conversationId,options);
}

/** Validate a bounded actor-scoped author batch before one canonical commit and its derived-job outbox. */
export function appendMemoryActorRecords(database,userId,conversationId,actorId,input={}) {
  requireMemoryConversation(database,userId,conversationId);
  const request=parseActorRequest(actorBatchSchema,input);
  const identity=authorRequestIdentity('batch',actorId,'',request);
  const prior=readAuthorRequestReceipt(database,userId,conversationId,identity);
  if(prior)return prior;
  const graph=readActorGraph(database,userId,conversationId,{});
  if(!graph.actors.some(row=>row.id===actorId))throw actorError('角色不存在或不属于当前可见历史','MEMORY_ACTOR_NOT_FOUND',404);
  const events=request.records.map((record,index)=>{
    for(const ref of [...record.participants||[],...record.actorIds||[]])
      if(graph.entities.get(ref)?.kind!=='actor')throw actorError('关联角色不属于当前会话','MEMORY_ACTOR_REFERENCE_INVALID');
    const audience=record.actorIds||[];
    if(record.visibility==='restricted'&&!audience.length)throw actorError('受限记忆必须明确知情角色','MEMORY_ACTOR_AUDIENCE_REQUIRED');
    return {...record,key:`actor-record-${index}`,subjectEntityId:actorId};
  });
  return applyAuthorMemoryPacket(database,userId,conversationId,{expectedRevision:request.expectedRevision,
    packet:{idempotencyKey:identity.key,summary:identity.hash,events}});
}

/** Replace only text, preserving typed associations while retaining original evidence on the immutable prior event. */
export function patchMemoryActorRecord(database,userId,conversationId,actorId,memoryId,input={}) {
  requireMemoryConversation(database,userId,conversationId);
  const request=parseActorRequest(actorTextPatchSchema,input);
  const identity=authorRequestIdentity('text',actorId,memoryId,request);
  const prior=readAuthorRequestReceipt(database,userId,conversationId,identity);
  if(prior)return prior;
  const graph=readActorGraph(database,userId,conversationId,{});
  if(!graph.actors.some(row=>row.id===actorId))throw actorError('角色不存在或不属于当前可见历史','MEMORY_ACTOR_NOT_FOUND',404);
  const event=graph.events.find(row=>row.memory_id===memoryId);
  if(!event||!eventActorIds(event,graph.claims.filter(row=>row.event_id===event.id),graph.knowledge.filter(row=>row.event_id===event.id),
    graph.threads.filter(row=>row.event_id===event.id)).has(actorId))
    throw actorError('记忆不属于此角色的当前记录','MEMORY_ACTOR_RECORD_NOT_FOUND',404);
  if(event.id!==request.eventId||event.memory_revision!==request.revision)throw new MemoryRevisionError();
  const key='actor-text-revision';
  const associations=bindMemoryRevisionAssociations(readMemoryRevisionAssociations(database,userId,conversationId,event.id,graph),key);
  return applyAuthorMemoryPacket(database,userId,conversationId,{expectedRevision:request.expectedRevision,packet:{
    idempotencyKey:identity.key,summary:identity.hash,events:[{key,kind:event.kind,content:request.content,subjectEntityId:event.subject_entity_id,
      participants:event.participants,actorIds:event.actorIds,locationEntityId:event.location_entity_id,visibility:event.visibility,
      truthStatus:event.truth_status,lifecycle:event.lifecycle,confidence:event.confidence,importance:event.importance,
      emotionalIntensity:event.emotional_intensity,narrativeTime:event.narrative_time,layer:event.layer,supersedesId:event.id}],
    ...associations}});
}

/** Bind retries to an exact operation and normalized request, so a reused key cannot accept different edits. */
function authorRequestIdentity(operation,actorId,memoryId,request) {
  return {key:`author-actor:${actorId}:${request.idempotencyKey}`,hash:memoryHash({operation,actorId,memoryId,request})};
}

function readAuthorRequestReceipt(database,userId,conversationId,identity) {
  const prior=readMemoryWorkbenchCommit(database,userId,conversationId,identity.key);
  if(!prior)return null;
  if(!prior.in_current_lineage)throw new MemoryRevisionError('该提交键属于已回退的历史，请刷新后使用新的提交键');
  const receipt=JSON.parse(prior.receipt_json);
  if(receipt.packet?.summary!==identity.hash)throw new MemoryRevisionError('相同提交键对应了不同的角色记忆修订');
  return {...receipt,duplicate:true};
}

function parseActorRequest(schema,input) {
  const parsed=schema.safeParse(input);
  if(!parsed.success)throw actorError('角色记忆请求格式无效','MEMORY_ACTOR_REQUEST_INVALID');
  return parsed.data;
}

/** Resolve the same checkpoint and eligibility policy used by the general memory workbench. */
function readActorGraph(database,userId,conversationId,options) {
  requireMemoryConversation(database,userId,conversationId);
  if(options.asOfOrder!==undefined&&!Number.isFinite(Number(options.asOfOrder)))
    throw actorError('历史顺序必须是有效数字','MEMORY_CUTOFF_INVALID');
  const historical={...options,
    ...(options.asOfOrder!==undefined?{asOfOrder:Number(options.asOfOrder)}:{}),
    beforeCutoff:options.beforeCutoff===true||options.beforeCutoff==='true'};
  const checkpoint=readProjectedContextCheckpoint(database,userId,conversationId,historical);
  const scope=memoryReadScope(database,userId,conversationId,{...historical,actorId:options.viewerActorId||'',
    ...(checkpoint?{commitId:checkpoint.memoryCheckpoint.commitId||'',asOfOrder:checkpoint.cutoff}:{})});
  const entities=listMemoryEntities(database,userId,conversationId,scope);
  if(scope.actorId&&!entities.some(row=>row.id===scope.actorId&&row.kind==='actor'))
    throw actorError('严格视角需要选择此会话中有效的角色','MEMORY_ACTOR_REQUIRED');
  const events=[...iterateMemoryRecords(database,userId,conversationId,{...scope,includeCandidates:!scope.actorId})]
    .sort((left,right)=>right.narrative_order-left.narrative_order||right.event_sequence-left.event_sequence||left.id.localeCompare(right.id));
  const eventIds=new Set(events.map(row=>row.id));
  const claims=scope.actorId?[]:listCurrentMemoryClaims(database,userId,conversationId,scope).filter(row=>eventIds.has(row.event_id));
  const knowledge=listCurrentMemoryKnowledge(database,userId,conversationId,scope).filter(row=>eventIds.has(row.event_id));
  const threads=scope.actorId?[]:listCurrentMemoryThreads(database,userId,conversationId,scope).filter(row=>eventIds.has(row.event_id));
  const actors=entities.filter(row=>row.kind==='actor'&&(!scope.actorId||row.id===scope.actorId));
  return {scope,checkpoint,revision:checkpoint?.memoryCheckpoint.revision??getMemoryState(database,userId,conversationId)?.revision??0,
    entities:new Map(entities.map(row=>[row.id,row])),actors,events,claims,knowledge,threads};
}

/** Build read-only character sections from exact entity IDs, never text matching or copied inventories. */
function actorDossier(graph,actor,database,userId,conversationId,options) {
  const claimsByEvent=groupBy(graph.claims,'event_id');
  const knowledgeByEvent=groupBy(graph.knowledge,'event_id');
  const threadsByEvent=groupBy(graph.threads,'event_id');
  const events=graph.events.filter(event=>eventActorIds(event,claimsByEvent.get(event.id),knowledgeByEvent.get(event.id),threadsByEvent.get(event.id)).has(actor.id));
  const memories=events.map(event=>actorMemoryRecord(graph.scope.actorId?{...event,actorIds:(event.actorIds||[]).filter(id=>id===graph.scope.actorId)}:event,
    graph.scope.actorId?new Map([[actor.id,actor]]):graph.entities));
  const relations=graph.claims.filter(row=>(row.subject_entity_id===actor.id||row.object_entity_id===actor.id)
    &&graph.entities.get(row.subject_entity_id)?.kind==='actor'&&graph.entities.get(row.object_entity_id)?.kind==='actor')
    .map(row=>({id:row.id,eventId:row.event_id,subjectId:row.subject_entity_id,subjectName:graph.entities.get(row.subject_entity_id)?.name||'',
      objectId:row.object_entity_id,objectName:graph.entities.get(row.object_entity_id)?.name||'',predicate:row.predicate,value:row.value,
      truthStatus:row.truth_status,modality:row.modality,direction:row.subject_entity_id===actor.id?'outgoing':'incoming',validFrom:row.valid_from,validTo:row.valid_to}));
  const possessions=graph.claims.filter(row=>row.subject_entity_id===actor.id&&graph.entities.get(row.object_entity_id)?.kind==='object'
    &&ACTOR_POSSESSION_PREDICATES.includes(row.predicate.toLocaleLowerCase())&&row.polarity>0&&row.modality==='assertion'&&row.truth_status!=='false');
  const possessionGroups=groupBy(possessions,'event_id');
  const refs=options.countsOnly?[]:listMemoryWorkbenchDomainRefs(database,userId,conversationId,possessions.map(row=>row.event_id));
  const refsByEvent=groupBy(refs,'event_id');
  const items=possessions.map(row=>{
    const object=graph.entities.get(row.object_entity_id);
    const sceneRefs=(refsByEvent.get(row.event_id)||[]).filter(ref=>['scene_item','scene_object'].includes(ref.domain));
    const ref=possessionGroups.get(row.event_id).length===1&&sceneRefs.length===1?sceneRefs[0]:null;
    const scene=ref?(graph.checkpoint?(graph.checkpoint.checkpoint.snapshot.state.scene_objects||[]).find(item=>item.id===ref.record_id)
      :readMemoryWorkbenchSceneItem(database,conversationId,ref.record_id)):null;
    return {id:row.id,eventId:row.event_id,entityId:object.id,name:object.name,predicate:row.predicate,
      quantity:scene?scene.quantity:possessionQuantity(row.value),status:row.truth_status,
      source:scene?'scene':'memory',recordId:scene?.id||'',recordRevision:scene?.revision||null,
      description:scene?.description||'',authoritative:Boolean(scene)};
  });
  const counts={memories:memories.length,events:events.length,relations:relations.length,items:items.length};
  const dto={id:actor.id,name:actor.name,canonicalName:actor.name,aliases:actor.aliases||[],castKey:actor.cast_key||'',
    origin:actor.cast_key==='main-character'?'card':'story',counts};
  if(options.countsOnly)return {actor:dto};
  const limit=Math.max(1,Math.min(500,Math.floor(Number(options.limit)||200)));
  const offset=Math.max(0,Math.floor(Number(options.offset)||0));
  return {version:1,revision:graph.revision,actor:dto,counts,
    memories:memories.slice(offset,offset+limit),
    events:events.slice(offset,offset+limit).map(event=>({id:event.id,eventId:event.id,memoryId:event.memory_id,revision:event.memory_revision,
      kind:event.kind,content:event.content,visibility:event.visibility,
      participants:graph.scope.actorId?event.participants.filter(id=>id===graph.scope.actorId):event.participants,epistemicState:event.epistemicState||'',
      narrativeOrder:event.narrative_order,truthStatus:event.truth_status,
      subjectEntityId:graph.scope.actorId&&event.subject_entity_id!==graph.scope.actorId?null:event.subject_entity_id,
      evidenceRefs:graph.scope.actorId?[]:listMemoryWorkbenchEvidence(database,userId,conversationId,event.id)})),
    relations:relations.slice(offset,offset+limit),items:items.slice(offset,offset+limit),
    pagination:{offset,limit,hasMore:Object.values(counts).some(count=>count>offset+limit)}};
}

function groupBy(rows,key) {
  const groups=new Map();
  for(const row of rows) {const group=groups.get(row[key])||[];group.push(row);groups.set(row[key],group);}
  return groups;
}

function actorError(message,code,status=400) {return Object.assign(new Error(message),{status,code,accepted:false});}
