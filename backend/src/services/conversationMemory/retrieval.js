import { listMemoryRecords, listMemoryEntities, listCurrentMemoryClaims, getMemoryMessage, getMemoryState } from '../../repositories/conversationMemoryRepository.js';
import { conversationRecallTerms, buildFtsQuery } from '../fullTextSearch.js';
import { memoryHash } from '../../domain/conversationMemory/contracts.js';
import { listMemoryLexicalCandidates, getMemoryHistoryOrder } from '../../repositories/conversationMemoryContextRepository.js';

/** Resolve a selected history cutoff. Missing anchors fail closed instead of reading the tip. */
export function memoryReadScope(database, userId, conversationId, options = {}) {
  let asOfOrder = getMemoryHistoryOrder(database, userId, conversationId);
  if (options.asOfMessageId) {
    const message = getMemoryMessage(database, userId, conversationId, options.asOfMessageId);
    if (!message) throw Object.assign(new Error('记忆历史节点不存在'), { status: 409, code: 'MEMORY_CUTOFF_INVALID', accepted: false });
    asOfOrder = Number(message.narrative_order) - (options.before ? 1 : 0);
  } else if (Number.isFinite(options.asOfOrder)) asOfOrder = options.asOfOrder;
  return { actorId: options.actorId || '', asOfOrder,
    ...(options.commitId !== undefined ? { commitId: options.commitId } : {}) };
}

