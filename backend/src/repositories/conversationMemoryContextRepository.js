/** Bounded candidate reads only; the canonical repository applies lineage, source and actor eligibility afterwards. */
export function listMemoryLexicalCandidates(database, userId, conversationId, { fts, terms = [], entityIds = [] } = {}) {
  const candidates = [];
  if (fts) candidates.push(...database.prepare(`SELECT event_id AS id FROM fts_memory_events
    WHERE fts_memory_events MATCH ? AND user_id=? AND conversation_id=? ORDER BY rank LIMIT 100`)
    .all(fts, userId, conversationId).map(row => ({ ...row, reason: 'fts', boost: 2 })));
  const fragments = terms.slice(0, 12);
  if (fragments.length) candidates.push(...database.prepare(`SELECT id FROM memory_events WHERE user_id=? AND conversation_id=?
    AND (${fragments.map(() => 'instr(lower(content),?)>0').join(' OR ')})
    ORDER BY narrative_order DESC,event_sequence DESC LIMIT 100`).all(userId, conversationId, ...fragments)
    .map(row => ({ ...row, reason: 'lexical', boost: 2 })));
  const ids = entityIds.slice(0, 16);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    candidates.push(...database.prepare(`SELECT DISTINCT e.id FROM memory_events e LEFT JOIN memory_claims c ON c.event_id=e.id
      WHERE e.user_id=? AND e.conversation_id=? AND (e.subject_entity_id IN (${placeholders})
      OR c.subject_entity_id IN (${placeholders}) OR c.object_entity_id IN (${placeholders}))
      ORDER BY e.narrative_order DESC,e.event_sequence DESC LIMIT 80`).all(userId, conversationId, ...ids, ...ids, ...ids)
      .map(row => ({ ...row, reason: 'entity_graph', boost: 3 })));
  }
  return candidates;
}

/** Return derived summary candidates and their provenance; callers must validate every dependency against their read scope. */
export function listMemorySummaryCandidates(database, userId, conversationId, asOfOrder) {
  return database.prepare(`SELECT * FROM memory_summaries WHERE user_id=? AND conversation_id=? AND status='active'
    AND end_order<=? ORDER BY CASE level WHEN 'arc' THEN 0 WHEN 'chapter' THEN 1 ELSE 2 END,end_order DESC LIMIT 12`)
    .all(userId, conversationId, asOfOrder).map(summary => ({ ...summary,
      dependencies: database.prepare('SELECT event_id,source_hash FROM memory_summary_dependencies WHERE summary_id=? AND event_id IS NOT NULL')
        .all(summary.id)
    }));
}

/** Read the owned legacy review revision for optimistic concurrency at the public API boundary. */
export function getMemoryReviewRevision(database, userId, conversationId, memoryId) {
  return database.prepare('SELECT revision FROM conversation_memories WHERE id=? AND user_id=? AND conversation_id=?')
    .get(memoryId, userId, conversationId)?.revision ?? null;
}

/** The current narrative cutoff is the selected owned history length, including messages without extracted facts. */
export function getMemoryHistoryOrder(database, userId, conversationId) {
  return database.prepare('SELECT COUNT(*) AS total FROM messages WHERE user_id=? AND conversation_id=?')
    .get(userId, conversationId).total;
}
