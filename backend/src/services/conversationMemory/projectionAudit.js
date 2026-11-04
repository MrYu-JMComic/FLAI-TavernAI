import { newId, nowIso } from '../../security.js';
import { memoryHash,MemoryRevisionError } from '../../domain/conversationMemory/contracts.js';
import { ensureMemoryStateRow, getMemoryMessage, retainMemorySource, resolveMemoryEntity, insertMemoryEvent, insertMemoryEvidence, getCurrentMemoryEvent } from '../../repositories/conversationMemoryRepository.js';
import { isMemoryPacketCommit, invalidateMemoryDerived } from './commit.js';
import { getConversationForUser } from '../../routes/helpers.js';
import { getSelectedProviderProfileRow } from '../../repositories/providerProfileRepository.js';
import { hasUsableProvider, providerWithSecret } from '../providers.js';
import { resolveAccessorySkillSettings } from '../accessorySkillProvider.js';
import { enqueueMemoryDerivedJobs } from './derivedJobs.js';
import { readMemoryRevisionAssociations,readMemoryRevisionGraph,hasMemoryRevisionAssociations } from './revisionAssociations.js';
import { appendMemoryWorkbenchAssociations,listMemoryWorkbenchEvidence } from '../../repositories/conversationMemoryWorkbenchRepository.js';

