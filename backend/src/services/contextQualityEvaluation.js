import { performance } from 'node:perf_hooks';

import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { branchConversation } from '../modules/branches.js';
import { createConversationMemory, updateConversationMemory } from '../modules/conversationMemories.js';
import { captureConversationSnapshot, writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { extractConversationMemoryCandidates } from './conversationMemoryExtraction.js';
import { buildPromptPipeline } from './promptPipeline.js';
import { newId, nowIso } from '../security.js';
import { commitMemoryPacket, captureMemoryCheckpoint, restoreMemoryCheckpoint } from './conversationMemory/commit.js';
import { listMemoryRecords, listCurrentMemoryClaims, listCurrentMemoryThreads, resolveMemoryEntity } from '../repositories/conversationMemoryRepository.js';
import { retrieveMemoryContext } from './conversationMemory/retrieval.js';

export const CONTEXT_QUALITY_EVALUATION_KIND = 'deterministic_contract_evaluation';

export function runContextQualityEvaluation(options = {}) {
  const database = options.database || createAppDatabase(':memory:');
  const ownsDatabase = !options.database;
  const timings = [];
  try {
    const fixture = measure(timings, 'fixture', () => createEvaluationFixture(database));
    const cases = [
      measure(timings, 'memory_evidence', () => evaluateMemoryEvidence()),
      measure(timings, 'prompt_context', () => evaluatePromptContext(database, fixture)),
      measure(timings, 'branch_checkpoint', () => evaluateBranchCheckpoint(database, fixture)),
      measure(timings, 'actor_truth', () => evaluateActorTruth(database, fixture)),
      measure(timings, 'temporal_alias_graph', () => evaluateTemporalAliasGraph(database, fixture)),
      measure(timings, 'commit_lineage', () => evaluateCommitLineage(database, fixture)),
      measure(timings, 'continuity_state', () => evaluateContinuityState(database, fixture)),
      measure(timings, 'delayed_disclosure_threads', () => evaluateDelayedDisclosureThreads(database, fixture))
    ];
    const pipelineCase = cases.find((entry) => entry.id === 'prompt_context');
    const promptBudget = pipelineCase.details.promptBudget;
    const durations = timings.map((entry) => entry.elapsedMs);
    return {
      kind: CONTEXT_QUALITY_EVALUATION_KIND,
      version:3,
      description: 'Fixed in-memory contract checks against repository context and state functions; not a live-model semantic benchmark.',
      passed: cases.every((entry) => entry.passed),
      summary: {
        invariants: cases.reduce((sum, entry) => sum + entry.invariants.length, 0),
        failedInvariants: cases.flatMap((entry) => entry.invariants).filter((entry) => !entry.passed).length,
        retrieval: pipelineCase.details.retrieval,
        erroneousStateChanges: cases.reduce((sum, entry) => sum + Number(entry.details.erroneousStateChanges || 0), 0),
        secretLeaks: cases.reduce((sum, entry) => sum + Number(entry.details.secretLeaks || 0), 0),
        estimatedPromptTokens: promptBudget.tokens,
        promptCharacters: promptBudget.characters,
        elapsedMs: round(durations.reduce((sum, value) => sum + value, 0)),
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95)
      },
      cases,
      timings
    };
  } finally {
    if (ownsDatabase) database.close();
  }
}

function evaluateActorTruth(database,fixture) {
  const story=fixture.v1;
  const actor=key=>resolveMemoryEntity(database,fixture.userId,story.conversationId,key).id;
  const read=actorId=>listMemoryRecords(database,fixture.userId,story.conversationId,{actorId});
  const author=listMemoryRecords(database,fixture.userId,story.conversationId);
  const noel=read(actor('noel')); const outsider=read(actor('outsider')); const mira=read(actor('mira'));
  const noelText=noel.map(row=>row.content).join('\n'); const outsiderText=outsider.map(row=>row.content).join('\n');
  return result('actor_truth',[
    invariant('author_retains_actual_location',author.some(row=>row.content==='银钥匙实际藏在地窖。')),
    invariant('informed_actor_knows_actual_location',mira.some(row=>row.content==='银钥匙实际藏在地窖。')),
    invariant('false_belief_has_separate_text_and_truth_status',noel.some(row=>row.content==='诺埃尔相信银钥匙在阁楼。'&&row.epistemicState==='false_belief'&&row.truth_status==='false')),
    invariant('false_belief_does_not_leak_author_truth',!noelText.includes('地窖')),
    invariant('uninformed_actor_cannot_recall_secret',!outsiderText.includes('钥匙')),
    invariant('actor_cannot_read_author_only_plan',![...noel,...mira,...outsider].some(row=>row.content.includes('作者预定的背叛')))
  ],{secretLeaks:Number(noelText.includes('地窖'))+Number(outsiderText.includes('钥匙')),erroneousStateChanges:0});
}

