import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import {
  assertCastPlanPermissions,
  parseCastChangePlanText,
  validateCastChangePlan,
} from '../../domain/cast/changePlan.js';
import { CastDomainError, castForbidden, castNotFound } from '../../domain/cast/errors.js';
import {
  getCastChangeBatchByKey,
  getConversationEvidenceMessages,
  insertCastChangeBatch,
  updateCastChangeBatch,
} from '../../repositories/castRepository.js';
import { getCastItem } from '../../repositories/castItemRepository.js';
import {
  assertCastConversationAccess,
  createCastBehavior,
  createCastMember,
  createCastMemory,
  deleteCastBehaviorEntry,
  deleteCastMemberItem,
  deleteCastMemoryEntry,
  resolveCastMember,
  setCastMemberVisibility,
  transferCastItem,
  updateCastBehaviorEntry,
  updateCastMemberAppearance,
  updateCastMemberProfile,
  updateCastMemoryEntry,
  upsertCastMemberItem,
} from './castCommandService.js';

export function parseAndValidateCastPlan(text, options = {}) {
  const plan = parseCastChangePlanText(text);
  return assertCastPlanPermissions(plan, options);
}

export function applyCastChangePlan(database, userId, conversationId, input, options = {}) {
  assertCastConversationAccess(database, userId, conversationId);
  const plan = typeof input === 'string'
    ? parseCastChangePlanText(input)
    : validateCastChangePlan(input);
  const sourceKind = normalizeSourceKind(options.sourceKind);
  const scope = options.scope === 'conversation' ? 'conversation' : 'member';
  assertCastPlanPermissions(plan, { sourceKind, scope });
  const idempotencyKey = String(options.idempotencyKey || newId()).trim().slice(0, 200);
  if (!idempotencyKey) throw new CastDomainError('Idempotency key is required');
  const existing = getCastChangeBatchByKey(database, conversationId, idempotencyKey);
  if (existing) return { batch: existing, results: existing.result?.operations || [], idempotent: true };

  const scopeMemberId = normalizeScopeMember(database, userId, conversationId, options.scopeMemberId, scope);
  const evidenceById = buildEvidenceMap(database, conversationId, plan, sourceKind, {
    allowedMessageIds: options.evidenceMessageIds,
  });
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const applicationDeadline = clock() + normalizeApplicationTimeout(options.transactionTimeoutMs, sourceKind);
  const batch = {
    id: newId(),
    conversationId,
    sourceKind,
    scopeMemberId,
    idempotencyKey,
    status: 'pending',
    plan,
    result: {},
    createdAt: nowIso(),
    appliedAt: null,
  };

  try {
    return withSavepoint(database, 'sp_cast_plan', () => {
      insertCastChangeBatch(database, batch);
      const results = [];
      const seen = new Set();
      for (let index = 0; index < plan.operations.length; index += 1) {
        assertApplicationDeadline(applicationDeadline, clock);
        const operation = plan.operations[index];
        const signature = JSON.stringify(operation);
        if (seen.has(signature)) {
          results.push({ index, op: operation.op, status: 'deduplicated' });
          continue;
        }
        seen.add(signature);
        const evidence = validateOperationEvidence(operation, evidenceById, sourceKind);
        const result = applyOperation(database, userId, conversationId, operation, {
          sourceKind,
          batchId: batch.id,
          evidence,
          scopeMemberId,
          scope,
        });
        results.push({ index, op: operation.op, status: 'applied', subjectId: result?.id || result?.deletedId || '' });
      }
      const appliedAt = nowIso();
      const result = {
        summary: plan.summary,
        applied: results.filter((entry) => entry.status === 'applied').length,
        deduplicated: results.filter((entry) => entry.status === 'deduplicated').length,
        operations: results,
      };
      updateCastChangeBatch(database, batch.id, 'applied', result, appliedAt);
      return {
        batch: { ...batch, status: 'applied', result, appliedAt },
        results,
        idempotent: false,
      };
    });
  } catch (error) {
    persistFailedBatch(database, batch, error);
    throw error;
  }
}

