import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeBoolean } = await import('../utils/boolean.js');
const { clampInteger, clampNumber, normalizeFiniteNumber } = await import('../utils/number.js');

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

test('clampNumber bounds finite numeric values', () => {
  assert.equal(clampNumber(1.5, 0, 2), 1.5);
  assert.equal(clampNumber('4', 0, 2), 2);
  assert.equal(clampNumber('-4', -2, 2), -2);
  assert.equal(clampNumber('', -2, 2), 0);
  assert.equal(clampNumber('bad', -2, 2), -2);
  assert.equal(clampNumber('bad', 0, 10, 7), 7);
});

test('clampInteger rounds and bounds finite numeric values', () => {
  assert.equal(clampInteger(1.5, 0, 10), 2);
  assert.equal(clampInteger('12', 0, 10), 10);
  assert.equal(clampInteger('-4', -2, 10), -2);
  assert.equal(clampInteger('', -2, 10), 0);
  assert.equal(clampInteger('bad', 0, 10), 0);
  assert.equal(clampInteger('bad', 0, 10, 7), 7);
});