function evaluateTemporalAliasGraph(database,fixture) {
  const story=fixture.v1; const owner=fixture.userId;
  const tower=resolveMemoryEntity(database,owner,story.conversationId,'旧塔');
  const canonical=resolveMemoryEntity(database,owner,story.conversationId,'月蚀钟楼');
  const claims=listCurrentMemoryClaims(database,owner,story.conversationId,{asOfOrder:story.order});
  const beforeReturn=claims.filter(row=>row.predicate==='star_chart_return');
  const rawPromise=database.prepare('SELECT * FROM memory_claims WHERE conversation_id=? AND predicate=?').all(story.conversationId,'promised_return');
  const retrieval=retrieveMemoryContext(database,owner,story.conversationId,{query:'旧塔的约定',limit:8});
  const graphHit=retrieval.entries.find(row=>row.content.includes('第三声钟响前归还星图'));
  return result('temporal_alias_graph',[
    invariant('portable_alias_resolves_one_entity',Boolean(tower&&canonical&&tower.id===canonical.id)),
    invariant('future_validity_does_not_change_current_state',beforeReturn.length===0),
    invariant('promise_modality_never_establishes_completed_fact',rawPromise.length===1&&rawPromise[0].modality==='promise'&&rawPromise[0].truth_status==='unverified'),
    invariant('entity_graph_recalls_the_evidenced_promise',Boolean(graphHit?.reasons.includes('entity_graph'))),
    invariant('same_turn_event_sequence_preserves_extraction_order',story.eventIds.every((id,index)=>database.prepare('SELECT event_sequence FROM memory_events WHERE id=?').get(id).event_sequence===index+1))
  ],{retrieval:retrievalMetrics(retrieval.entries.map(row=>row.eventId),[story.eventIds[1]]),erroneousStateChanges:beforeReturn.length,
    aliasEntityId:tower?.id||'',goldEventId:story.eventIds[1],selectedReasons:graphHit?.reasons||[]});
}

function evaluateCommitLineage(database,fixture) {
  const owner=fixture.userId; const conversationId=fixture.v1.conversationId;
  const memory=createConversationMemory(database,owner,conversationId,{subject:'守卫口令',content:'旧口令是白鹭。'});
  const early=captureMemoryCheckpoint(database,owner,conversationId);
  updateConversationMemory(database,owner,conversationId,memory.id,{revision:memory.revision,content:'新口令是黑潮。'});
  const later=captureMemoryCheckpoint(database,owner,conversationId);
  const atEarly=listMemoryRecords(database,owner,conversationId,{commitId:early.commitId}).map(row=>row.content);
  restoreMemoryCheckpoint(database,owner,conversationId,early);
  const restoredEarly=listMemoryRecords(database,owner,conversationId).map(row=>row.content);
  writeConversationCheckpoint(database,owner,conversationId);
  const branch=branchConversation(database,owner,conversationId,fixture.v1.messageId);
  const branchText=listMemoryRecords(database,owner,branch.id).map(row=>row.content);
  restoreMemoryCheckpoint(database,owner,conversationId,later);
  const restoredLater=listMemoryRecords(database,owner,conversationId).map(row=>row.content);
  const leaked=Number(atEarly.includes('新口令是黑潮。'))+Number(branchText.includes('新口令是黑潮。'));
  return result('commit_lineage',[
    invariant('same_order_pin_reads_selected_revision',atEarly.includes('旧口令是白鹭。')&&!atEarly.includes('新口令是黑潮。')),
    invariant('rewind_reselects_old_membership',restoredEarly.includes('旧口令是白鹭。')&&!restoredEarly.includes('新口令是黑潮。')),
    invariant('branch_copies_selected_ancestry_only',branchText.includes('旧口令是白鹭。')&&!branchText.includes('新口令是黑潮。')),
    invariant('later_checkpoint_can_be_selected_again',restoredLater.includes('新口令是黑潮。')&&!restoredLater.includes('旧口令是白鹭。'))
  ],{erroneousStateChanges:leaked,secretLeaks:leaked,earlyCommitId:early.commitId,laterCommitId:later.commitId});
}

