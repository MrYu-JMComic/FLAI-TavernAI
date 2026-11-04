/** Explicit possession predicates keep observed or nearby objects out of an actor's possessions. */
export const ACTOR_POSSESSION_PREDICATES = Object.freeze(['owns', 'possesses', 'holds', 'carries', 'has_item', '拥有', '持有', '携带']);

/** Collect native entity associations; audience membership is knowledge, not ownership. */
export function eventActorIds(event, claims = [], knowledge = [], threads = []) {
  return new Set([
    event.subject_entity_id, ...(event.participants || []), ...(event.actorIds || []),
    ...claims.flatMap(row => [row.subject_entity_id, row.object_entity_id]),
    ...knowledge.filter(row => row.epistemic_state !== 'unknown').map(row => row.actor_entity_id), ...threads.map(row => row.owner_entity_id)
  ].filter(Boolean));
}

/** Preserve the existing review DTO while rendering actor-safe event content supplied by canonical eligibility. */
export function actorMemoryRecord(event, entities) {
  return {
    id: event.memory_id || event.id, eventId: event.id, revision: event.memory_revision,
    memoryType: event.kind, subject: entities.get(event.subject_entity_id)?.name || '', content: event.content,
    confidence: event.confidence, enabled: event.lifecycle === 'active', archived: ['rejected', 'superseded'].includes(event.lifecycle),
    pinned: event.layer === 'canon', visibility: event.visibility, truthStatus: event.truth_status,
    actorIds: event.actorIds || [], layer: event.layer, epistemicState: event.epistemicState || ''
  };
}

/** Quantities come from explicit structured values, never inferred from prose. */
export function possessionQuantity(value) {
  const quantity = typeof value === 'number' ? value : value && typeof value === 'object' ? value.quantity : null;
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}
