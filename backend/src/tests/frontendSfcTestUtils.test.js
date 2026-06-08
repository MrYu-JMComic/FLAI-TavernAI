import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches } from './frontendSfcTestUtils.js';

test('countMatches handles global and non-global regular expressions', () => {
  const source = 'alpha beta alpha ALPHA';

  assert.equal(countMatches(source, /alpha/g), 2);
  assert.equal(countMatches(source, /alpha/), 2);
  assert.equal(countMatches(source, /alpha/i), 3);
});
