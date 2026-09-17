import { getCharacter } from '../../modules/characters.js';
import { getStatusBar } from '../../modules/statusBars.js';
import { matchWorldBookEntries } from '../../modules/worldBooks.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { parseJson } from '../../utils/json.js';
import { nowIso } from '../../security.js';
import { getConversationForUser, toMessage } from '../../routes/helpers.js';
import { runAccessoryAgents } from '../accessoryAgents.js';
import { runConversationMemoryAgent } from '../conversationMemoryAgent.js';
import { projectConversationCast } from '../cast/castProjector.js';
import { publishCastSyncStatus } from '../cast/castSyncStatus.js';
import {
  captureConversationSnapshot, readSnapshotMessages, restoreConversationSnapshot, writeConversationCheckpoint
} from '../../repositories/conversationSnapshotRepository.js';
import { createConversationDatabaseFacade, withConversationMutationContext } from '../conversationMutationContext.js';
import { getJob, getConversationProcessingSummary } from './jobQueue.js';
import { hasUsableProvider } from '../providers.js';

export function assertConversationJobCurrent(database, job, payload, signal, options = {}) {
  if (!Number.isSafeInteger(payload.timelineRevision) || payload.timelineRevision < 1) {
    throw failure('Task predates versioned conversation inputs', 'JOB_SOURCE_UNVERSIONED');
  }
  if (!options.allowCancellation) signal?.throwIfAborted();
  const current = getJob(database, job.userId, job.id);
  if (!current || current.status !== 'running' || current.leaseOwner !== job.leaseOwner
    || current.attempt !== job.attempt || current.leaseExpiresAt <= Date.now()) {
    throw failure('Job lease was lost', 'JOB_LEASE_LOST', true);
  }
  if (current.cancelRequested && !options.allowCancellation) throw failure('Job was cancelled', 'JOB_CANCELLED');
  const conversation = database.prepare('SELECT timeline_revision FROM conversations WHERE id = ? AND user_id = ?')
    .get(payload.conversationId, job.userId);
  if (!conversation || (payload.timelineRevision && conversation.timeline_revision !== payload.timelineRevision)) {
    throw failure('Conversation history changed', 'JOB_SOURCE_STALE');
  }
  for (const [id, revision] of [[payload.assistantMessageId, payload.assistantRevision], [payload.userMessageId, payload.userRevision]]) {
    if (!id) continue;
    const message = database.prepare('SELECT revision FROM messages WHERE id = ? AND user_id = ? AND conversation_id = ?')
      .get(id, job.userId, payload.conversationId);
    if (!message || message.revision !== revision) throw failure('Source message changed', 'JOB_SOURCE_STALE');
  }
}

export async function runRecoverableConversationStep(database, environment, stepKey, operation) {
  const { job, payload, signal, progress = () => {} } = environment;
  let active = true;
  const assert = () => {
    if (!active) throw failure('Job step already settled', 'JOB_STEP_SETTLED');
    assertConversationJobCurrent(database, job, payload, signal);
  };
  assert();
  const stored = database.prepare('SELECT * FROM job_steps WHERE job_id = ? AND step_key = ?').get(job.id, stepKey);
  if (stored?.status === 'completed') {
    progress(50, { phase: stepKey, reused: true });
    return parseJson(stored.result_json, {});
  }
  const before = stored?.status === 'running' ? parseJson(stored.before_json, null)
    : captureConversationSnapshot(database, job.userId, payload.conversationId, { includeMessages: false });
  withSavepoint(database, 'sp_begin_conversation_job_step', () => {
    if (stored?.status === 'running') {
      restoreConversationSnapshot(database, job.userId, payload.conversationId, before, { restoreMessages: false, restoreSettings: false, preserveWorldBookState: stepKey !== 'lore' });
      database.prepare("UPDATE ai_tool_executions SET status = 'rolled_back' WHERE job_id = ? AND step_key = ? AND status = 'succeeded'")
        .run(job.id, stepKey);
    }
    database.prepare(`INSERT INTO job_steps (job_id, step_key, status, before_json, result_json, attempt, updated_at)
      VALUES (?, ?, 'running', ?, NULL, ?, ?) ON CONFLICT(job_id, step_key)
      DO UPDATE SET status = 'running', before_json = excluded.before_json, result_json = NULL, attempt = excluded.attempt, updated_at = excluded.updated_at`)
      .run(job.id, stepKey, JSON.stringify(before), job.attempt, nowIso());
  });
  progress(25, { phase: stepKey, recovered: Boolean(stored) });
  const guarded = createConversationDatabaseFacade(database);
  try {
    const result = await withConversationMutationContext({
      assert, database, userId: job.userId, conversationId: payload.conversationId,
      jobId: job.id, stepKey, attempt: job.attempt
    }, () => operation(guarded));
    assert();
    if (result?.ok === false) throw failure(result.error || result.status?.message || 'Agent step failed', result.code || 'AGENT_STEP_FAILED', result.retryable === true);
    database.prepare("UPDATE job_steps SET status = 'completed', result_json = ?, updated_at = ? WHERE job_id = ? AND step_key = ?")
      .run(JSON.stringify(result ?? {}), nowIso(), job.id, stepKey);
    progress(75, { phase: stepKey, completed: true });
    return result;
  } catch (error) {
    try {
      assertConversationJobCurrent(database, job, payload, signal, { allowCancellation: true });
      withSavepoint(database, 'sp_rollback_conversation_job_step', () => {
        restoreConversationSnapshot(database, job.userId, payload.conversationId, before, { restoreMessages: false, restoreSettings: false, preserveWorldBookState: stepKey !== 'lore' });
        database.prepare("UPDATE job_steps SET status = 'failed', updated_at = ? WHERE job_id = ? AND step_key = ?")
          .run(nowIso(), job.id, stepKey);
        database.prepare("UPDATE ai_tool_executions SET status = 'rolled_back' WHERE job_id = ? AND step_key = ? AND status = 'succeeded'")
          .run(job.id, stepKey);
      });
    } catch (rollbackError) {
      if (!['JOB_SOURCE_STALE', 'JOB_LEASE_LOST'].includes(rollbackError?.code)) throw rollbackError;
    }
    throw error;
  } finally {
    active = false;
  }
}

