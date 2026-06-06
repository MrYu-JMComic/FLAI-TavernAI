import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeBoolean } = await import('../utils/boolean.js');
const { normalizeFiniteNumber } = await import('../utils/number.js');

test('normalizeBoolean preserves booleans and parses string flags', () => {
  assert.equal(normalizeBoolean(true), true);
  assert.equal(normalizeBoolean(false), false);
  assert.equal(normalizeBoolean('true'), true);
  assert.equal(normalizeBoolean('false'), false);
  assert.equal(normalizeBoolean('1'), true);
  assert.equal(normalizeBoolean('0'), false);
});

test('normalizeBoolean uses fallback for missing or unrecognized values', () => {
  assert.equal(normalizeBoolean(undefined, true), true);
  assert.equal(normalizeBoolean(null, true), true);
  assert.equal(normalizeBoolean('', true), true);
  assert.equal(normalizeBoolean('maybe', true), true);
  assert.equal(normalizeBoolean({}, false), false);
});

test('normalizeFiniteNumber preserves finite numbers and numeric strings', () => {
  assert.equal(normalizeFiniteNumber(3), 3);
  assert.equal(normalizeFiniteNumber('4.5'), 4.5);
  assert.equal(normalizeFiniteNumber('-2'), -2);
});

test('normalizeFiniteNumber uses fallback for missing or non-finite values', () => {
  assert.equal(normalizeFiniteNumber(undefined, 7), 7);
  assert.equal(normalizeFiniteNumber(null, 7), 7);
  assert.equal(normalizeFiniteNumber('', 7), 7);
  assert.equal(normalizeFiniteNumber('   ', 7), 7);
  assert.equal(normalizeFiniteNumber('Infinity', 7), 7);
  assert.equal(normalizeFiniteNumber('-Infinity', 7), 7);
  assert.equal(normalizeFiniteNumber('not-a-number', 7), 7);
  assert.equal(normalizeFiniteNumber('not-a-number', 'bad-fallback'), 0);
});
