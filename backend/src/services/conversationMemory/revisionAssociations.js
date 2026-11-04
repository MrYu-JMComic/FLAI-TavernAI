import { iterateMemoryRecords,listCurrentMemoryKnowledge,listCurrentMemoryThreads } from '../../repositories/conversationMemoryRepository.js';
import { listMemoryWorkbenchEventClaims,listMemoryWorkbenchDomainRefs } from '../../repositories/conversationMemoryWorkbenchRepository.js';

/** Read typed dependents once for either packet-based or legacy review text revisions; temporal claims retain their intervals. */
export function readMemoryRevisionAssociations(database,userId,conversationId,eventId,graph=null) {
  const {events,knowledge,threads}=graph||readMemoryRevisionGraph(database,userId,conversationId);
  return {
    claims:listMemoryWorkbenchEventClaims(database,userId,conversationId,eventId,events.map(row=>row.id)).map(row=>({
      subjectEntityId:row.subject_entity_id,objectEntityId:row.object_entity_id,predicate:row.predicate,value:row.value,
      modality:row.modality,polarity:row.polarity,truthStatus:row.truth_status,validFrom:row.valid_from,validTo:row.valid_to,supersedesId:row.id})),
    knowledge:knowledge.filter(row=>row.event_id===eventId).map(row=>({actorEntityId:row.actor_entity_id,
      epistemicState:row.epistemic_state,beliefContent:row.belief_content,learnedOrder:row.learned_order,
      ...(row.learned_from_event_id&&row.learned_from_event_id!==eventId?{learnedFromEventId:row.learned_from_event_id}:{})})),
    threads:threads.filter(row=>row.event_id===eventId).map(row=>({id:row.thread_key||row.id,kind:row.kind,
      title:row.title,status:row.status,ownerEntityId:row.owner_entity_id,resolutionTrigger:row.resolution_trigger,createdOrder:row.created_order})),
    domainRefs:listMemoryWorkbenchDomainRefs(database,userId,conversationId,[eventId]).map(row=>({domain:row.domain,
      recordId:row.record_id,revision:row.revision,outcome:JSON.parse(row.outcome_json)}))
  };
}

/** Reuse the visible graph for multi-record review operations instead of rescanning the log per row. */
export function readMemoryRevisionGraph(database,userId,conversationId) {
  return {events:[...iterateMemoryRecords(database,userId,conversationId,{includeCandidates:true})],
    knowledge:listCurrentMemoryKnowledge(database,userId,conversationId),threads:listCurrentMemoryThreads(database,userId,conversationId)};
}

/** Bind a single inherited bundle to a new packet event key without altering its typed data. */
export function bindMemoryRevisionAssociations(associations,eventKey) {
  return Object.fromEntries(Object.entries(associations).map(([section,rows])=>[section,rows.map(row=>({eventKey,...row}))]));
}

/** Structured dependents make cross-record merges or semantic-scope edits unsafe for a plain text reviewer. */
export function hasMemoryRevisionAssociations(associations) {return Object.values(associations).some(rows=>rows.length);}
