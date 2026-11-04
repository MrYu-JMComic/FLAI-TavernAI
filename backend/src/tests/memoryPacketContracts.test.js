import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  MEMORY_PACKET_LIMITS, MemoryPacketValidationError, normalizeMemoryPacket
} from '../domain/conversationMemory/contracts.js';
import { buildMemoryExtractionPacketSchema } from '../domain/conversationMemory/extractionSchema.js';
import { executeProviderTool } from '../services/providerToolResults.js';

const schema = buildMemoryExtractionPacketSchema();
const validate = z.fromJSONSchema(schema);
const tool = [{ type: 'function', function: { name: 'finish_memory_review', parameters: {
  type: 'object', properties: { packet: schema }, additionalProperties: false
} } }];

function entity(index = 0) { return { key: `actor-${index}`, name: `Actor ${index}`, kind: 'actor' }; }
function event(index = 0) {
  return { key: `event-${index}`, kind: 'event', content: 'An actor arrives.', evidence: [{ messageId: 'opening', quote: 'arrives' }] };
}

function assertPacketError(input, path, message) {
  assert.throws(() => normalizeMemoryPacket(input), error => {
    assert.ok(error instanceof MemoryPacketValidationError);
    assert.equal(error.code, 'MEMORY_PACKET_INVALID');
    assert.equal(error.path, path);
    assert.equal(error.accepted, false);
    assert.equal(error.status, 400);
    assert.match(error.message, message);
    assert.equal(error.issues[0].path, path);
    return true;
  });
}

test('actual provider validation rejects the observed entity map before calling finish', async () => {
  let executions = 0;
  const execute = () => { executions++; return { ok: true, stop: true }; };
  const malformed = await executeProviderTool(execute, 'finish_memory_review', {
    packet: { entities: { mira: { name: 'Mira' }, noel: { name: 'Noel' }, harbor: { name: 'Harbor' } } }
  }, {}, undefined, tool);
  assert.equal(malformed.result.error, 'TOOL_ARGUMENTS_INVALID');
  assert.equal(malformed.result.issues[0].path, 'packet.entities');
  assert.match(malformed.result.issues[0].message, /array/);
  assert.equal(malformed.stop, false);
  assert.equal(executions, 0);
  const corrected = await executeProviderTool(execute, 'finish_memory_review', {
    packet: { entities: [entity()] }
  }, {}, undefined, tool);
  assert.equal(corrected.result.ok, true);
  assert.equal(corrected.stop, true);
  assert.equal(executions, 1);
});

test('canonical packets distinguish bad roots, collection types, item types and counts', () => {
  for (const value of [null, [], 'packet', 1, true, new Date()]) assertPacketError(value, 'packet', /JSON 对象/);
  const collections = {
    sources: () => ({ messageId: 'opening', revision: 1 }), entities: entity, events: event,
    claims: () => ({}), knowledge: () => ({}), threads: () => ({}), domainRefs: () => ({}), actions: () => ({})
  };
  for (const [name, make] of Object.entries(collections)) {
    for (const value of [null, {}, 'items', 1]) assertPacketError({ [name]: value }, name, /必须是数组/);
    for (const value of [null, 'item', 1, true, []]) assertPacketError({ [name]: [value] }, `${name}[0]`, /JSON 对象/);
    const limit = MEMORY_PACKET_LIMITS[name];
    const items = Array.from({ length: limit }, (_, index) => make(index));
    assert.equal(normalizeMemoryPacket({ [name]: items })[name].length, limit, name);
    assertPacketError({ [name]: [...items, make(limit)] }, name, new RegExp(`数量不能超过 ${limit}`));
  }
});

test('canonical nested arrays reject malformed evidence and audience data with precise paths', () => {
  assertPacketError({ entities: [{ ...entity(), aliases: 'Mira' }] }, 'entities[0].aliases', /必须是数组/);
  assertPacketError({ entities: [{ ...entity(), aliases: [null] }] }, 'entities[0].aliases[0]', /必须是字符串/);
  assertPacketError({ events: [{ ...event(), participants: { mira: true } }] }, 'events[0].participants', /必须是数组/);
  assertPacketError({ events: [{ ...event(), actorIds: [null] }] }, 'events[0].actorIds[0]', /必须是字符串/);
  assertPacketError({ events: [{ ...event(), evidence: { messageId: 'opening' } }] }, 'events[0].evidence', /必须是数组/);
  assertPacketError({ events: [{ ...event(), evidence: [null] }] }, 'events[0].evidence[0]', /JSON 对象/);
  for (const name of ['participants', 'actorIds', 'evidence']) {
    const values = Array.from({ length: MEMORY_PACKET_LIMITS[name] + 1 }, (_, index) => name === 'evidence' ? { messageId: `message-${index}` } : `actor-${index}`);
    assertPacketError({ events: [{ ...event(), [name]: values }] }, `events[0].${name}`, /数量不能超过/);
  }
});

test('event keys cannot silently rebind references or collide with server-generated projections', () => {
  assertPacketError({ events: [event(), event()] }, 'events[1].key', /不能重复/);
  assertPacketError({ events: [event(), { ...event(), key: ' event-0 ' }] }, 'events[1].key', /不能重复/);
  assert.equal(normalizeMemoryPacket({ events: [{ content: 'First author fact.' }, { key: '', content: 'Second author fact.' }] }).events.length, 2);
  assert.equal(validate.safeParse({ events: [{ ...event(), key: 'projection:staged-memory' }] }).success, false);
  assert.equal(validate.safeParse({ events: [{ ...event(), key: 'ordinary-projection-key' }] }).success, true);
});