/** Combine bounded lexical/entity/graph/vector candidates, then apply one canonical eligibility policy. */
export function retrieveMemoryContext(database, userId, conversationId, options = {}) {
  const scope = memoryReadScope(database, userId, conversationId, options);
  const terms = conversationRecallTerms(options.query);
  const entities = listMemoryEntities(database, userId, conversationId, scope);
  if (scope.actorId && !entities.some(entity => entity.id === scope.actorId && entity.kind === 'actor')) {
    throw Object.assign(new Error('严格视角需要选择此会话中有效的角色'), { status: 400, code: 'MEMORY_ACTOR_REQUIRED', accepted: false });
  }
  const reasons = new Map();
  const add = (id, reason, boost = 0) => {
    const entry = reasons.get(id) || { reasons: [], boost: 0 };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    entry.boost = Math.max(entry.boost, boost); reasons.set(id, entry);
  };
  const recent = listMemoryRecords(database, userId, conversationId, { ...scope, limit: 80 });
  recent.forEach(row => add(row.id, 'recent', 0.1));
  listMemoryRecords(database, userId, conversationId, { ...scope, layer: 'canon', limit: 64 })
    .forEach(row => add(row.id, 'pinned', 4));
  const fts = buildFtsQuery((terms.length ? terms.join(' ') : options.query) || '');
  const matched = entities.filter(entity => [entity.name,...(entity.aliases||[])].some(name =>
    terms.some(term => name.toLowerCase().includes(term)) || (options.query || '').includes(name)));
  const currentClaims = listCurrentMemoryClaims(database, userId, conversationId, scope)
    .filter(row => row.modality === 'assertion' && row.truth_status === 'established')
    .sort((a,b) => Number(matched.some(entity=>entity.id===b.subject_entity_id)) - Number(matched.some(entity=>entity.id===a.subject_entity_id))
      || b.valid_from-a.valid_from).slice(0,64);
  currentClaims.forEach(row => add(row.event_id, 'current_claim', 5));
  for (const row of listMemoryLexicalCandidates(database, userId, conversationId,
    { fts, terms, entityIds: matched.map(entity => entity.id) })) add(row.id, row.reason, row.boost);
  for (const hit of options.vectorHits || []) add(hit.sourceId || hit.id, 'vector', Number(hit.score || (2/(1+Number(hit.distance||0)))));
  const ids = [...reasons.keys()];
  const eligible = [];
  for(let offset=0;offset<ids.length;offset+=500) eligible.push(...listMemoryRecords(database,userId,conversationId,
    {...scope,ids:ids.slice(offset,offset+500),limit:500}));
  const eligibleIds = new Set(eligible.map(row=>row.id));
  const candidates = eligible.filter(row=>eligibleIds.has(row.id)).map(row=>({
    ...row, score: (reasons.get(row.id)?.boost || 0) + row.importance * 1.5 + row.emotional_intensity * 0.2 +
      (row.layer==='canon'?3:0) + 0.25/(1+Math.max(0,(recent[0]?.narrative_order||0)-row.narrative_order)),
    reasons:reasons.get(row.id)?.reasons||[]
  })).sort((a,b)=>b.score-a.score||b.narrative_order-a.narrative_order||a.id.localeCompare(b.id));
  const limit = Math.max(1,Math.min(64,options.limit||24));
  const selected = []; let tokens = 0;
  const tokenLimit = Math.max(256,Number(options.tokenLimit)||4096);
  for (const row of candidates) {
    const estimated = Math.ceil(row.content.length/2)+24;
    if (selected.length>=limit || tokens+estimated>tokenLimit) continue;
    selected.push(row); tokens+=estimated;
  }
  const selectedIds=new Set(selected.map(row=>row.id));
  const entries=selected.map(row=>({id:row.memory_id||row.id,eventId:row.id,revision:row.memory_revision,memoryType:row.kind,content:row.content,
    narrativeOrder:row.narrative_order,truthStatus:row.truth_status,epistemicState:row.epistemicState||'',
    visibility:row.visibility,pinned:row.layer==='canon',score:row.score,reasons:row.reasons,sourceHash:row.source_hash}));
  const render = rows=>rows.map(row=>`[${row.kind}; ${row.truth_status}${row.epistemicState?`; actor ${row.epistemicState}`:''}; order ${row.narrative_order}] ${row.content}`).join('\n');
  // Current assertions have an explicit validity interval; historical events remain available as evidence below them.
  const claims=[];const claimLines=[];
  for(const row of currentClaims.filter(row=>selectedIds.has(row.event_id)).slice(0,24)) {
    const line=`[current assertion; valid from ${row.valid_from}] ${entities.find(entity=>entity.id===row.subject_entity_id)?.name||'subject'}: ${row.predicate} = ${JSON.stringify(row.value)}`;
    const estimated=Math.ceil(line.length/2);
    if(tokens+estimated>tokenLimit)continue;
    claims.push(row);claimLines.push(line);tokens+=estimated;
  }
  const claimContext=claimLines.join('\n');
  const unpinnedContext=[claimContext,render(selected.filter(row=>row.layer!=='canon'))].filter(Boolean).join('\n');
  const pinnedContext=render(selected.filter(row=>row.layer==='canon'));
  const liveState=getMemoryState(database,userId,conversationId);
  const checkpoint=options.memoryCheckpoint;
  const state=checkpoint?{...liveState,revision:checkpoint.revision,core_order:checkpoint.coreOrder,
    core_message_id:checkpoint.coreMessageId||'',core_message_revision:checkpoint.coreMessageRevision||0,
    core_commit_id:checkpoint.commitId||'',summary_order:0,index_order:0}:liveState;
  return { entries,context:[pinnedContext,unpinnedContext].filter(Boolean).join('\n'),pinnedContext,unpinnedContext,
    scope,claims,entities:scope.actorId?entities.filter(row=>row.id===scope.actorId||matched.some(entity=>entity.id===row.id)):entities,
    state,estimatedTokens:tokens,omitted:candidates.length-selected.length,
    manifest:candidates.map(row=>({id:row.id,included:selectedIds.has(row.id),reason:selectedIds.has(row.id)?row.reasons.join(','):'section_budget',score:row.score})),
    excluded:[...reasons.keys()].filter(id=>!eligibleIds.has(id)).map(id=>({id,reason:'ineligible_source_lifecycle_or_actor'})),
    fingerprint:memoryHash({scope,revision:state?.revision||0,selected:selected.map(row=>[row.id,row.source_hash])}) };
}