/** Reads transfers and alliances at their actual story cutoff, then rejects an unresolved pronoun atomically. */
function evaluateContinuityState(database,fixture) {
  const owner=fixture.userId; const story=fixture.continuity; const conversationId=story.conversationId;
  const claims=options=>listCurrentMemoryClaims(database,owner,conversationId,options);
  const initialOwner=claims({asOfOrder:1,predicate:'owner'});
  const transferredOwner=claims({asOfOrder:2,predicate:'owner'});
  const currentOwner=claims({predicate:'owner'});
  const pinnedOwner=claims({commitId:story.openingCommitId,asOfOrder:1,predicate:'owner'});
  const allied=claims({asOfOrder:2,predicate:'allied_with'});
  const separated=claims({asOfOrder:3,predicate:'allied_with'});
  const pronoun=resolveMemoryEntity(database,owner,conversationId,'他');
  const counts=()=>database.prepare(`SELECT
    (SELECT COUNT(*) FROM memory_events WHERE conversation_id=?) AS events,
    (SELECT COUNT(*) FROM memory_claims WHERE conversation_id=?) AS claims,
    (SELECT COUNT(*) FROM memory_commits WHERE conversation_id=?) AS commits,
    (SELECT COUNT(*) FROM memory_source_versions WHERE conversation_id=?) AS sources`).get(conversationId,conversationId,conversationId,conversationId);
  const before=JSON.stringify({counts:counts(),checkpoint:captureMemoryCheckpoint(database,owner,conversationId)});
  let rejectedCode='';
  try {
    commitMemoryPacket(database,owner,conversationId,{
      messageId:story.ambiguousMessage.id,sources:[{messageId:story.ambiguousMessage.id,revision:1}],
      events:[{key:'unknown-pronoun',subjectEntityId:'他',content:'他把银钥匙藏了起来。',truthStatus:'established',
        evidence:[{messageId:story.ambiguousMessage.id,quote:'他把钥匙藏了起来'}]}]
    });
  } catch (error) { rejectedCode=error.code||''; }
  const unchanged=before===JSON.stringify({counts:counts(),checkpoint:captureMemoryCheckpoint(database,owner,conversationId)});
  const transferred=transferredOwner.length===1&&transferredOwner[0].object_entity_id===story.actors.noel
    &&transferredOwner[0].supersedes_id===story.initialOwnerClaimId;
  const currentCorrect=currentOwner.length===1&&currentOwner[0].object_entity_id===story.actors.noel;
  const allianceCorrect=separated.length===1&&separated[0].value===false&&separated[0].valid_from===3;
  return result('continuity_state',[
    invariant('object_initial_owner_visible_at_earlier_cutoff',initialOwner.length===1&&initialOwner[0].object_entity_id===story.actors.mira),
    invariant('object_transfer_supersedes_previous_owner',transferred),
    invariant('object_transfer_never_has_two_current_owners',currentCorrect),
    invariant('alliance_active_before_termination',allied.length===1&&allied[0].value===true&&allied[0].valid_to===3),
    invariant('alliance_terminated_at_validity_boundary',allianceCorrect),
    invariant('historical_owner_restored_by_selected_commit',pinnedOwner.length===1&&pinnedOwner[0].object_entity_id===story.actors.mira),
    invariant('pronoun_remains_unresolved',pronoun===null),
    invariant('ambiguous_pronoun_commit_rejected',rejectedCode==='MEMORY_ENTITY_UNRESOLVED'),
    invariant('ambiguous_pronoun_does_not_mutate_state',unchanged)
  ],{erroneousStateChanges:Number(!currentCorrect)+Number(!allianceCorrect)+Number(!unchanged),
    currentOwner:currentOwner.map(row=>row.value),allianceActive:separated.map(row=>row.value),rejectedCode});
}

