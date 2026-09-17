import { appConfig } from '../config.js';
import { conversationJobKey } from './jobs/jobQueue.js';

const TERMINAL_JOB_STATUSES = ['succeeded', 'cancelled', 'failed'];

// Recovery saves, job step snapshots and pending checkpoints trade storage for
// rollback safety. This bounds that derived storage without touching data an
// active or retryable task can still use.
export function pruneConversationDerivedStorage(database, userId, conversationId, options = {}) {
  const limits = { ...appConfig.conversationRetention, ...(options.limits || {}) };
  const result = { recoverySaves: 0, jobSteps: 0, checkpoints: 0 };
  if (options.recoverySaves !== false) {
    const stale = database.prepare(
      `SELECT id FROM saves WHERE user_id = ? AND conversation_id = ? AND kind = 'recovery'
       ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?`
    ).all(userId, conversationId, Math.max(0, Number(limits.recoverySaveLimit) || 0));
    const remove = database.prepare('DELETE FROM saves WHERE id = ? AND user_id = ?');
    for (const row of stale) result.recoverySaves += remove.run(row.id, userId).changes;
  }
  if (options.jobSteps !== false) {
    const conversation = database.prepare('SELECT timeline_revision FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId);
    if (!conversation) return result;
    const cutoff = new Date(Date.now() - Math.max(0, Number(limits.staleJobStepDays) || 0) * 86_400_000).toISOString();
    // Succeeded jobs never retry. Failed or cancelled jobs whose source revision is gone can
    // only be repaired through a rebuild, so their per-step rollback snapshots are dead weight.
    const jobs = database.prepare(
      `SELECT id, status FROM jobs WHERE user_id = ? AND serial_key = ?
         AND status IN (${TERMINAL_JOB_STATUSES.map(() => '?').join(', ')})
         AND COALESCE(finished_at, updated_at) <= ?
         AND (status = 'succeeded' OR json_extract(payload_json, '$.timelineRevision') IS NOT ?)`
    ).all(userId, conversationJobKey(userId, conversationId), ...TERMINAL_JOB_STATUSES, cutoff, conversation.timeline_revision);
    const removeSteps = database.prepare('DELETE FROM job_steps WHERE job_id = ?');
    const removePending = database.prepare(
      "DELETE FROM conversation_checkpoints WHERE id = ? AND conversation_id = ? AND kind = 'pending'"
    );
    for (const job of jobs) {
      result.jobSteps += removeSteps.run(job.id).changes;
      result.checkpoints += removePending.run(`job:${job.id}`, conversationId).changes;
    }
  }
  return result;
}

export function sweepConversationDerivedStorage(database, options = {}) {
  const totals = { conversations: 0, recoverySaves: 0, jobSteps: 0, checkpoints: 0 };
  const rows = database.prepare('SELECT id, user_id FROM conversations').all();
  for (const row of rows) {
    const pruned = pruneConversationDerivedStorage(database, row.user_id, row.id, options);
    totals.conversations += 1;
    totals.recoverySaves += pruned.recoverySaves;
    totals.jobSteps += pruned.jobSteps;
    totals.checkpoints += pruned.checkpoints;
  }
  return totals;
}
