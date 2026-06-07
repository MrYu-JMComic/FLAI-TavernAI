import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: talentRollDialogScript,
  template: talentRollDialogTemplate
} = readVueBlocks('frontend/src/components/TalentRollDialog.vue');

test('TalentRollDialog retry action ignores events while dialog data is loading', () => {
  assert.match(
    talentRollDialogScript,
    /function retryLoadDialogData\(\)\s*{\s*if \(loading\.value\) return;\s*loadDialogData\(\);/
  );
  assert.match(
    talentRollDialogTemplate,
    /<button class="ghost-button" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadDialogData">/
  );
});

test('TalentRollDialog disables roll and talent mutations while one action is busy', () => {
  assert.match(talentRollDialogScript, /const removingTalentId = ref\(''\)/);
  assert.match(talentRollDialogScript, /const talentMutationBusy = computed\(\(\) => clearingAll\.value \|\| Boolean\(removingTalentId\.value\)\)/);
  assert.match(talentRollDialogScript, /const talentActionBusy = computed\(\(\) => loading\.value \|\| rolling\.value \|\| talentMutationBusy\.value\)/);
  assert.match(talentRollDialogScript, /const dialogCloseLocked = computed\(\(\) => rolling\.value \|\| talentMutationBusy\.value\)/);
  assert.match(talentRollDialogScript, /function requestClose\(\)\s*{\s*if \(dialogCloseLocked\.value\) return;\s*emit\('close'\);/);
  assert.match(talentRollDialogScript, /setPoolsIfChanged\(\[\]\);\s*setTalentsIfChanged\(\[\]\);\s*selectedPoolId\.value = '';/);
  assert.match(talentRollDialogScript, /if \(talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(talentRollDialogScript, /if \(!props\.canEdit \|\| talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = talentId/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = ''/);

  assert.match(talentRollDialogTemplate, /<select v-model="selectedPoolId" :disabled="talentActionBusy \|\| !pools\.length">/);
  assert.match(talentRollDialogTemplate, /@click\.self="requestClose"/);
  assert.match(talentRollDialogTemplate, /@keydown\.esc\.prevent="requestClose"/);
  assert.match(talentRollDialogTemplate, /:disabled="dialogCloseLocked"[\s\S]*:aria-busy="dialogCloseLocked"[\s\S]*@click="requestClose"/);
  assert.match(talentRollDialogTemplate, /:disabled="talentActionBusy \|\| !pools\.length \|\| !selectedPoolId"/);
  assert.equal(countMatches(talentRollDialogTemplate, /:disabled="talentActionBusy"/g), 2);
  assert.equal(countMatches(talentRollDialogTemplate, /:aria-busy=/g), 5);
  assert.match(talentRollDialogTemplate, /:aria-busy="removingTalentId === talent\.id"/);
  assert.doesNotMatch(talentRollDialogTemplate, /emit\('close'\)/);
});

test('TalentRollDialog preserves unchanged pool and talent list references during refreshes', () => {
  assert.match(
    talentRollDialogScript,
    /function setPoolsIfChanged\(nextPools\)\s*{\s*const normalizedPools = Array\.isArray\(nextPools\) \? nextPools : \[\];[\s\S]*if \(sameListItems\(currentPools, normalizedPools, samePoolSummary\)\) {\s*return false;\s*}[\s\S]*pools\.value = normalizedPools;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function setTalentsIfChanged\(nextTalents\)\s*{\s*const normalizedTalents = Array\.isArray\(nextTalents\) \? nextTalents : \[\];[\s\S]*if \(sameListItems\(currentTalents, normalizedTalents, sameTalentSummary\)\) {\s*return false;\s*}[\s\S]*talents\.value = normalizedTalents;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*currentItems\.every\(\(item, index\) => sameItem\(item, nextItems\[index\]\)\);[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function samePoolSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*String\(current\?\.name \|\| ''\) === String\(next\?\.name \|\| ''\)[\s\S]*String\(current\?\.description \|\| ''\) === String\(next\?\.description \|\| ''\)[\s\S]*Number\(current\?\.talents\?\.length \|\| 0\) === Number\(next\?\.talents\?\.length \|\| 0\);[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function sameTalentSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*String\(current\?\.talentName \|\| ''\) === String\(next\?\.talentName \|\| ''\)[\s\S]*String\(current\?\.talentRarity \|\| ''\) === String\(next\?\.talentRarity \|\| ''\)[\s\S]*String\(current\?\.talentDescription \|\| ''\) === String\(next\?\.talentDescription \|\| ''\)[\s\S]*String\(current\?\.talentEffect \|\| ''\) === String\(next\?\.talentEffect \|\| ''\);[\s\S]*}/
  );
  assert.match(talentRollDialogScript, /setPoolsIfChanged\(poolData\);/);
  assert.match(talentRollDialogScript, /setTalentsIfChanged\(talentData\);/);
  assert.match(talentRollDialogScript, /setTalentsIfChanged\(\[result, \.\.\.talents\.value\]\);/);
  assert.match(talentRollDialogScript, /setTalentsIfChanged\(talents\.value\.filter\(\(t\) => t\.id !== talentId\)\);/);
  assert.ok(countMatches(talentRollDialogScript, /setPoolsIfChanged\(\[\]\);/g) >= 2);
  assert.ok(countMatches(talentRollDialogScript, /setTalentsIfChanged\(\[\]\);/g) >= 3);
  assert.ok(countMatches(talentRollDialogScript, /setTalentsIfChanged\(/g) >= 6);
});
