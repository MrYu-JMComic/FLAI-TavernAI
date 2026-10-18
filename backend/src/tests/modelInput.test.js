import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelInput } from '../utils/modelInput.js';

test('schema normalization preserves opaque text and only converts declared scalars', () => {
  const schema = { type: 'object', properties: {
    number: { type: 'number' }, boolean: { type: 'boolean' }, text: { type: 'string' },
    ratio: { type: 'number', minimum: 0, maximum: 1 }, opaque: {},
  } };
  const source = { number: ' 3.5 ', boolean: ' FALSE ', text: 'true 90% null', ratio: '90%', opaque: { value: '3' } };
  assert.deepEqual(normalizeModelInput(source, schema), { number: 3.5, boolean: false, text: source.text, ratio: 0.9, opaque: source.opaque });
  assert.equal(source.boolean, ' FALSE ');
  for (const input of ['Infinity', 'NaN', '3 items', '', '9007199254740993']) {
    assert.equal(normalizeModelInput(input, { type: 'number' }), input);
  }
  assert.equal(normalizeModelInput('120%', schema.properties.ratio), 1.2, 'the domain validator, not clipping, rejects out-of-range values');
});

test('nullable, required, optional and unknown nulls keep their distinct meanings', () => {
  const schema = { type: 'object', required: ['required'], properties: {
    required: { type: 'boolean' }, optional: { type: 'string' },
    nullable: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  } };
  assert.deepEqual(normalizeModelInput({ required: null, optional: null, nullable: null, unknown: null }, schema), {
    required: null, nullable: null, unknown: null,
  });
  assert.deepEqual(normalizeModelInput({ nullable: '4' }, schema), { nullable: 4 });
  assert.deepEqual(normalizeModelInput({}, schema), {}, 'required fields are not fabricated');
});

test('normalization chooses only an unambiguous typed or discriminated schema variant', () => {
  const schema = { oneOf: [
    { type: 'object', properties: { op: { const: 'number' }, value: { type: 'number' } } },
    { type: 'object', properties: { op: { const: 'text' }, value: { type: 'string' } } },
  ] };
  assert.deepEqual(normalizeModelInput({ op: 'number', value: '4' }, schema), { op: 'number', value: 4 });
  assert.deepEqual(normalizeModelInput({ op: 'text', value: '4' }, schema), { op: 'text', value: '4' });
  assert.deepEqual(normalizeModelInput({ op: 'unknown', value: '4' }, schema), { op: 'unknown', value: '4' });
  assert.equal(normalizeModelInput('4', { anyOf: [{ type: 'number' }, { type: 'string' }] }), '4');
  assert.equal(normalizeModelInput('false', { anyOf: [{ type: 'number' }, { type: 'boolean' }] }), 'false');
});

test('only declared metadata paths discard plain annotations, never unknown business data', () => {
  const schema = { type: 'object', properties: {
    items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
  } };
  const source = { note: 'Comment', userId: 'must-not-disappear', items: [{ name: 'A', note: 'Nested comment' }] };
  assert.deepEqual(normalizeModelInput(source, schema, { metadataKeys: ['note'] }), {
    userId: source.userId, items: source.items,
  });
  assert.deepEqual(normalizeModelInput(source, schema, { metadataKeys: ['note'], metadataPaths: ['', 'items.*'] }), {
    userId: source.userId, items: [{ name: 'A' }],
  });
  assert.deepEqual(normalizeModelInput({ note: { change: true } }, schema, { metadataKeys: ['note'] }), { note: { change: true } });
});