export async function runConversationPostprocessing(database, environment, options = {}) {
  const { job, payload, signal, progress } = environment;
  assertConversationJobCurrent(database, job, payload, signal);
  const conversation = getConversationForUser(database, job.userId, payload.conversationId, { includeUsage: false });
  const character = getCharacter(database, job.userId, conversation.characterId);
  const readMessage = (id) => {
    if (!id) return null;
    const row = database.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?')
      .get(id, conversation.id, job.userId);
    return row ? toMessage(row) : null;
  };
  const assistantMessage = readMessage(payload.assistantMessageId);
  const userMessage = readMessage(payload.userMessageId);
  const failures = [];
  const step = async (key, operation) => {
    try {
      return await runRecoverableConversationStep(database, environment, key, operation);
    } catch (error) {
      assertConversationJobCurrent(database, job, payload, signal);
      failures.push(error);
      return { ok: false, skill: key.replace(/^agent:/, ''), error: error.message, code: error.code };
    }
  };
  try {
    if (payload.replayLore) {
      await step('lore', (guarded) => {
        const messages = readSnapshotMessages(guarded, job.userId, conversation.id, assistantMessage.id).slice(0, -1);
        const entries = matchWorldBookEntries(guarded, character.id, messages.slice(-50).map((message) => message.content), { conversationId: conversation.id });
        writeConversationCheckpoint(guarded, job.userId, conversation.id, { id: `job:${job.id}`, throughMessageId: assistantMessage.id, kind: 'pending' });
        return { entries: entries.map((entry) => entry.id) };
      });
    }
    const memory = await step('memory', (guarded) => runConversationMemoryAgent({
      database: guarded, userId: job.userId, conversation, userMessage, assistantMessage,
      settings: options.settings, signal, config: options.config
    }));
    const skills = await (options.runAccessoryAgents || runAccessoryAgents)({
      db: createConversationDatabaseFacade(database), userId: job.userId, conversation, character, userMessage, assistantMessage,
      settings: options.settings, statusBar: getStatusBar(database, job.userId, conversation.id),
      signal, strictErrors: false,
      emit: (event, data) => progress(50, { phase: 'accessory', event, data }),
      runStep: (key, operation) => step(`agent:${key}`, operation)
    });
    const cast = await step('cast', (guarded) => !hasUsableProvider(options.settings) && !options.projectConversationCast
      ? { ok: true, skipped: true, reason: 'Provider unavailable' }
      : (options.projectConversationCast || projectConversationCast)({
      database: guarded, userId: job.userId, conversation, character, userMessage, assistantMessage,
      settings: options.settings, signal, idempotencyKey: `job:${job.id}:cast`, config: options.config,
      mainThinkingLevel: payload.thinkingLevel,
      mainThinkingEnabled: payload.thinkingEnabled,
      publish: (conversationId, state) => {
        try { assertConversationJobCurrent(database, job, payload, signal); } catch { return state; }
        return publishCastSyncStatus(conversationId, state);
      }
    }));
    assertConversationJobCurrent(database, job, payload, signal);
    if (cast.reviewRequired) failures.push(failure('部分人物同步条目未应用，已保留其余有效记录。', 'CAST_PLAN_PARTIAL'));
    if (failures.length) throw failures[0];
    withSavepoint(database, 'sp_finish_conversation_postprocess', () => {
      database.prepare("UPDATE messages SET postprocess_state = 'completed' WHERE id = ?").run(assistantMessage.id);
      const summary = getConversationProcessingSummary(database, job.userId, conversation.id);
      const partial = summary?.failedCount > 0 || ['needs_rebuild', 'stale', 'legacy_partial'].includes(conversation.stateStatus);
      database.prepare("UPDATE conversations SET state_status = ? WHERE id = ? AND state_status NOT IN ('needs_rebuild', 'stale', 'legacy_partial')")
        .run(summary?.pendingCount > 1 ? 'pending' : partial ? 'needs_review' : 'ready', conversation.id);
      writeConversationCheckpoint(database, job.userId, conversation.id, {
        id: `job:${job.id}`, throughMessageId: assistantMessage.id, stateStatus: partial ? 'needs_review' : 'ready',
        preserveWorldBookState: true
      });
    });
    return { conversationId: conversation.id, assistantMessageId: assistantMessage.id, memories: memory.memories?.length || 0,
      skills: skills.map((entry) => ({ skill: entry.skill, ok: entry.ok })),
      cast: { ok: cast.ok, skipped: Boolean(cast.skipped) },
      stateStatus: getConversationForUser(database, job.userId, conversation.id, { includeUsage: false }).stateStatus };
  } catch (error) {
    const current = database.prepare('SELECT timeline_revision FROM conversations WHERE id = ?').get(conversation.id);
    if (current?.timeline_revision === payload.timelineRevision) {
      database.prepare("UPDATE conversations SET state_status = 'needs_review' WHERE id = ? AND state_status NOT IN ('needs_rebuild', 'stale', 'legacy_partial')").run(conversation.id);
      database.prepare("UPDATE messages SET postprocess_state = 'failed' WHERE id = ?").run(assistantMessage.id);
    }
    throw error;
  }
}

function failure(message, code, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}
