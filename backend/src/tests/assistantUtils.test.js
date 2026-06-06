import assert from 'node:assert/strict';
import test from 'node:test';

const {
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
