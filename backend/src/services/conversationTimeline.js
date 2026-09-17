import { newId, nowIso } from '../security.js';
import { withSavepoint } from '../modules/savepoint.js';
import {
  captureConversationSnapshot, clearConversationSnapshotState, findConversationCheckpoint,
  readSnapshotConversation, readSnapshotMessages, restoreConversationSnapshot, writeConversationCheckpoint
} from '../repositories/conversationSnapshotRepository.js';
import {
  cancelConversationJobs, CONVERSATION_POSTPROCESS_JOB, getActiveConversationJob, submitJob
} from './jobs/jobQueue.js';
import { unwrapConversationDatabase } from './conversationMutationContext.js';
import { pruneConversationDerivedStorage } from './conversationRetention.js';
import { THINKING_LEVELS } from '../../../shared/providerThinking.js';

const generationControllers = new WeakMap();

export function assertConversationIdle(database, userId, conversationId, options = {}) {
  const conversation = readSnapshotConversation(database, userId, conversationId);
  if (!conversation) throw timelineError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
  const job = getActiveConversationJob(database, userId, conversationId);
  // Post-processing is background work and must not lock the composer.
  if (job && job.id !== options.allowJobId && options.allowActiveJob !== true) {
    throw Object.assign(timelineError('剧情状态正在同步，请等待完成或先取消同步任务。', 'CONVERSATION_STATE_PENDING'), { jobId: job.id });
  }
  if (conversation.active_generation_id && conversation.generation_expires_at > Date.now() && !options.allowGeneration) {
    throw timelineError('该对话正在生成回复，请等待完成后再试。', 'CONVERSATION_GENERATING');
  }
  return conversation;
}

export function beginConversationGeneration(database, userId, conversationId, options = {}) {
  database = unwrapConversationDatabase(database);
  return withSavepoint(database, 'sp_begin_conversation_generation', () => {
    const conversation = assertConversationIdle(database, userId, conversationId, { allowActiveJob: options.backgroundSafe === true });
    if (conversation.state_status === 'needs_rebuild' && !options.backgroundSafe) {
      throw timelineError('剧情历史已修改，请先同步状态或确认保留当前状态。', 'CONVERSATION_STATE_REBUILD_REQUIRED');
    }
    const id = options.backgroundSafe ? `chat:${newId()}` : newId();
    const controller = new AbortController();
    let controllers = generationControllers.get(database);
    if (!controllers) generationControllers.set(database, controllers = new Map());
    controllers.set(conversationId, { id, controller });
    database.prepare('UPDATE conversations SET active_generation_id = ?, generation_expires_at = ? WHERE id = ?')
      .run(id, Date.now() + 330_000, conversationId);
    return {
      id, conversationId, userId, revision: conversation.timeline_revision, signal: controller.signal,
      checkpointId: ['ready', 'legacy'].includes(conversation.state_status)
        ? writeConversationCheckpoint(database, userId, conversationId, { kind: conversation.state_status === 'legacy' ? 'adopted' : 'before' }) : ''
    };
  });
}

export function endConversationGeneration(database, ticket) {
  database = unwrapConversationDatabase(database);
  if (!ticket) return;
  database.prepare('UPDATE conversations SET active_generation_id = ?, generation_expires_at = NULL WHERE id = ? AND active_generation_id = ?')
    .run('', ticket.conversationId, ticket.id);
  const controllers = generationControllers.get(database);
  if (controllers?.get(ticket.conversationId)?.id === ticket.id) controllers.delete(ticket.conversationId);
}

export function assertCurrentGeneration(database, ticket) {
  database = unwrapConversationDatabase(database);
  if (!ticket) return;
  const conversation = readSnapshotConversation(database, ticket.userId, ticket.conversationId);
  if (!conversation || conversation.timeline_revision !== ticket.revision || conversation.active_generation_id !== ticket.id) {
    throw timelineError('对话历史已经变化，本次旧回复未写入。', 'CONVERSATION_TIMELINE_CHANGED');
  }
}

export function invalidateConversationTimeline(database, userId, conversationId, status = 'stale') {
  database = unwrapConversationDatabase(database);
  const conversation = readSnapshotConversation(database, userId, conversationId);
  if (!conversation) throw timelineError('Conversation not found', 'CONVERSATION_NOT_FOUND', 404);
  generationControllers.get(database)?.get(conversationId)?.controller.abort(
    timelineError('Conversation history changed', 'CONVERSATION_TIMELINE_CHANGED')
  );
  cancelConversationJobs(database, userId, conversationId);
  database.prepare(`UPDATE conversations SET timeline_revision = timeline_revision + 1, state_status = ?,
    active_generation_id = '', generation_expires_at = NULL WHERE id = ? AND user_id = ?`).run(status, conversationId, userId);
  return readSnapshotConversation(database, userId, conversationId).timeline_revision;
}

