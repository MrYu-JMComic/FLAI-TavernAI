import assert from 'node:assert/strict';
import test from 'node:test';

const {
  cloneToolCalls,
  nullToEmptyObject,
  objectOrEmpty,
  parseLooseJsonObject
} = await import('../services/assistantUtils.js');

test('assistant utility object guards preserve object-like values', () => {
  const object = { ok: true };
  const array = ['kept'];

  assert.equal(objectOrEmpty(object), object);
  assert.equal(objectOrEmpty(array), array);
  assert.deepEqual(objectOrEmpty(null), {});
  assert.deepEqual(objectOrEmpty('text'), {});
  assert.deepEqual(nullToEmptyObject(null), {});
  assert.deepEqual(nullToEmptyObject(undefined), {});
  assert.equal(nullToEmptyObject('text'), 'text');
});

test('assistant utility clones tool-call summaries with stable shallow fields', () => {
  const args = { value: 42 };
  const result = { ok: true };
  const source = [
    { name: 'set_value', arguments: args, result, ignored: true }
  ];

  const cloned = cloneToolCalls(source);

  assert.notEqual(cloned, source);
  assert.deepEqual(cloned, [
    { name: 'set_value', arguments: args, result }
  ]);
  assert.equal(cloned[0].arguments, args);
  assert.equal(cloned[0].result, result);
  assert.deepEqual(cloneToolCalls(null), []);
});

test('assistant utility loose JSON parser extracts usable objects only', () => {
  assert.deepEqual(parseLooseJsonObject(''), {});
  assert.deepEqual(parseLooseJsonObject('42'), {});
  assert.deepEqual(parseLooseJsonObject('{"name":"Alice"}'), { name: 'Alice' });
  assert.deepEqual(parseLooseJsonObject('```json\n{"name":"Alice"}\n```'), { name: 'Alice' });
  assert.deepEqual(parseLooseJsonObject('prefix {"entries":[{"name":"A"}]} suffix'), {
    entries: [{ name: 'A' }]
  });
  assert.deepEqual(parseLooseJsonObject('{bad json'), {});
});