test('all six model collections enforce bounded typed items through the advertised schema', () => {
  const items = {
    entities: entity(), events: event(), claims: { eventKey: 'event-0', predicate: 'location', value: 'harbor' },
    knowledge: { eventKey: 'event-0', actorKey: 'actor-0', epistemicState: 'experienced' },
    threads: { eventKey: 'event-0', kind: 'clue', title: 'Find the key.' },
    domainRefs: { eventKey: 'event-0', domain: 'economy', recordId: 'account-0' }
  };
  for (const [name, item] of Object.entries(items)) {
    assert.equal(validate.safeParse({ [name]: [item] }).success, true, name);
    for (const value of [null, {}, 'items']) assert.equal(validate.safeParse({ [name]: value }).success, false, `${name} shape`);
    for (const value of [null, 'item', 1, []]) assert.equal(validate.safeParse({ [name]: [value] }).success, false, `${name} item`);
    const limit = MEMORY_PACKET_LIMITS[name];
    assert.equal(validate.safeParse({ [name]: Array.from({ length: limit }, () => item) }).success, true, `${name} maximum`);
    assert.equal(validate.safeParse({ [name]: Array.from({ length: limit + 1 }, () => item) }).success, false, `${name} overflow`);
  }
});

test('model references and false beliefs use explicit fields while preserving existing local-ID references', () => {
  for (const packet of [
    { entities: [{ name: 'Mira' }] }, { entities: [{ key: 'mira' }] },
    { events: [{ content: 'Arrival.', evidence: [{ messageId: 'opening' }] }] },
    { events: [{ key: 'arrival', evidence: [{ messageId: 'opening' }] }] },
    { events: [{ key: 'arrival', content: 'Arrival.', evidence: [] }] },
    { events: [{ key: 'arrival', content: 'Arrival.', evidence: [{ quote: 'Arrival' }] }] },
    { claims: [{ predicate: 'location' }] }, { knowledge: [{ eventKey: 'e', epistemicState: 'knows' }] },
    { knowledge: [{ eventKey: 'e', actorKey: 'm', epistemicState: 'false_belief' }] },
    { threads: [{ title: 'Unbound clue.' }] }, { domainRefs: [{ eventKey: 'e', recordId: 'gold' }] }
  ]) assert.equal(validate.safeParse(packet).success, false, JSON.stringify(packet));
  assert.equal(validate.safeParse({
    claims: [{ eventId: 'existing-event', predicate: 'location', value: { place: 'harbor', coordinates: [1, 2] }, validTo: null }],
    knowledge: [{ eventId: 'existing-event', actorEntityId: 'existing-actor', epistemicState: 'false_belief', beliefContent: 'The key is in the attic.' }],
    threads: [{ id: 'existing-thread', eventId: 'existing-event', status: 'resolved' }],
    domainRefs: [{ eventId: 'existing-event', domain: 'economy', recordId: 'account', outcome: { balance: 40, succeeded: true } }]
  }).success, true);
});

test('server-owned fields and misspelled item fields cannot be supplied by the model', () => {
  for (const name of ['version', 'sources', 'actions', 'messageId', 'idempotencyKey', 'summary'])
    assert.equal(validate.safeParse({ [name]: name === 'version' ? 1 : [] }).success, false, name);
  assert.equal(validate.safeParse({ entities: [{ ...entity(), actor_id: 'mira' }] }).success, false);
  assert.equal(validate.safeParse({ events: [{ ...event(), evidences: [] }] }).success, false);
  assert.equal(validate.safeParse({ knowledge: [{ eventKey: 'e', actorKey: 'm', epistemicState: 'knows', audience: ['m'] }] }).success, false);
  assert.equal(validate.safeParse({}).success, true);
});

test('canonical manual packets retain established aliases, omitted extraction-only fields and temporal amendments', () => {
  const packet = normalizeMemoryPacket({
    version: 1, messageId: 'opening', idempotencyKey: 'manual', sources: [{ id: 'opening', revision: '1' }],
    entities: [{ id: 'mira', name: 'Mira', aliases: ['M', 'M'] }],
    events: [{ content: 'Author-established secret.', visibility: 'restricted', actorIds: ['mira', 'mira'] }],
    claims: [{ eventId: 'existing-event', predicate: 'location', value: { place: { name: 'harbor' } }, validTo: null }],
    knowledge: [{ eventId: 'existing-event', actorEntityId: 'mira', epistemicState: 'unknown' }],
    threads: [{ id: 'existing-thread', eventId: 'existing-event', status: 'resolved' }],
    domainRefs: [{ eventId: 'existing-event', domain: 'economy', recordId: 'gold', revision: 2 }]
  });
  assert.equal(packet.entities[0].key, 'mira');
  assert.deepEqual(packet.entities[0].aliases, ['M', 'M']);
  assert.equal(packet.events[0].key, '');
  assert.deepEqual(packet.events[0].evidence, []);
  assert.deepEqual(packet.events[0].actorIds, ['mira']);
  assert.equal(packet.sources[0].messageId, 'opening');
  assert.equal(packet.sources[0].revision, 1);
  assert.equal(packet.domainRefs[0].revision, 2);
  assert.deepEqual(normalizeMemoryPacket(packet), packet, 'canonical normalization remains idempotent');
});