export function enqueueConversationPostprocessing(database, userId, conversationId, assistantMessageId, options = {}) {
  const conversation = readSnapshotConversation(database, userId, conversationId);
  if (!conversation) return null;
  const messages = readSnapshotMessages(database, userId, conversationId);
  const index = messages.findIndex((message) => message.id === assistantMessageId && message.role === 'assistant');
  if (index < 0 || !String(messages[index].content || '').trim()) return null;
  const assistant = messages[index];
  let user = null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor].role === 'user') { user = messages[cursor]; break; }
  }
  const payload = {
    conversationId, timelineRevision: conversation.timeline_revision,
    assistantMessageId, assistantRevision: assistant.revision,
    userMessageId: user?.id || '', userRevision: user?.revision || 0,
    replayLore: options.replayLore === true
  };
  const thinkingLevel = optionalThinkingLevel(options.thinkingLevel);
  if (thinkingLevel) {
    payload.thinkingLevel = thinkingLevel;
    payload.thinkingEnabled = thinkingLevel !== 'off';
  } else if (typeof options.thinkingEnabled === 'boolean') {
    payload.thinkingEnabled = options.thinkingEnabled;
  }
  const job = submitJob(database, userId, CONVERSATION_POSTPROCESS_JOB, payload, {
    internal: true,
    idempotencyKey: `postprocess:${conversationId}:${conversation.timeline_revision}:${assistantMessageId}:${assistant.revision}`
  });
  database.prepare("UPDATE messages SET postprocess_state = 'queued' WHERE id = ?").run(assistantMessageId);
  if (!job.deduplicated) {
    writeConversationCheckpoint(database, userId, conversationId, {
      id: `job:${job.id}`, throughMessageId: assistantMessageId, kind: 'pending'
    });
  }
  database.prepare("UPDATE conversations SET state_status = 'pending' WHERE id = ? AND state_status NOT IN ('needs_rebuild', 'stale', 'legacy_partial')").run(conversationId);
  return job;
}

export function prepareConversationHistoryChange(database, userId, conversationId, messageId, options = {}) {
  const checkpoint = findConversationCheckpoint(database, userId, conversationId, messageId, { before: true });
  let recoverySaveId = '';
  // Switching or regenerating a candidate keeps the previous text as a swipe, so those callers skip the snapshot.
  if (options.recoverySave !== false) {
    const recovery = captureConversationSnapshot(database, userId, conversationId);
    recoverySaveId = newId();
    database.prepare(`INSERT INTO saves (id, conversation_id, user_id, name, snapshot, preview, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'recovery', ?)`)
      .run(recoverySaveId, conversationId, userId, '历史修改前的恢复点', JSON.stringify(recovery), '自动恢复点', nowIso());
    pruneConversationDerivedStorage(database, userId, conversationId, { jobSteps: false });
  }
  invalidateConversationTimeline(database, userId, conversationId);
  return { checkpoint, recoverySaveId };
}

export function finishConversationHistoryChange(database, userId, conversationId, prepared, options = {}) {
  if (prepared.checkpoint) {
    restoreConversationSnapshot(database, userId, conversationId, prepared.checkpoint.snapshot, { restoreMessages: false, restoreSettings: false });
  } else {
    clearConversationSnapshotState(database, userId, conversationId);
  }
  const rows = readSnapshotMessages(database, userId, conversationId);
  const anchorIndex = prepared.checkpoint?.anchor_message_id
    ? rows.findIndex((message) => message.id === prepared.checkpoint.anchor_message_id)
    : -1;
  const remaining = rows.slice(anchorIndex + 1).filter((message) => message.role === 'assistant' && String(message.content || '').trim());
  let job = null;
  if (remaining.length === 1) {
    job = enqueueConversationPostprocessing(database, userId, conversationId, remaining[0].id, {
      ...(options.postprocessOptions || {}),
      replayLore: true
    });
  } else {
    database.prepare('UPDATE conversations SET state_status = ? WHERE id = ?')
      .run(remaining.length ? 'needs_rebuild' : prepared.checkpoint ? 'ready' : 'legacy_partial', conversationId);
    if (!remaining.length) writeConversationCheckpoint(database, userId, conversationId, { kind: 'after' });
  }
  return {
    recoverySaveId: prepared.recoverySaveId, stateStatus: readSnapshotConversation(database, userId, conversationId).state_status,
    rebuildCount: remaining.length, postprocessJobId: job?.id || '',
    warnings: prepared.checkpoint ? [] : ['没有可用的历史状态快照，未继承当前人物、物品或经济状态。']
  };
}

export function requestConversationStateRebuild(database, userId, conversationId, options = {}) {
  if (options.acceptCurrent === true) {
    invalidateConversationTimeline(database, userId, conversationId, 'ready');
    writeConversationCheckpoint(database, userId, conversationId);
    return { stateStatus: 'ready', jobs: [] };
  }
  assertConversationIdle(database, userId, conversationId);
  const checkpoint = findConversationCheckpoint(database, userId, conversationId, '');
  const messages = readSnapshotMessages(database, userId, conversationId);
  const after = checkpoint?.index ?? -1;
  const candidates = messages.slice(after + 1).filter((message) => message.role === 'assistant' && String(message.content || '').trim());
  if (options.confirmed !== true) return { stateStatus: 'needs_rebuild', confirmationRequired: true, turnCount: candidates.length };
  return withSavepoint(database, 'sp_rebuild_conversation_state', () => {
    invalidateConversationTimeline(database, userId, conversationId, 'pending');
    if (checkpoint) restoreConversationSnapshot(database, userId, conversationId, checkpoint.snapshot, { restoreMessages: false, restoreSettings: false });
    else clearConversationSnapshotState(database, userId, conversationId);
    const jobs = candidates.map((message) => enqueueConversationPostprocessing(database, userId, conversationId, message.id, { replayLore: true }));
    if (!jobs.length) database.prepare("UPDATE conversations SET state_status = 'ready' WHERE id = ?").run(conversationId);
    return { stateStatus: jobs.length ? 'pending' : 'ready', jobs };
  });
}

export function recoverInterruptedGenerations(database) {
  database.prepare("UPDATE conversations SET active_generation_id = '', generation_expires_at = NULL WHERE active_generation_id <> ''").run();
}

function timelineError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status, publicMessage: message, accepted: false });
}

function optionalThinkingLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : '';
}
