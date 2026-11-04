import { getMemoryReviewRevision } from '../../repositories/conversationMemoryContextRepository.js';
import { MemoryRevisionError } from '../../domain/conversationMemory/contracts.js';

/** Fail before any review mutation if the owned projection has changed since the editor read it. */
export function requireMemoryReviewRevision(database, userId, conversationId, memoryId, revision) {
  const current = getMemoryReviewRevision(database, userId, conversationId, memoryId);
  if (current === null) return false;
  if (current !== revision) throw new MemoryRevisionError('记忆已变化，请刷新后重试', 'MEMORY_REVISION_CHANGED');
  return true;
}
