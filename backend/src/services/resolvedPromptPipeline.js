import { resolveMemoryContext } from './conversationMemory/context.js';
import { buildPromptPipeline } from './promptPipeline.js';
import { openProjectedContext } from '../repositories/projectedContextRepository.js';
import { memoryHash } from '../domain/conversationMemory/contracts.js';
import { snapshotConversationWorldBookState } from './worldBooks/worldBookStateService.js';

/** Resolve async retrieval once, then compile the exact same bundle for every consumer. */
export async function buildResolvedPromptPipeline(database,options={}) {
  const projection = openProjectedContext(database, options.user?.id, options.conversation?.id, options);
  try {
    const resolved=options.contextBundle||await resolveMemoryContext(database,{...options,
      ...(projection?{commitId:projection.memoryCheckpoint.commitId||'',memoryCheckpoint:projection.memoryCheckpoint}:{})});
    const contextBundle = projection ? {
      ...resolved,
      source: { ...resolved.source, stateCheckpoint: projection.checkpointId, stateFingerprint: projection.fingerprint },
      fingerprint: memoryHash([resolved.fingerprint, projection.fingerprint])
    } : resolved;
    let loreTransition;
    const stageLoreTransition = (commit) => {
      // Simulate against the private checkpoint copy, never the live timeline.
      projection.database.exec('PRAGMA query_only=OFF');
      try {
        commit();
        loreTransition = {
          version: 1, userId: options.user.id, conversationId: options.conversation.id,
          checkpointId: projection.checkpointId,
          state: snapshotConversationWorldBookState(projection.database, options.conversation.id)
        };
      } finally { projection.database.exec('PRAGMA query_only=ON'); }
    };
    const pipeline = buildPromptPipeline(database, { ...options, contextBundle,
      ...(projection ? { stateDatabase: projection.database, loreDatabase: projection.database,
        history: (options.history || []).filter((row) => projection.historyIds.has(row.id)),
        persistWorldBookState: options.persistWorldBookState !== false,
        deferWorldBookStateCommit: stageLoreTransition } : {})
    });
    if (loreTransition) pipeline.loreTransition = loreTransition;
    if (projection) pipeline.diagnostics.stateProjection = {
      checkpointId: projection.checkpointId, checkpointOrder: projection.checkpointOrder,
      cutoffOrder: projection.cutoffOrder, fingerprint: projection.fingerprint
    };
    return pipeline;
  } finally { projection?.dispose(); }
}
