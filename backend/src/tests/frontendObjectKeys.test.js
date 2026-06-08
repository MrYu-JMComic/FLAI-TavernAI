import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { countOwnObjectKeys } = await import('../../../frontend/src/utils/objectKeys.js');
const objectKeysSource = readRepoText('frontend/src/utils/objectKeys.js');

test('countOwnObjectKeys counts enumerable own keys only', () => {
  const value = Object.create({ inherited: true });
  value.alpha = 1;
  value.beta = 2;
  Object.defineProperty(value, 'hidden', {
    enumerable: false,
    value: 3
  });

  assert.equal(countOwnObjectKeys(value), 2);
  assert.equal(countOwnObjectKeys(null), 0);
});

test('countOwnObjectKeys scans own keys directly without Object.keys allocation', () => {
  assert.match(
    objectKeysSource,
    /export function countOwnObjectKeys\(value\) \{[\s\S]*if \(!value \|\| typeof value !== 'object'\) \{[\s\S]*return 0;[\s\S]*for \(const key in value\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(value, key\)[\s\S]*count \+= 1;[\s\S]*return count;[\s\S]*\}/
  );
  assert.doesNotMatch(objectKeysSource, /Object\.keys\(/);
});
