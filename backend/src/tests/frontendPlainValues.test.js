import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { samePlainValue } = await import('../../../frontend/src/utils/plainValues.js');
const plainValuesSource = readRepoText('frontend/src/utils/plainValues.js');

test('samePlainValue compares nested plain arrays and objects by value', () => {
  assert.equal(samePlainValue(
    { id: 'a', meta: { count: 2, flags: [true, Number.NaN] } },
    { id: 'a', meta: { count: 2, flags: [true, Number.NaN] } }
  ), true);
  assert.equal(samePlainValue(
    { id: 'a', meta: { count: 2, flags: [true] } },
    { id: 'a', meta: { count: 2, flags: [true, false] } }
  ), false);
});

test('samePlainValue ignores inherited keys and preserves Object.is semantics', () => {
  const valueWithInheritedKey = Object.create({ inherited: true });
  valueWithInheritedKey.id = 'row-1';

  assert.equal(samePlainValue(valueWithInheritedKey, { id: 'row-1' }), true);
  assert.equal(samePlainValue(valueWithInheritedKey, { id: 'row-1', inherited: true }), false);
  assert.equal(samePlainValue(-0, 0), false);
});

test('samePlainValue scans keys directly without Object.keys or every callbacks', () => {
  assert.match(
    plainValuesSource,
    /export function samePlainValue\(current, next\) \{[\s\S]*Object\.is\(current, next\)[\s\S]*Array\.isArray\(current\)[\s\S]*for \(let index = 0; index < current\.length; index \+= 1\) \{[\s\S]*samePlainValue\(current\[index\], next\[index\]\)[\s\S]*let currentKeyCount = 0;[\s\S]*for \(const key in current\) \{[\s\S]*currentKeyCount \+= 1;[\s\S]*samePlainValue\(current\[key\], next\[key\]\)[\s\S]*let nextKeyCount = 0;[\s\S]*for \(const key in next\) \{[\s\S]*nextKeyCount \+= 1;[\s\S]*return currentKeyCount === nextKeyCount;[\s\S]*\}/
  );
  assert.doesNotMatch(plainValuesSource, /Object\.keys\(/);
  assert.doesNotMatch(plainValuesSource, /\.every\(/);
});
