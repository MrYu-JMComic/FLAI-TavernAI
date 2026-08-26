import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { insertCastAuditEvent } from '../../repositories/auditRepository.js';
import { CastDomainError, castConflict } from '../../domain/cast/errors.js';

export function recordCastAudit(database, context, data) {
  return insertCastAuditEvent(database, {
    id: newId(),
    batchId: context.batchId,
    actor: context.actor,
    createdAt: nowIso(),
    ...data,
    metadata: {
      ...(data.metadata || {}),
      sourceKind: context.sourceKind,
      evidence: context.evidence || null
    }
  });
}

export function runCastMutation(database, operation) {
  try {
    return withSavepoint(database, 'sp_cast_command', operation);
  } catch (error) {
    if (error instanceof CastDomainError) throw error;
    const message = String(error?.message || '');
    if (message.includes('UNIQUE constraint failed')) {
      throw castConflict('Cast data conflicts with an existing record');
    }
    if (message.includes('CHECK constraint failed') || message.includes('FOREIGN KEY constraint failed')) {
      throw new CastDomainError('Cast data violates a storage constraint');
    }
    throw error;
  }
}
