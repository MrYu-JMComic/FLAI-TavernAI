import { normalizeMemoryPolicy, normalizeMemoryEmbedding } from '../../../../shared/memoryPolicy.js';
import { retrieveMemoryContext, memoryReadScope } from './retrieval.js';
import { memoryHash } from '../../domain/conversationMemory/contracts.js';
import { listMemoryRecords, iterateMemoryRecords, getMemoryState } from '../../repositories/conversationMemoryRepository.js';
import { listMemorySummaryCandidates } from '../../repositories/conversationMemoryContextRepository.js';
import { readMemoryShortTerm } from './shortTerm.js';
import { resolveMemoryProcessingPolicy } from './processingPolicy.js';

/** Build the immutable, versioned selection consumed by compilation, preview and evaluation. */
export function resolveMemoryContextSync(database, options = {}) {
  const { conversation = {}, user = {}, character = {} } = options;
  const skill=conversation.settings?.accessorySkills?.memoryAgent || {};
  const policy=normalizeMemoryPolicy(skill.memoryPolicy);
  const actorId=policy.isolation==='actor' ? policy.actorId : '';
  if (policy.isolation==='actor'&&!actorId) throw Object.assign(new Error('请先选择严格视角角色'),{status:400,code:'MEMORY_ACTOR_REQUIRED',accepted:false});
  const memory=retrieveMemoryContext(database,user.id,conversation.id,{
    query:options.content||options.history?.at(-1)?.content||'',actorId,
    asOfMessageId:options.asOfMessageId,before:options.beforeCutoff,asOfOrder:options.asOfOrder,commitId:options.commitId,memoryCheckpoint:options.memoryCheckpoint,
    limit:policy.recallLimit,tokenLimit:Math.min(8192,Math.floor(policy.unknownContextTokens*0.15)),vectorHits:options.vectorHits
  });
  const summaries=listMemorySummaryCandidates(database,user.id,conversation.id,memory.scope.asOfOrder).filter(summary=>{
      // Author summaries may state the truth behind a false belief. Actor views use scoped atomic propositions.
      if(memory.scope.actorId)return false;
      const dependencies=summary.dependencies;
      if (!dependencies.length) return false;
      const records=[];
      for(let offset=0;offset<dependencies.length;offset+=500) records.push(...listMemoryRecords(database,user.id,conversation.id,
        {...memory.scope,ids:dependencies.slice(offset,offset+500).map(row=>row.event_id),limit:500}));
      return records.length===dependencies.length && dependencies.every(dep=>records.some(row=>row.id===dep.event_id&&row.source_hash===dep.source_hash));
    }).slice(0,3);
  const summaryContext=summaries.map(row=>`[${row.level} summary; through ${row.end_order}] ${row.content}`).join('\n');
  if(summaryContext) {
    memory.unpinnedContext=[summaryContext,memory.unpinnedContext].filter(Boolean).join('\n');
    memory.context=[memory.pinnedContext,memory.unpinnedContext].filter(Boolean).join('\n');
  }
  const source={owner:user.id,conversation:conversation.id,timeline:conversation.timelineRevision,
    asOf:memory.scope.asOfOrder,commitId:memory.scope.commitId??memory.state?.core_commit_id??'',
    coreRevision:options.memoryCheckpoint?.revision??memory.state?.revision??0,
    coreOrder:options.memoryCheckpoint?.coreOrder??memory.state?.core_order??0,
    character:memoryHash(character),settings:memoryHash(conversation.settings||{}),preset:memoryHash(options.activePreset||{}),
    memory:memory.fingerprint,summary:summaries.map(row=>[row.id,row.source_hash])};
  const shortTerm = readMemoryShortTerm(database, user.id, conversation.id, {
    policy, coreOrder: source.coreOrder, asOfOrder: memory.scope.asOfOrder,
    enabled: resolveMemoryProcessingPolicy(database, user.id, conversation, { settings: options.providerSettings }).requiredStages.length > 0
  });
  source.shortTerm = shortTerm.messages.map(message => [message.id, message.revision]);
  return {version:1,source,fingerprint:memoryHash(source),memory,summaries,policy,actorId,shortTerm,
    isolation:actorId?'actor':'cast',vectorStatus:options.vectorStatus||'not_requested'};
}

/** Provider work stays outside transactions. Dry runs use cached vectors and never initiate paid queries. */
export async function resolveMemoryContext(database, options = {}) {
  const skill=options.conversation?.settings?.accessorySkills?.memoryAgent||{};
  const embedding=normalizeMemoryEmbedding(skill.embedding);
  let vectorHits=[]; let vectorStatus='disabled';
  if(embedding.enabled) {
    try {
      const {resolveEmbeddingProfile,searchMemoryVectors}=await import('../embeddings/index.js');
      const resolved=resolveEmbeddingProfile(database,options.user.id,embedding);
      const policy=normalizeMemoryPolicy(skill.memoryPolicy);
      const scope=memoryReadScope(database,options.user.id,options.conversation.id,{...options,
        before:options.beforeCutoff,actorId:policy.isolation==='actor'?policy.actorId:''});
      const eligible=[...iterateMemoryRecords(database,options.user.id,options.conversation.id,scope)].map(row=>row.id);
      const state=getMemoryState(database,options.user.id,options.conversation.id);
      const hits=await searchMemoryVectors(database,{userId:options.user.id,conversationId:options.conversation.id,
        ...resolved,query:options.content||'',signal:options.signal,allowProviderCall:options.allowProviderCall===true,
        eligibleSourceIds:eligible,actorId:scope.actorId,asOfOrder:scope.asOfOrder,sourceRevision:state?.revision||0,
        timelineRevision:options.conversation.timelineRevision});
      vectorHits=Array.isArray(hits)?hits:hits.hits||hits.results||[];
      vectorStatus=hits.reason||hits.status||'ready';
    } catch(error) {vectorStatus=`fallback:${error.code||'embedding_unavailable'}`;}
  }
  return resolveMemoryContextSync(database,{...options,vectorHits,vectorStatus});
}
