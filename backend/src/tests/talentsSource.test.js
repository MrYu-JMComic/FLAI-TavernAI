import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const talentsSource = readFileSync(new URL('../modules/talents.js', import.meta.url), 'utf8');

test('weightedRandomPick scans weights directly without weighted arrays', () => {
  const startMarker = 'export function weightedRandomPick(talents) {';
  const endMarker = 'export const RARITY_CONFIG';
  const start = talentsSource.indexOf(startMarker);
  const end = talentsSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const functionSource = talentsSource.slice(start, end);
  assert.match(functionSource, /let totalWeight = 0;/);
  assert.match(functionSource, /for \(const talent of talents\) \{[\s\S]*totalWeight \+= RARITY_WEIGHTS\[rarity\] \|\| RARITY_WEIGHTS\.common;/);
  assert.match(functionSource, /let random = Math\.random\(\) \* totalWeight;/);
  assert.match(functionSource, /for \(const talent of talents\) \{[\s\S]*random -= weight;[\s\S]*return talent;/);
  assert.doesNotMatch(functionSource, /talents\.map\(/);
  assert.doesNotMatch(functionSource, /\.reduce\(/);
});
