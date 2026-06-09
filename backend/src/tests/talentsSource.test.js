import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const talentsSource = readFileSync(new URL('../modules/talents.js', import.meta.url), 'utf8');

test('buildTalentSystemPrompt builds prompt lines without intermediate arrays', () => {
  const startMarker = 'export function buildTalentSystemPrompt(database, characterId) {';
  const endMarker = '// ── Roll engine: weighted random ──';
  const start = talentsSource.indexOf(startMarker);
  const end = talentsSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const functionSource = talentsSource.slice(start, end);
  assert.match(functionSource, /let prompt = '\[角色天赋\]\\n该角色拥有以下天赋，请在扮演时自然融入这些天赋特质：';/);
  assert.match(functionSource, /for \(const talent of talents\) \{\s*prompt \+= `\\n- \$\{formatTalentPromptLine\(talent\)\}`;/);
  assert.match(functionSource, /function formatTalentPromptLine\(talent\) \{[\s\S]*let line = `「\$\{talent\.talentName\}」\(\$\{rarityLabel\}\)`;[\s\S]*line \+= ` — \$\{talent\.talentDescription\}`;[\s\S]*line \+= ` — 效果：\$\{talent\.talentEffect\}`;[\s\S]*return line;/);
  assert.doesNotMatch(functionSource, /talents\.map\(/);
  assert.doesNotMatch(functionSource, /lines\.map\(/);
  assert.doesNotMatch(functionSource, /parts\.join\(/);
});

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
