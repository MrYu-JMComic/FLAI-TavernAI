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
  assert.match(talentRollDialogScript, /if \(!props\.canEdit \|\| talentActionBusy\.value \|\| !isCurrentTalentId\(talentId\)\)\s*{\s*return;\s*}/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = talentId/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = ''/);

  assert.match(talentRollDialogTemplate, /<select v-model="selectedPoolId" :disabled="talentActionBusy \|\| !pools\.length">/);
  assert.match(talentRollDialogTemplate, /@click\.self="requestClose"/);
  assert.match(talentRollDialogTemplate, /@keydown\.esc\.prevent="requestClose"/);
  assert.match(talentRollDialogTemplate, /:disabled="dialogCloseLocked"[\s\S]*:aria-busy="dialogCloseLocked"[\s\S]*@click="requestClose"/);
  assert.match(talentRollDialogTemplate, /:disabled="talentActionBusy \|\| !pools\.length \|\| !selectedPool"/);
  assert.equal(countMatches(talentRollDialogTemplate, /:disabled="talentActionBusy"/g), 2);
  assert.equal(countMatches(talentRollDialogTemplate, /:aria-busy=/g), 5);
  assert.match(talentRollDialogTemplate, /:aria-busy="removingTalentId === talent\.id"/);
  assert.doesNotMatch(talentRollDialogTemplate, /emit\('close'\)/);
});

test('TalentRollDialog ignores stale pool and talent item actions before mutations', () => {
  assert.match(
    talentRollDialogScript,
    /function isCurrentPoolId\(poolId\)\s*{\s*return Boolean\(getCurrentPoolById\(poolId\)\);[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function isCurrentTalentId\(talentId\)\s*{\s*const id = String\(talentId \|\| ''\);[\s\S]*if \(!id \|\| !characterId\) {[\s\S]*return false;[\s\S]*for \(const talent of talents\.value\) {[\s\S]*if \(talent\?\.id === id && talent\?\.characterId === characterId\) {[\s\S]*return true;[\s\S]*return false;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /if \(!isCurrentPoolId\(selectedPoolId\.value\)\) \{\s*notify\.warning\('请先选择一个天赋池'\);\s*return;\s*\}/
  );
  assert.match(
    talentRollDialogScript,
    /if \(!isCurrentDialogContext\(context\)\) \{\s*return;\s*\}\s*if \(selectedPoolId\.value !== poolId \|\| !isCurrentPoolId\(poolId\)\) \{\s*rolling\.value = false;\s*return;\s*\}/
  );
  assert.match(
    talentRollDialogScript,
    /async function removeTalent\(talentId\)\s*{\s*if \(!props\.canEdit \|\| talentActionBusy\.value \|\| !isCurrentTalentId\(talentId\)\) \{\s*return;\s*\}[\s\S]*removingTalentId\.value = talentId;/
  );
});

test('TalentRollDialog preserves unchanged pool and talent list references during refreshes', () => {
  assert.match(
    talentRollDialogScript,
    /const selectedPool = computed\(\(\) => getCurrentPoolById\(selectedPoolId\.value\)\);/
  );
  assert.match(
    talentRollDialogScript,
    /function setPoolsIfChanged\(nextPools\)\s*{\s*const normalizedPools = Array\.isArray\(nextPools\) \? nextPools : \[\];[\s\S]*if \(sameListItems\(currentPools, normalizedPools, samePoolSummary\)\) {\s*syncSelectedPoolWithPoolList\(normalizedPools\);\s*return false;\s*}[\s\S]*pools\.value = normalizedPools;\s*syncSelectedPoolWithPoolList\(normalizedPools\);[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function setTalentsIfChanged\(nextTalents\)\s*{\s*const normalizedTalents = Array\.isArray\(nextTalents\) \? nextTalents : \[\];[\s\S]*if \(sameListItems\(currentTalents, normalizedTalents, sameTalentSummary\)\) {\s*return false;\s*}[\s\S]*talents\.value = normalizedTalents;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*for \(let index = 0; index < currentItems\.length; index \+= 1\) {[\s\S]*if \(!sameItem\(currentItems\[index\], nextItems\[index\]\)\) {[\s\S]*return false;[\s\S]*return true;[\s\S]*}/
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
  assert.match(talentRollDialogScript, /prependTalentIfChanged\(result\);/);
  assert.match(
    talentRollDialogScript,
    /function prependTalentIfChanged\(talent\) \{\s*if \(!talent\) return false;\s*const nextTalents = \[talent\];[\s\S]*for \(const currentTalent of talents\.value\) \{[\s\S]*nextTalents\.push\(currentTalent\);[\s\S]*return setTalentsIfChanged\(nextTalents\);/
  );
  assert.match(
    talentRollDialogScript,
    /function removeTalentByIdIfPresent\(talentId\) \{\s*const nextTalents = \[\];\s*let changed = false;[\s\S]*for \(const talent of talents\.value\) \{[\s\S]*if \(talent\?\.id === talentId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextTalents\.push\(talent\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setTalentsIfChanged\(nextTalents\);[\s\S]*return changed;/
  );
  assert.match(talentRollDialogScript, /await deleteCharacterTalent\(context\.characterId, talentId\);[\s\S]*removeTalentByIdIfPresent\(talentId\);/);
  assert.ok(countMatches(talentRollDialogScript, /setPoolsIfChanged\(\[\]\);/g) >= 2);
  assert.ok(countMatches(talentRollDialogScript, /setTalentsIfChanged\(\[\]\);/g) >= 3);
  assert.ok(countMatches(talentRollDialogScript, /setTalentsIfChanged\(/g) >= 6);
  assert.doesNotMatch(talentRollDialogScript, /currentItems\.every/);
  assert.doesNotMatch(talentRollDialogScript, /\[\s*result,\s*\.\.\.talents\.value\s*\]/);
  assert.doesNotMatch(talentRollDialogScript, /setTalentsIfChanged\(talents\.value\.filter/);
});

test('TalentRollDialog syncs selected pool after pool-list refreshes', () => {
  assert.match(
    talentRollDialogScript,
    /function getCurrentPoolById\(poolId, poolList = pools\.value\)\s*{\s*const id = String\(poolId \|\| ''\);[\s\S]*if \(!id\) {[\s\S]*return null;[\s\S]*const currentPools = Array\.isArray\(poolList\) \? poolList : \[\];[\s\S]*for \(const pool of currentPools\) {[\s\S]*if \(pool\?\.id === id\) {[\s\S]*return pool;[\s\S]*return null;[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /function syncSelectedPoolWithPoolList\(currentPools\)\s*{\s*const normalizedPools = Array\.isArray\(currentPools\) \? currentPools : \[\];[\s\S]*if \(getCurrentPoolById\(selectedPoolId\.value, normalizedPools\)\) {[\s\S]*return;[\s\S]*selectedPoolId\.value = normalizedPools\[0\]\?\.id \|\| '';[\s\S]*}/
  );
  assert.match(
    talentRollDialogScript,
    /if \(sameListItems\(currentPools, normalizedPools, samePoolSummary\)\) {\s*syncSelectedPoolWithPoolList\(normalizedPools\);\s*return false;\s*}/
  );
  assert.match(
    talentRollDialogScript,
    /pools\.value = normalizedPools;\s*syncSelectedPoolWithPoolList\(normalizedPools\);/
  );
  assert.doesNotMatch(talentRollDialogScript, /pools\.value\.some/);
});
