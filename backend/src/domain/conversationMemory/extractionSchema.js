import {
  MEMORY_PACKET_LIMITS as LIMIT, MEMORY_ENTITY_KINDS, MEMORY_EVENT_KINDS, MEMORY_TRUTH_STATES,
  MEMORY_EPISTEMIC_STATES, MEMORY_LIFECYCLES, MEMORY_VISIBILITIES, MEMORY_LAYERS,
  MEMORY_CLAIM_MODALITIES, MEMORY_THREAD_KINDS, MEMORY_THREAD_STATUSES
} from './contracts.js';

/** Describes model-owned extraction fields; source versions, actions and commit identity stay server-owned. */
export function buildMemoryExtractionPacketSchema() {
  const ref = description => ({ type: 'string', minLength: 1, maxLength: LIMIT.identifierCharacters, pattern: '\\S', description });
  const text = maxLength => ({ type: 'string', maxLength });
  const nonempty = maxLength => ({ ...text(maxLength), minLength: 1, pattern: '\\S' });
  const enumeration = values => ({ type: 'string', enum: [...values] });
  const unit = { type: 'number', minimum: 0, maximum: 1 };
  const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const array = (name, items) => ({ type: 'array', maxItems: LIMIT[name], items });
  const references = {
    eventKey: ref('Key of an event in this packet, including a staged record_memory projection.'),
    eventId: ref('Existing event ID in this conversation. Use eventKey for an event in this packet.')
  };
  // Full object alternatives preserve required fields in the local JSON Schema-to-Zod adapter.
  const referenced = (properties, required = [], groups = [['eventKey', 'eventId']]) => {
    const combinations = groups.reduce((choices, group) => choices.flatMap(choice => group.map(name => [...choice, name])), [[]]);
    return { anyOf: combinations.map(choice => object(properties, [...required, ...choice])) };
  };
  const entity = object({
    key: ref('Unique packet-local key for this entity.'), id: ref('Existing local entity ID, when reusing an entity.'),
    name: nonempty(LIMIT.identifierCharacters), kind: enumeration(MEMORY_ENTITY_KINDS),
    castKey: text(LIMIT.identifierCharacters), aliases: array('aliases', nonempty(LIMIT.identifierCharacters))
  }, ['key', 'name']);
  const evidence = object({
    messageId: ref('ID of a message in the current observation; historical search results are not current evidence.'),
    revision: { type: 'integer', minimum: 1 },
    quote: { ...text(LIMIT.evidenceQuoteCharacters), description: 'Prefer an exact quotation. Omitted or paraphrased quotes lower confidence.' }
  }, ['messageId']);
  const event = object({
    key: { ...ref('Unique key for this event, used by claims, knowledge and threads. The projection: prefix is reserved for the server.'), pattern: '^(?!projection:)\\S' },
    kind: enumeration(MEMORY_EVENT_KINDS), content: nonempty(LIMIT.eventContentCharacters),
    subjectEntityId: ref('Existing entity ID or entity key from this packet.'), subjectKey: ref('Entity key from this packet.'),
    participants: array('participants', ref('Participant entity key or existing local entity ID.')),
    actorIds: array('actorIds', ref('Audience entity key or existing local entity ID. Required for restricted visibility.')),
    locationEntityId: ref('Location entity key or existing local entity ID.'),
    visibility: enumeration(MEMORY_VISIBILITIES), truthStatus: enumeration(MEMORY_TRUTH_STATES), lifecycle: enumeration(MEMORY_LIFECYCLES),
    confidence: unit, importance: unit, emotionalIntensity: unit,
    narrativeTime: text(LIMIT.identifierCharacters), layer: enumeration(MEMORY_LAYERS),
    supersedesId: ref('Current event ID being revised in this conversation.'),
    evidence: { ...array('evidence', evidence), minItems: 1 }
  }, ['key', 'content', 'evidence']);
  const claim = referenced({
    ...references, subjectEntityId: ref('Subject entity key or existing local ID.'), subjectKey: ref('Subject entity key.'),
    predicate: nonempty(LIMIT.identifierCharacters), objectEntityId: ref('Object entity key or existing local ID.'), objectKey: ref('Object entity key.'),
    value: jsonValue(), modality: enumeration(MEMORY_CLAIM_MODALITIES),
    polarity: { anyOf: [{ type: 'boolean' }, { type: 'integer', enum: [-1, 1] }] },
    truthStatus: enumeration(MEMORY_TRUTH_STATES), validFrom: { type: 'integer', minimum: 0 },
    validTo: { type: ['integer', 'null'], minimum: 0 }, supersedesId: ref('Existing claim ID being revised.')
  }, ['predicate']);
  const knowledgeProperties = {
    ...references, actorEntityId: ref('Existing actor entity ID or packet entity key.'), actorKey: ref('Actor entity key from this packet.'),
    epistemicState: enumeration(MEMORY_EPISTEMIC_STATES), learnedFromEventId: ref('Event key or existing local event ID showing how this actor learned it.'),
    beliefContent: nonempty(LIMIT.eventContentCharacters)
  };
  const knowledgeReferences = [['eventKey', 'eventId'], ['actorEntityId', 'actorKey']];
  const knowledge = { anyOf: [
    ...referenced({ ...knowledgeProperties, epistemicState: { type: 'string', enum: ['false_belief'] } },
      ['epistemicState', 'beliefContent'], knowledgeReferences).anyOf,
    ...referenced({ ...knowledgeProperties, epistemicState: enumeration(MEMORY_EPISTEMIC_STATES.filter(state => state !== 'false_belief')) },
      ['epistemicState'], knowledgeReferences).anyOf
  ] };
  const thread = referenced({
    ...references, id: ref('Existing thread ID when revising a plot thread.'), kind: enumeration(MEMORY_THREAD_KINDS),
    title: nonempty(LIMIT.threadTextCharacters), status: enumeration(MEMORY_THREAD_STATUSES),
    ownerEntityId: ref('Owner entity key or existing local ID.'), ownerKey: ref('Owner entity key.'),
    resolutionTrigger: text(LIMIT.threadTextCharacters)
  });
  const domainRef = referenced({
    ...references, domain: nonempty(LIMIT.domainCharacters), recordId: ref('Existing authoritative domain record ID; do not invent state.'),
    revision: text(LIMIT.identifierCharacters), outcome: jsonValue()
  }, ['domain', 'recordId']);
  return object({
    entities: array('entities', entity), events: array('events', event), claims: array('claims', claim),
    knowledge: array('knowledge', knowledge), threads: array('threads', thread), domainRefs: array('domainRefs', domainRef)
  });
}

/** Bounds structured claim values and domain receipts without untyped provider schema nodes. */
function jsonValue(depth = 2) {
  const choices = [
    { type: 'string', maxLength: LIMIT.eventContentCharacters }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }
  ];
  if (depth > 0) choices.push(
    { type: 'array', maxItems: LIMIT.jsonItems, items: jsonValue(depth - 1) },
    { type: 'object', maxProperties: LIMIT.jsonItems, additionalProperties: jsonValue(depth - 1) }
  );
  return { anyOf: choices };
}
