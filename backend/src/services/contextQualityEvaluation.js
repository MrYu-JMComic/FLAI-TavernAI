import { performance } from 'node:perf_hooks';

import { createAppDatabase } from '../db.js';
import { createCharacter } from '../modules/characters.js';
import { branchConversation } from '../modules/branches.js';
import { createConversationMemory } from '../modules/conversationMemories.js';
import { captureConversationSnapshot, writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import {
  createCastMember,
  ensureConversationProtagonist,
  upsertCastMemberItem
} from './cast/castCommandService.js';
import { extractConversationMemoryCandidates } from './conversationMemoryExtraction.js';
import { buildPromptPipeline } from './promptPipeline.js';
import { newId, nowIso } from '../security.js';

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
      measure(timings, 'item_ownership', () => evaluateItemOwnership(database, fixture)),
      measure(timings, 'branch_checkpoint', () => evaluateBranchCheckpoint(database, fixture))
    ];
    const pipelineCase = cases.find((entry) => entry.id === 'prompt_context');
    const promptBudget = pipelineCase.details.promptBudget;
    const durations = timings.map((entry) => entry.elapsedMs);
    return {
      kind: CONTEXT_QUALITY_EVALUATION_KIND,
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
    contextBudgetCharacters: 32_000
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
    invariant('recent_history_window_bounded', !promptText.includes('普通往事 0') && promptText.includes('普通往事 25'))
  ], {
    retrieval,
    goldMemoryIds: goldIds,
    retrievedMemoryIds: retrievedIds,
    secretLeaks: Number(promptText.includes(hiddenSecret)) + Number(promptText.includes(foreignSecret)),
    promptBudget
  });
}

function evaluateItemOwnership(database, fixture) {
  const first = createCastMember(database, fixture.userId, fixture.conversationId, { canonicalName: 'Mira' });
  const second = createCastMember(database, fixture.userId, fixture.conversationId, { canonicalName: 'Sera' });
  const item = upsertCastMemberItem(database, fixture.userId, fixture.conversationId, first.id, {
    id: 'contract-silver-key', itemCode: 'CONTRACT-SILVER-KEY', name: 'Silver key', quantity: 1
  });
  let rejectedDuplicateOwner = false;
  try {
    upsertCastMemberItem(database, fixture.userId, fixture.conversationId, second.id, {
      id: item.id, itemCode: item.itemCode, name: item.name, quantity: 1
    });
  } catch {
    rejectedDuplicateOwner = true;
  }
  const rows = captureConversationSnapshot(database, fixture.userId, fixture.conversationId, {
    includeMessages: false
  }).state.scene_items.filter((entry) => entry.id === 'contract-silver-key');
  return result('item_ownership', [
    invariant('duplicate_owner_write_rejected', rejectedDuplicateOwner),
    invariant('item_has_exactly_one_owner', rows.length === 1 && rows[0].owner_member_id === first.id)
  ], { erroneousStateChanges: rows.length === 1 && rows[0].owner_member_id === first.id ? 0 : 1 });
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
  ensureConversationProtagonist(database, userId, conversationId);
  const hiddenSecret = 'HIDDEN-CONTRACT-SECRET-7F3A';
  createCastMember(database, userId, conversationId, {
    canonicalName: 'Veiled Witness', visibility: 'hidden', customStatus: hiddenSecret
  });
  const foreignSecret = 'FOREIGN-CONTRACT-SECRET-9C2D';
  createConversationMemory(database, otherUserId, otherConversationId, { subject: '秘密', content: foreignSecret });
  const oldMemory = createConversationMemory(database, userId, conversationId, {
    subject: '月蚀钟楼', content: '月蚀钟楼的约定要求在第三声钟响前归还星图。', confidence: 0.95
  });
  return { database, userId, otherUserId, conversationId, character, hiddenSecret, foreignSecret, oldMemory };
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
