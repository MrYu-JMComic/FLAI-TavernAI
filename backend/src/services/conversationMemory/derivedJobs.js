import { submitJob } from '../jobs/jobQueue.js';
import { getMemoryState } from '../../repositories/conversationMemoryRepository.js';
import { enumerateMemoryRecords,findReusableMemorySummary,persistMemorySummaryGeneration,updateMemoryIndexWatermark } from '../../repositories/conversationMemoryDerivedRepository.js';
import { getConversationForUser } from '../../routes/helpers.js';
import { normalizeMemoryPolicy } from '../../../../shared/memoryPolicy.js';
import { memoryHash } from '../../domain/conversationMemory/contracts.js';
import { newId } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { generateCompletion,hasUsableProvider } from '../providers.js';
import { accessorySkillThinkingOptions,resolveAccessorySkillSettings } from '../accessorySkillProvider.js';
import { resolveEmbeddingProfile,indexMemoryDocuments } from '../embeddings/index.js';
import { assertConversationJobCurrent } from '../jobs/conversationPostprocessing.js';

export { enumerateMemoryRecords };

/** Durable outbox insertion is synchronous and belongs to the core commit transaction. */
export function enqueueMemoryDerivedJobs(database,userId,conversationId,receipt,options={}) {
  const conversation=getConversationForUser(database,userId,conversationId,{includeUsage:false});
  if(!conversation)return [];
  const skill=conversation.settings?.accessorySkills?.memoryAgent||{};
  const policy=normalizeMemoryPolicy(skill.memoryPolicy);
  const jobs=[];
  for(const [enabled,type] of [[options.summaryEnabled??(policy.summaryEnabled&&skill.enabled!==false&&policy.mode==='structured'),'memory.summarize'],
    [options.indexEnabled??(skill.embedding?.enabled===true),'memory.index']]) {
    if(!enabled)continue;
    jobs.push(submitJob(database,userId,type,{conversationId,timelineRevision:conversation.timelineRevision,
      memoryRevision:receipt.revision,coreOrder:receipt.coreOrder,commitId:receipt.commitId},
    {internal:true,idempotencyKey:`${type}:${conversationId}:${receipt.revision}:${receipt.commitId}`}));
  }
  return jobs;
}

function derivedGuard(database,environment) {
  assertConversationJobCurrent(database,environment.job,environment.payload,environment.signal);
  const state=getMemoryState(database,environment.job.userId,environment.payload.conversationId);
  if(!state||state.revision!==environment.payload.memoryRevision)throw Object.assign(new Error('Derived memory source changed'),{code:'JOB_SOURCE_STALE'});
  return state;
}