/** Checks delayed recall, later disclosure and reversible clue resolution against the same Chinese story. */
function evaluateDelayedDisclosureThreads(database,fixture) {
  const owner=fixture.userId; const story=fixture.continuity; const conversationId=story.conversationId;
  const read=(actorId,asOfOrder)=>listMemoryRecords(database,owner,conversationId,{actorId,asOfOrder});
  const before=read(story.actors.noel,story.delayedOrder).find(row=>row.id===story.secretEventId);
  const after=read(story.actors.noel,story.disclosureOrder).find(row=>row.id===story.secretEventId);
  const outsider=read(story.actors.sailer,story.disclosureOrder).map(row=>row.content).join('\n');
  const retrieval=retrieveMemoryContext(database,owner,conversationId,{query:'旧塔的星图承诺',asOfOrder:story.delayedOrder,limit:8});
  const promise=retrieval.entries.find(row=>row.eventId===story.promiseEventId);
  const threadsAt=asOfOrder=>listCurrentMemoryThreads(database,owner,conversationId,{asOfOrder});
  const delayedPromise=threadsAt(story.delayedOrder).find(row=>row.thread_key==='return-chart');
  const earlierClue=threadsAt(story.disclosureOrder).find(row=>row.thread_key==='raven-clue');
  const solvedClue=threadsAt(story.resolutionOrder).find(row=>row.thread_key==='raven-clue');
  restoreMemoryCheckpoint(database,owner,conversationId,story.openClueCheckpoint);
  const reopened=listCurrentMemoryThreads(database,owner,conversationId).find(row=>row.thread_key==='raven-clue');
  restoreMemoryCheckpoint(database,owner,conversationId,story.resolvedClueCheckpoint);
  const restoredSolved=listCurrentMemoryThreads(database,owner,conversationId).find(row=>row.thread_key==='raven-clue');
  const beliefCorrect=before?.content==='诺埃尔相信密信在阁楼。'&&before.epistemicState==='false_belief'&&before.truth_status==='false';
  const knowledgeCorrect=after?.content==='密信实际藏在地窖。'&&after.epistemicState==='knows'&&after.truth_status==='established';
  const leaks=Number(Boolean(before?.content.includes('地窖')))+Number(outsider.includes('密信'));
  return result('delayed_disclosure_threads',[
    invariant('delayed_promise_recalled_after_twenty_rounds',story.delayedRounds===20&&story.delayedOrder>=43&&promise?.reasons.includes('entity_graph')),
    invariant('delayed_promise_remains_open_without_completion',delayedPromise?.status==='open'&&delayedPromise.resolved_event_id===null),
    invariant('false_belief_remains_before_disclosure',beliefCorrect),
    invariant('disclosure_replaces_belief_with_learned_truth',knowledgeCorrect),
    invariant('disclosure_does_not_reveal_secret_to_outsider',!outsider.includes('密信')),
    invariant('clue_is_open_before_evidence',earlierClue?.status==='open'&&earlierClue.resolved_event_id===null),
    invariant('clue_resolves_only_after_evidence',solvedClue?.status==='resolved'&&solvedClue.resolved_event_id===story.resolutionEventId),
    invariant('checkpoint_restore_reopens_previously_unresolved_clue',reopened?.status==='open'&&reopened.resolved_event_id===null),
    invariant('restoring_later_checkpoint_recovers_resolved_clue',restoredSolved?.status==='resolved'&&restoredSolved.resolved_event_id===story.resolutionEventId)
  ],{secretLeaks:leaks,erroneousStateChanges:Number(!beliefCorrect)+Number(!knowledgeCorrect),delayedRounds:story.delayedRounds,
    promiseMessageGap:story.delayedOrder-1,selectedReasons:promise?.reasons||[],disclosureOrder:story.disclosureOrder,resolutionOrder:story.resolutionOrder});
}

