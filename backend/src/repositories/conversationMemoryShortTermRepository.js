// Narrative order is a position in the selected history, not a persisted message column.
const orderedHistory = `WITH ordered AS (
  SELECT id,role,postprocess_state,ROW_NUMBER() OVER(ORDER BY created_at,rowid) AS narrative_order
  FROM messages WHERE user_id=? AND conversation_id=?
)`;

/** Read the complete unresolved suffix up to a cutoff, without loading oversized backlogs into memory. */
export function readPendingMemoryRows(database, userId, conversationId, { coreOrder, cutoff, turnLimit }) {
  const earliest = database.prepare(`${orderedHistory} SELECT narrative_order FROM ordered
    WHERE role='assistant' AND narrative_order>? AND narrative_order<=?
    AND postprocess_state IN ('queued','pending','running','failed') ORDER BY narrative_order LIMIT 1`)
    .get(userId, conversationId, coreOrder, cutoff);
  if (!earliest) return { rows: [], turns: 0, overflow: false };
  const precedingUser = database.prepare(`${orderedHistory} SELECT narrative_order FROM ordered
    WHERE role='user' AND narrative_order>? AND narrative_order<? ORDER BY narrative_order DESC LIMIT 1`)
    .get(userId, conversationId, coreOrder, earliest.narrative_order);
  const start = precedingUser?.narrative_order ?? earliest.narrative_order;
  const turns = database.prepare(`${orderedHistory} SELECT COUNT(*) AS count FROM ordered
    WHERE role='assistant' AND narrative_order>=? AND narrative_order<=?`).get(userId, conversationId, start, cutoff).count;
  if (turns > turnLimit) return { rows: [], turns, overflow: true };
  const rows = database.prepare(`${orderedHistory} SELECT m.id,m.role,m.content,m.attachments_json,m.revision,m.created_at,o.narrative_order
    FROM ordered o JOIN messages m ON m.id=o.id WHERE o.narrative_order>=? AND o.narrative_order<=?
      AND o.role IN ('user','assistant') ORDER BY o.narrative_order`).all(userId, conversationId, start, cutoff);
  return { rows, turns, overflow: false };
}