function applyOperation(database, userId, conversationId, operation, context) {
  const commandOptions = {
    sourceKind: context.sourceKind,
    batchId: context.batchId,
    evidence: context.evidence,
  };
  if (operation.op === 'member.create') {
    assertConversationScope(context, operation.op);
    return createCastMember(database, userId, conversationId, {
      canonicalName: operation.target.name,
      ...operation.changes,
      confidence: operation.confidence,
    }, commandOptions);
  }

  if (operation.op === 'item.transfer') {
    const item = getCastItem(database, conversationId, operation.target.itemId);
    if (!item) throw castNotFound('Item not found');
    assertItemScope(item, context);
    let destination = { ...operation.changes };
    if (destination.memberName) {
      const member = resolveCastMember(database, userId, conversationId, { name: destination.memberName });
      destination = { memberId: member.id, revision: destination.revision };
    }
    if (destination.memberId && context.scopeMemberId && destination.memberId !== context.scopeMemberId) {
      throw castForbidden('Single-member organization cannot transfer items to another member');
    }
    return transferCastItem(database, userId, conversationId, operation.target.itemId, destination, commandOptions);
  }

  if (operation.op === 'item.delete') {
    const item = getCastItem(database, conversationId, operation.target.itemId);
    if (!item || item.ownerKind !== 'cast') throw castNotFound('Cast item not found');
    assertItemScope(item, context);
    return deleteCastMemberItem(
      database,
      userId,
      conversationId,
      item.ownerMemberId,
      item.id,
      { ...commandOptions, expectedRevision: operation.target.revision }
    );
  }

  const member = resolveCastMember(database, userId, conversationId, operation.target);
  assertMemberScope(member.id, context);
  if (operation.op === 'member.update') {
    assertAutoMemberChanges(operation.changes, context.sourceKind);
    return updateCastMemberProfile(database, userId, conversationId, member.id, {
      ...operation.changes,
      confidence: operation.confidence ?? operation.changes.confidence,
    }, commandOptions);
  }
  if (operation.op === 'member.hide') {
    return setCastMemberVisibility(database, userId, conversationId, member.id, 'hidden', commandOptions);
  }
  if (operation.op === 'member.restore') {
    return setCastMemberVisibility(database, userId, conversationId, member.id, 'visible', commandOptions);
  }
  if (operation.op === 'memory.create') {
    return createCastMemory(database, userId, conversationId, member.id, operation.changes, commandOptions);
  }
  if (operation.op === 'memory.update') {
    return updateCastMemoryEntry(
      database,
      userId,
      conversationId,
      member.id,
      operation.target.memoryId,
      operation.changes,
      commandOptions
    );
  }
  if (operation.op === 'memory.delete') {
    return deleteCastMemoryEntry(
      database,
      userId,
      conversationId,
      member.id,
      operation.target.memoryId,
      { ...commandOptions, expectedRevision: operation.target.revision }
    );
  }
  if (operation.op === 'behavior.create') {
    return createCastBehavior(database, userId, conversationId, member.id, operation.changes, commandOptions);
  }
  if (operation.op === 'behavior.update') {
    return updateCastBehaviorEntry(
      database,
      userId,
      conversationId,
      member.id,
      operation.target.behaviorId,
      operation.changes,
      commandOptions
    );
  }
  if (operation.op === 'behavior.delete') {
    return deleteCastBehaviorEntry(
      database,
      userId,
      conversationId,
      member.id,
      operation.target.behaviorId,
      { ...commandOptions, expectedRevision: operation.target.revision }
    );
  }
  if (operation.op === 'item.upsert') {
    return upsertCastMemberItem(database, userId, conversationId, member.id, {
      ...operation.changes,
      itemId: operation.target.itemId,
    }, commandOptions);
  }
  if (operation.op === 'appearance.update') {
    return updateCastMemberAppearance(database, userId, conversationId, member.id, operation.changes, commandOptions);
  }
  throw new CastDomainError(`Unsupported cast operation: ${operation.op}`);
}