function evaluateMemoryEvidence() {
  const completed = extractConversationMemoryCandidates({ messages: [
    { id: 'completed-action', role: 'user', content: '我进入了月影港。米拉信任玩家。' }
  ] });
  const nonCompleted = extractConversationMemoryCandidates({ messages: [
    { id: 'intent', role: 'user', content: '我计划进入月影港。' },
    { id: 'hypothesis', role: 'user', content: '假设米拉拥有王室密钥。' }
  ] });
  const acceptedAction = completed.some((entry) => entry.sourceMessageId === 'completed-action'
    && (entry.memoryType === 'location' || entry.memoryType === 'event'));
  return result('memory_evidence', [
    invariant('explicit_user_action_accepted', acceptedAction),
    invariant('intent_not_completed_state', !nonCompleted.some((entry) => entry.sourceMessageId === 'intent')),
    invariant('hypothesis_not_completed_state', !nonCompleted.some((entry) => entry.sourceMessageId === 'hypothesis'))
  ], {
    acceptedCandidateIds: completed.map((entry) => entry.sourceMessageId),
    rejectedCandidateCount: nonCompleted.length,
    erroneousStateChanges: nonCompleted.length
  });
}

function evaluatePromptContext(database, fixture) {
  const { userId, otherUserId, conversationId, character, hiddenSecret, foreignSecret, oldMemory } = fixture;
  const history = Array.from({ length: 26 }, (_, index) => ({
    id: `history-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `普通往事 ${index}`,
    attachments: []
  }));
  const pipeline = buildPromptPipeline(database, {
    user: { id: userId, username: userId, displayName: 'Rowan' },
    conversation: database.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId),
    character: { ...character, ownerId: userId },
    history,
    content: '月蚀钟楼的约定是什么？',
    persistWorldBookState: false,
    tokenBudget: { inputTokenLimit: 200 }
  });
  const promptText = pipeline.messages.map((message) => String(message.content || '')).join('\n');
  const retrievedIds = pipeline.sections?.memory?.entries?.map((entry) => entry.id) || [];
  const goldIds = [oldMemory.id];
  const retrieval = retrievalMetrics(retrievedIds, goldIds);
  const promptBudget = resolvePromptBudget(pipeline);
  return result('prompt_context', [
    invariant('hidden_secret_excluded', !promptText.includes(hiddenSecret)),
    invariant('foreign_secret_excluded', !promptText.includes(foreignSecret)),
    invariant('older_relevant_memory_recalled', retrievedIds.includes(oldMemory.id)),
    invariant('recent_history_window_bounded',
      !promptText.includes('普通往事 0') && promptText.includes('普通往事 25')
      && pipeline.budget.truncated
      && pipeline.budget.conversationTokens <= pipeline.budget.tokenBudget.inputTokenLimit)
  ], {
    retrieval,
    goldMemoryIds: goldIds,
    retrievedMemoryIds: retrievedIds,
    secretLeaks: Number(promptText.includes(hiddenSecret)) + Number(promptText.includes(foreignSecret)),
    promptBudget
  });
}

function evaluateBranchCheckpoint(database, fixture) {
  const anchor = insertMessage(database, fixture.userId, fixture.conversationId, 'assistant', '月影港的旧篇章结束。');
  const checkpointMemory = createConversationMemory(database, fixture.userId, fixture.conversationId, {
    subject: '月影港', content: '分支点之前的记忆。', sourceMessageId: anchor.id
  });
  writeConversationCheckpoint(database, fixture.userId, fixture.conversationId);
  insertMessage(database, fixture.userId, fixture.conversationId, 'assistant', '未来篇章开始。');
  const futureMemory = createConversationMemory(database, fixture.userId, fixture.conversationId, {
    subject: '未来', content: '分支点之后才出现的未来记忆。'
  });
  const branch = branchConversation(database, fixture.userId, fixture.conversationId, anchor.id);
  const snapshot = captureConversationSnapshot(database, fixture.userId, branch.id);
  const contents = snapshot.state.conversation_memories.map((entry) => entry.content);
  return result('branch_checkpoint', [
    invariant('branch_keeps_checkpoint_memory', contents.includes(checkpointMemory.content)),
    invariant('branch_excludes_future_memory', !contents.includes(futureMemory.content))
  ], { erroneousStateChanges: contents.includes(futureMemory.content) ? 1 : 0 });
}

function createEvaluationFixture(database) {
  const userId = 'context-quality-owner';
  const otherUserId = 'context-quality-other';
  insertUser(database, userId);
  insertUser(database, otherUserId);
  const character = createCharacter(database, userId, { name: 'Archivist', persona: '守护故事时间线。' });
  const otherCharacter = createCharacter(database, otherUserId, { name: 'Foreign Archivist' });
  const conversationId = 'context-quality-conversation';
  const otherConversationId = 'context-quality-foreign-conversation';
  insertConversation(database, conversationId, userId, character.id);
  insertConversation(database, otherConversationId, otherUserId, otherCharacter.id);
  const hiddenSecret = 'HIDDEN-CONTRACT-SECRET-7F3A';
  createConversationMemory(database, userId, conversationId, { subject: '秘密', content: hiddenSecret, enabled: false });
  const foreignSecret = 'FOREIGN-CONTRACT-SECRET-9C2D';
  createConversationMemory(database, otherUserId, otherConversationId, { subject: '秘密', content: foreignSecret });
  const oldMemory = createConversationMemory(database, userId, conversationId, {
    subject: '月蚀钟楼', content: '月蚀钟楼的约定要求在第三声钟响前归还星图。', confidence: 0.95
  });
  const v1=createV1EvaluationFixture(database,userId,character.id);
  const continuity=createContinuityEvaluationFixture(database,userId,character.id);
  return { database, userId, otherUserId, conversationId, character, hiddenSecret, foreignSecret, oldMemory,v1,continuity };
}

function createV1EvaluationFixture(database,userId,characterId) {
  const conversationId='context-quality-v1-conversation';
  insertConversation(database,conversationId,userId,characterId);
  const source=insertMessage(database,userId,conversationId,'assistant','米拉把银钥匙藏进地窖，骗诺埃尔说钥匙在阁楼。米拉在月蚀钟楼承诺第三声钟响前归还星图。');
  const packet={version:1,messageId:source.id,sources:[{messageId:source.id,revision:1}],
    entities:[{key:'mira',castKey:'mira',name:'米拉',kind:'actor',aliases:['mira']},{key:'noel',castKey:'noel',name:'诺埃尔',kind:'actor',aliases:['noel']},
      {key:'outsider',castKey:'outsider',name:'局外人',kind:'actor',aliases:['outsider']},{key:'tower',name:'月蚀钟楼',kind:'place',aliases:['旧塔']}],
    events:[{key:'key',kind:'event',content:'银钥匙实际藏在地窖。',truthStatus:'established',visibility:'restricted',actorIds:['mira'],evidence:[{messageId:source.id,quote:'米拉把银钥匙藏进地窖'}]},
      {key:'promise',kind:'promise',subjectEntityId:'tower',participants:['mira'],content:'米拉承诺在第三声钟响前归还星图。',truthStatus:'established',evidence:[{messageId:source.id,quote:'米拉在月蚀钟楼承诺第三声钟响前归还星图'}]},
      {key:'author',kind:'hypothesis',content:'作者预定的背叛尚未发生。',visibility:'author',evidence:[{messageId:source.id,quote:''}]}],
    claims:[{eventKey:'promise',subjectKey:'mira',predicate:'promised_return',value:'星图',modality:'promise',truthStatus:'established'},
      {eventKey:'promise',subjectKey:'mira',predicate:'star_chart_return',value:'completed',modality:'intent',truthStatus:'unverified',validFrom:10}],
    knowledge:[{eventKey:'key',actorKey:'mira',epistemicState:'experienced'},{eventKey:'key',actorKey:'noel',epistemicState:'false_belief',beliefContent:'诺埃尔相信银钥匙在阁楼。'}]};
  const receipt=commitMemoryPacket(database,userId,conversationId,packet);
  return {conversationId,messageId:source.id,order:1,eventIds:receipt.eventIds};
}

/** Builds forty intervening messages and evidence-backed transitions without calling a provider. */
function createContinuityEvaluationFixture(database,userId,characterId) {
  const conversationId='context-quality-continuity-conversation';
  insertConversation(database,conversationId,userId,characterId);
  const turn=(content,packet={})=>{
    const source=insertMessage(database,userId,conversationId,'assistant',content);
    return commitMemoryPacket(database,userId,conversationId,{...packet,messageId:source.id,sources:[{messageId:source.id,revision:1}],
      events:(packet.events||[]).map(event=>({...event,evidence:[{messageId:source.id,quote:content}]}))});
  };
  const opening=turn('米拉保管银钥匙，并与诺埃尔约定结盟到黎明，一同调查旧塔。米拉把密信藏进地窖，却骗诺埃尔说密信在阁楼。米拉承诺在第三声钟响前归还星图。旧塔墙上有一枚无人解读的乌鸦印记。',{
    entities:[{key:'mira',name:'米拉',kind:'actor'},{key:'noel',name:'诺埃尔',kind:'actor'},{key:'sailer',name:'赛勒',kind:'actor'},
      {key:'key',name:'银钥匙',kind:'object'},{key:'tower',name:'月蚀钟楼',kind:'place',aliases:['旧塔']}],
    events:[{key:'possession',kind:'event',subjectKey:'key',content:'银钥匙由米拉保管。',truthStatus:'established'},
      {key:'alliance',kind:'relationship',subjectKey:'mira',participants:['noel'],content:'米拉与诺埃尔结盟到黎明。',truthStatus:'established'},
      {key:'secret',kind:'event',content:'密信实际藏在地窖。',truthStatus:'established',visibility:'restricted',actorIds:['mira']},
      {key:'promise',kind:'promise',subjectKey:'tower',participants:['mira'],content:'米拉承诺在第三声钟响前归还星图。',truthStatus:'unverified'},
      {key:'clue',kind:'event',subjectKey:'tower',content:'旧塔墙上的乌鸦印记尚未被解读。',truthStatus:'established'}],
    claims:[{eventKey:'possession',subjectKey:'key',predicate:'owner',objectKey:'mira',value:'米拉',truthStatus:'established'},
      {eventKey:'alliance',subjectKey:'mira',predicate:'allied_with',objectKey:'noel',value:true,truthStatus:'established',validTo:3}],
    knowledge:[{eventKey:'secret',actorKey:'mira',epistemicState:'experienced'},
      {eventKey:'secret',actorKey:'noel',epistemicState:'false_belief',beliefContent:'诺埃尔相信密信在阁楼。'}],
    threads:[{id:'return-chart',eventKey:'promise',kind:'promise',title:'归还星图',ownerKey:'mira',status:'open',resolutionTrigger:'米拉实际归还星图。'},
      {id:'raven-clue',eventKey:'clue',kind:'clue',title:'解读乌鸦印记',status:'open'}]
  });
  const actors=Object.fromEntries(['mira','noel','sailer'].map((key,index)=>[key,resolveMemoryEntity(database,userId,conversationId,['米拉','诺埃尔','赛勒'][index]).id]));
  const item=resolveMemoryEntity(database,userId,conversationId,'银钥匙').id;
  const tower=resolveMemoryEntity(database,userId,conversationId,'旧塔').id;
  const initial=listCurrentMemoryClaims(database,userId,conversationId);
  const initialOwnerClaimId=initial.find(row=>row.predicate==='owner').id;
  const initialAllianceClaimId=initial.find(row=>row.predicate==='allied_with').id;
  turn('米拉把银钥匙交给诺埃尔，诺埃尔接过钥匙。',{
    events:[{key:'transfer',subjectEntityId:item,participants:[actors.mira,actors.noel],content:'银钥匙已由米拉转交给诺埃尔保管。',truthStatus:'established'}],
    claims:[{eventKey:'transfer',subjectEntityId:item,predicate:'owner',objectEntityId:actors.noel,value:'诺埃尔',truthStatus:'established',supersedesId:initialOwnerClaimId}]
  });
  turn('黎明时，米拉与诺埃尔解除盟约，今后各自行动。',{
    events:[{key:'separation',kind:'relationship',subjectEntityId:actors.mira,participants:[actors.noel],content:'米拉与诺埃尔已解除盟约。',truthStatus:'established'}],
    claims:[{eventKey:'separation',subjectEntityId:actors.mira,predicate:'allied_with',objectEntityId:actors.noel,value:false,truthStatus:'established',supersedesId:initialAllianceClaimId}]
  });
  const delayedRounds=20;
  for(let index=1;index<=delayedRounds;index+=1) {
    insertMessage(database,userId,conversationId,'user',`第${index}轮，我继续沿河赶路，询问天气与驿站。`);
    turn(`第${index}轮，驿站掌柜谈起河面雾气，三人继续各自的旅程。`,{
      events:[{key:`road-${index}`,content:`第${index}轮的河道与驿站见闻。`,truthStatus:'established'}]
    });
  }
  const delayedOrder=captureMemoryCheckpoint(database,userId,conversationId).viewOrder;
  turn('诺埃尔在地窖亲眼找到了密信，确认米拉早先关于阁楼的说法是谎言。',{
    events:[{key:'disclosure',content:'诺埃尔亲眼确认密信在地窖。',truthStatus:'established',visibility:'restricted',actorIds:[actors.mira,actors.noel]}],
    knowledge:[{eventId:opening.eventIds[2],actorEntityId:actors.noel,epistemicState:'knows',learnedFromEventId:'disclosure'},
      {eventKey:'disclosure',actorEntityId:actors.noel,epistemicState:'experienced'}]
  });
  const openClueCheckpoint=captureMemoryCheckpoint(database,userId,conversationId);
  const resolution=turn('赛勒认出乌鸦印记指向北侧暗门，旧塔线索由此解开。',{
    events:[{key:'resolution',subjectEntityId:tower,participants:[actors.sailer],content:'乌鸦印记指向旧塔北侧暗门，线索已经解开。',truthStatus:'established'}],
    threads:[{id:'raven-clue',eventKey:'resolution',status:'resolved'}]
  });
  const resolvedClueCheckpoint=captureMemoryCheckpoint(database,userId,conversationId);
  const ambiguousMessage=insertMessage(database,userId,conversationId,'assistant','诺埃尔和赛勒两人站在门边。他把钥匙藏了起来。');
  return {conversationId,actors,initialOwnerClaimId,openingCommitId:opening.commitId,secretEventId:opening.eventIds[2],promiseEventId:opening.eventIds[3],
    resolutionEventId:resolution.eventIds[0],delayedRounds,delayedOrder,disclosureOrder:openClueCheckpoint.viewOrder,resolutionOrder:resolvedClueCheckpoint.viewOrder,
    openClueCheckpoint,resolvedClueCheckpoint,ambiguousMessage};
}

function insertUser(database, id) {
  database.prepare(`INSERT INTO users (id, username, password_hash, display_name, permission_group, is_root_admin, created_at)
    VALUES (?, ?, 'contract-evaluation', ?, 'user', 0, ?)`).run(id, id, id, nowIso());
}

function insertConversation(database, id, userId, characterId) {
  const timestamp = nowIso();
  database.prepare(`INSERT INTO conversations (id, user_id, character_id, title, state_status, created_at, updated_at)
    VALUES (?, ?, ?, 'Context quality contract', 'ready', ?, ?)`).run(id, userId, characterId, timestamp, timestamp);
}

function insertMessage(database, userId, conversationId, role, content) {
  const message = { id: newId(), role, content };
  database.prepare(`INSERT INTO messages
    (id, user_id, conversation_id, role, content, attachments_json, reasoning, usage_json, created_at)
    VALUES (?, ?, ?, ?, ?, '[]', '', NULL, ?)`).run(message.id, userId, conversationId, role, content, nowIso());
  return message;
}

function resolvePromptBudget(pipeline) {
  const budget = pipeline?.budget || pipeline?.promptBudget || {};
  const characters = finiteNumber(budget.characters, pipeline.messages.reduce((sum, message) => sum + String(message.content || '').length, 0));
  return {
    characters,
    tokens: finiteNumber(budget.tokens ?? budget.estimatedTokens, Math.ceil(characters / 4)),
    tokenEstimate: budget.tokenEstimate || budget.tokenizer || 'pipeline_or_character_estimate'
  };
}

function retrievalMetrics(retrievedIds, goldIds) {
  const retrieved = new Set(retrievedIds);
  const gold = new Set(goldIds);
  const truePositive = [...retrieved].filter((id) => gold.has(id)).length;
  return {
    recall: gold.size ? truePositive / gold.size : 1,
    precision: retrieved.size ? truePositive / retrieved.size : 1,
    truePositive,
    retrieved: retrieved.size,
    gold: gold.size
  };
}

function measure(timings, id, operation) {
  const started = performance.now();
  try { return operation(); }
  finally { timings.push({ id, elapsedMs: round(performance.now() - started) }); }
}

function invariant(id, passed) { return { id, passed: Boolean(passed) }; }
function result(id, invariants, details) { return { id, passed: invariants.every((entry) => entry.passed), invariants, details }; }
function finiteNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function round(value) { return Math.round(value * 1000) / 1000; }
function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