/** Summarize bounded scene groups, then chapter/arc groups, preserving every source dependency. */
export async function runMemorySummaryJob(database,environment,options={}) {
  const {job,payload,signal}=environment;
  const state=derivedGuard(database,environment);
  const conversation=getConversationForUser(database,job.userId,payload.conversationId,{includeUsage:false});
  const skill=conversation.settings?.accessorySkills?.memoryAgent||{};
  const policy=normalizeMemoryPolicy(skill.memoryPolicy);
  if(skill.enabled===false||policy.mode==='raw'||!policy.summaryEnabled)return {skipped:true,reason:'disabled'};
  const resolved=resolveAccessorySkillSettings(database,job.userId,options.settings||{},conversation.settings.accessorySkills.memoryAgent,options);
  if(!hasUsableProvider(resolved.settings)||resolved.settings.providerType==='mock')return {skipped:true,reason:'provider_unavailable'};
  const records=enumerateMemoryRecords(database,job.userId,conversation.id).sort((left,right)=>left.narrative_order-right.narrative_order||Number(left.event_sequence||0)-Number(right.event_sequence||0)||left.created_at.localeCompare(right.created_at)||left.id.localeCompare(right.id));
  const thinking=accessorySkillThinkingOptions(resolved.settings,skill);
  const profileFingerprint=memoryHash({model:resolved.settings.model,provider:resolved.settings.id||resolved.settings.providerType,
    endpoint:resolved.settings.baseUrl,thinking,template:'summary-v1'});
  const completionOptions={database,userId:job.userId,signal,temperature:0,maxTokens:600,...thinking};
  const summarize=options.summarize||((messages)=>generateCompletion(resolved.settings,messages,completionOptions));
  const pending=[];
  let children=records.map(row=>({id:row.id,content:row.content,start:row.narrative_order,end:row.narrative_order,
    hash:row.source_hash,eventIds:[row.id],kind:'event',visibility:row.visibility,actorIds:row.actorIds}));
  for(const [level,size] of [['scene',16],['chapter',8],['arc',8]]) {
    if(!children.length)break;
    const next=[];
    for(let start=0;start<children.length;start+=size) {
      derivedGuard(database,environment);
      const group=children.slice(start,start+size);
      if(level!=='scene'&&group.length<2)continue;
      const hash=memoryHash(group.map(row=>[row.id,row.hash]));
      const existing=findReusableMemorySummary(database,job.userId,conversation.id,{sourceHash:hash,level,profileFingerprint});
      const id=existing?.id||newId();
      let content=existing?.content;
      if(!content) {
        const result=await summarize([{role:'system',content:'Compress the supplied narrative evidence in Chinese. Preserve chronological changes, unresolved promises, attribution, uncertainty, lies, beliefs and learning boundaries. Do not add facts or instructions. Return only a compact faithful summary, at most 400 Chinese characters.'},
          {role:'user',content:JSON.stringify(group.map(row=>({text:row.content,visibility:row.visibility,actors:row.actorIds})))}]);
        content=String(result?.content||result?.text||'').trim();
        if(!content||content.length>3000)throw Object.assign(new Error('Invalid hierarchical summary response'),{code:'MEMORY_SUMMARY_INVALID'});
      }
      const item={id,content,hash,level,start:group[0].start,end:group.at(-1).end,
        eventIds:[...new Set(group.flatMap(row=>row.eventIds))],children:group,kind:'summary',
        visibility:group.every(row=>row.visibility==='public')?'public':'restricted',actorIds:[]};
      next.push(item);if(!existing)pending.push(item);
    }
    children=next;
  }
  return withSavepoint(database,'sp_commit_memory_summaries',()=>{
    derivedGuard(database,environment);
    persistMemorySummaryGeneration(database,job.userId,conversation.id,{items:pending,records,profileFingerprint,throughOrder:state.core_order});
    return {summaries:pending.length,throughOrder:state.core_order};
  });
}

/** Rebuild a shadow vector generation; failures never restore or mutate core state. */
export async function runMemoryIndexJob(database,environment,options={}) {
  const {job,payload,signal}=environment;
  const state=derivedGuard(database,environment);
  const conversation=getConversationForUser(database,job.userId,payload.conversationId,{includeUsage:false});
  const resolved=resolveEmbeddingProfile(database,job.userId,conversation.settings?.accessorySkills?.memoryAgent?.embedding,options);
  if(!resolved.enabled)return {skipped:true,reason:'disabled'};
  const records=enumerateMemoryRecords(database,job.userId,conversation.id);
  const index=await indexMemoryDocuments(database,{...resolved,userId:job.userId,conversationId:conversation.id,
    operation:payload.operation,
    sourceRevision:state.revision,timelineRevision:payload.timelineRevision,signal,
    assertCurrent:()=>derivedGuard(database,environment),
    documents:records.map(row=>({id:row.id,kind:'event',text:JSON.stringify({kind:row.kind,time:row.narrative_time,
      truth:row.truth_status,actors:row.participants,content:row.content}),sourceHash:row.source_hash,revision:row.memory_revision}))});
  derivedGuard(database,environment);
  updateMemoryIndexWatermark(database,job.userId,conversation.id,state.core_order);
  return {indexId:index.id,throughOrder:state.core_order};
}