function buildEvidenceMap(database, conversationId, plan, sourceKind, options = {}) {
  if (sourceKind !== 'auto_sync') return new Map();
  const ids = plan.operations.map((operation) => operation.evidence?.messageId).filter(Boolean);
  if (Array.isArray(options.allowedMessageIds)) {
    const allowed = new Set(options.allowedMessageIds.map((id) => String(id || '')).filter(Boolean));
    const outsideObservation = ids.find((id) => !allowed.has(id));
    if (outsideObservation) {
      throw new CastDomainError('Auto sync evidence must come from the current story turn', {
        code: 'CAST_PLAN_EVIDENCE',
        statusCode: 400,
      });
    }
  }
  const rows = getConversationEvidenceMessages(database, conversationId, ids);
  return new Map(rows.map((row) => [row.id, row]));
}

function validateOperationEvidence(operation, evidenceById, sourceKind) {
  if (sourceKind !== 'auto_sync') return operation.evidence || null;
  const evidence = operation.evidence;
  const message = evidenceById.get(evidence.messageId);
  if (!message || !message.content.includes(evidence.quote)) {
    throw new CastDomainError('Auto sync evidence does not match an allowed conversation message', {
      code: 'CAST_PLAN_EVIDENCE',
      statusCode: 400,
    });
  }
  return evidence;
}

function normalizeScopeMember(database, userId, conversationId, scopeMemberId, scope) {
  if (scope === 'conversation') return '';
  const normalized = String(scopeMemberId || '').trim();
  if (!normalized) throw new CastDomainError('Single-member plan requires scopeMemberId');
  return resolveCastMember(database, userId, conversationId, { memberId: normalized }).id;
}

function assertConversationScope(context, operationName) {
  if (context.scopeMemberId) {
    throw castForbidden(`Single-member organization cannot perform ${operationName}`);
  }
}

function assertMemberScope(memberId, context) {
  if (context.scopeMemberId && context.scopeMemberId !== memberId) {
    throw castForbidden('Cast change is outside the selected member scope');
  }
}

function assertItemScope(item, context) {
  if (context.scopeMemberId
    && (item.ownerKind !== 'cast' || item.ownerMemberId !== context.scopeMemberId)) {
    throw castForbidden('Item change is outside the selected member scope');
  }
}

function assertAutoMemberChanges(changes, sourceKind) {
  if (sourceKind !== 'auto_sync') return;
  for (const field of ['canonicalName', 'aliases', 'memorySealed', 'visibility']) {
    if (changes[field] !== undefined) {
      throw castForbidden(`Auto sync cannot change ${field}`);
    }
  }
}

function persistFailedBatch(database, batch, error) {
  if (getCastChangeBatchByKey(database, batch.conversationId, batch.idempotencyKey)) return;
  try {
    insertCastChangeBatch(database, {
      ...batch,
      status: 'failed',
      result: {
        code: error?.code || 'CAST_PLAN_FAILED',
        error: String(error?.message || 'Cast plan failed').slice(0, 500),
      },
      appliedAt: nowIso(),
    });
  } catch {
    // Preserve the original domain or storage error.
  }
}

function normalizeSourceKind(value) {
  return ['manual', 'auto_sync', 'ai_organize', 'migration'].includes(value) ? value : 'manual';
}

function normalizeApplicationTimeout(value, sourceKind) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.min(60_000, Math.max(1, Math.round(numeric)));
  }
  return sourceKind === 'migration' ? 60_000 : 10_000;
}

function assertApplicationDeadline(deadline, clock) {
  if (clock() <= deadline) return;
  throw new CastDomainError('Cast change plan application timed out', {
    code: 'CAST_PLAN_TIMEOUT',
    statusCode: 504,
  });
}