/** Appends review corrections to the canonical log in the same savepoint as the editable projection. */
export function auditMemoryProjectionChanges(database,userId,conversationId,before,kind='manual') {
  if (isMemoryPacketCommit(database)) return;
  const state=ensureMemoryStateRow(database,userId,conversationId);
  const after=database.prepare('SELECT * FROM conversation_memories WHERE user_id=? AND conversation_id=?').all(userId,conversationId);
  const previous=new Map(before.map(row=>[row.id,row]));
  const changes=after.filter(row=>previous.get(row.id)?.revision!==row.revision);
  const currentIds=new Set(after.map(row=>row.id));
  const deleted=before.filter(row=>!currentIds.has(row.id));
  if (!changes.length&&!deleted.length) return;
  const oldEvents=new Map(changes.map(row=>[row.id,getCurrentMemoryEvent(database,userId,conversationId,row.id)]));
  const graph=readMemoryRevisionGraph(database,userId,conversationId);
  const associations=new Map(changes.filter(row=>oldEvents.get(row.id)).map(row=>[row.id,
    readMemoryRevisionAssociations(database,userId,conversationId,oldEvents.get(row.id).id,graph)]));
  const merging=new Set(changes.filter(row=>row.merged_into_id&&row.merged_into_id!==previous.get(row.id)?.merged_into_id)
    .flatMap(row=>[row.id,row.merged_into_id]));
  for(const row of changes) {
    const inherited=associations.get(row.id);
    if(!inherited||!hasMemoryRevisionAssociations(inherited))continue;
    if(merging.has(row.id))throw new MemoryRevisionError('包含结构化关系、知情、剧情线或领域记录的记忆不能以纯文本方式合并','MEMORY_STRUCTURED_MERGE_UNSAFE');
    if(['active','candidate'].includes(row.lifecycle)&&!sameStructuredScope(previous.get(row.id),row))
      throw new MemoryRevisionError('结构化记忆的角色、类型、真伪或知情范围应通过结构化修订更新','MEMORY_STRUCTURED_SCOPE_CHANGED');
  }
  const revision=state.revision+1; const commitId=newId(); const timestamp=nowIso();
  const packet={kind,changed:changes.map(row=>({id:row.id,revision:row.revision})),deleted:deleted.map(row=>row.id)};
  database.prepare(`INSERT INTO memory_commits(id,user_id,conversation_id,idempotency_key,packet_hash,timeline_revision,base_revision,revision,narrative_order,kind,receipt_json,created_at,parent_commit_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(commitId,userId,conversationId,`review:${commitId}`,memoryHash(packet),state.timeline_revision,state.revision,revision,state.core_order,kind,JSON.stringify(packet),timestamp,state.core_commit_id||null);
  const eventIds=[];
  for (const row of changes) {
    const old=oldEvents.get(row.id);
    const unchangedSubject=old&&previous.get(row.id)?.subject===row.subject;
    const entity=unchangedSubject?null:resolveMemoryEntity(database,userId,conversationId,row.subject,{rejectAmbiguous:true});
    const evidenceMatches=!old||(old.content===row.content&&listMemoryWorkbenchEvidence(database,userId,conversationId,old.id)
      .some(evidence=>evidence.source_kind==='message'&&evidence.message_id===row.source_message_id));
    const source=evidenceMatches&&row.source_message_id?getMemoryMessage(database,userId,conversationId,row.source_message_id):null;
    const order=old?state.core_order:source?.narrative_order??state.core_order;
    const event=insertMemoryEvent(database,userId,conversationId,{
      memoryId:row.id,memoryRevision:row.revision,kind:old&&previous.get(row.id)?.memory_type===row.memory_type?old.kind:row.memory_type,content:row.content,
      subjectEntityId:unchangedSubject?old.subject_entity_id:entity?.id||null,
      participants:old?JSON.parse(old.participants_json):[],actorIds:JSON.parse(row.actor_ids_json||'[]'),
      locationEntityId:old?.location_entity_id||null,narrativeTime:old?.narrative_time||'',
      visibility:row.visibility||old?.visibility||'public',truthStatus:row.truth_status||old?.truth_status||'unverified',
      lifecycle:row.lifecycle,confidence:row.confidence,importance:row.importance,emotionalIntensity:row.emotional_intensity,
      layer:row.pinned?'canon':['working','current','history'].includes(row.layer)?row.layer:'history',supersedesId:old?.id||null
    },commitId,order);
    eventIds.push(event.id);
    const evidenceId=insertMemoryEvidence(database,userId,conversationId,event.id,source?retainMemorySource(database,userId,conversationId,source):null,source?row.source_excerpt:'',source?'quote':'author');
    if(old&&['active','candidate'].includes(old.lifecycle)&&['active','candidate'].includes(event.lifecycle))
      appendMemoryWorkbenchAssociations(database,userId,conversationId,event.id,commitId,order,associations.get(row.id),evidenceId);
  }
  for (const row of deleted) {
    const old=getCurrentMemoryEvent(database,userId,conversationId,row.id);
    if (old) insertMemoryEvent(database,userId,conversationId,{memoryId:row.id,memoryRevision:row.revision+1,kind:'deletion',content:old.content,lifecycle:'rejected',supersedesId:old.id},commitId,state.core_order);
  }
  invalidateMemoryDerived(database,userId,conversationId,eventIds);
  database.prepare('UPDATE conversation_memory_state SET revision=?,core_commit_id=?,updated_at=? WHERE user_id=? AND conversation_id=?').run(revision,commitId,timestamp,userId,conversationId);
  const conversation=getConversationForUser(database,userId,conversationId,{includeUsage:false});
  const skill=conversation?.settings?.accessorySkills?.memoryAgent||{};
  const main=providerWithSecret(getSelectedProviderProfileRow(database,userId)||{});
  const resolved=resolveAccessorySkillSettings(database,userId,main,skill);
  const summaryEnabled=skill.enabled!==false&&skill.memoryPolicy?.mode!=='raw'&&skill.memoryPolicy?.summaryEnabled!==false&&hasUsableProvider(resolved.settings)&&resolved.settings.providerType!=='mock';
  const indexEnabled=skill.embedding?.enabled===true;
  if(summaryEnabled||indexEnabled) enqueueMemoryDerivedJobs(database,userId,conversationId,{commitId,revision,coreOrder:state.core_order},{summaryEnabled,indexEnabled});
}

/** Text, confidence and pin edits preserve graph meaning; scope changes require an explicit structured packet. */
function sameStructuredScope(before,after) {
  if(!before)return true;
  const audience=row=>JSON.stringify([...JSON.parse(row.actor_ids_json||'[]')].sort());
  return before.subject===after.subject&&before.memory_type===after.memory_type&&before.truth_status===after.truth_status
    &&before.visibility===after.visibility&&audience(before)===audience(after);
}
