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
  assert.match(talentRollDialogScript, /pools\.value = \[\];\s*talents\.value = \[\];\s*selectedPoolId\.value = '';/);
  assert.match(talentRollDialogScript, /if \(talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(talentRollDialogScript, /if \(!props\.canEdit \|\| talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = talentId/);
  assert.match(talentRollDialogScript, /removingTalentId\.value = ''/);

  assert.match(talentRollDialogTemplate, /<select v-model="selectedPoolId" :disabled="talentActionBusy \|\| !pools\.length">/);
  assert.match(talentRollDialogTemplate, /:disabled="talentActionBusy \|\| !pools\.length \|\| !selectedPoolId"/);
  assert.equal(countMatches(talentRollDialogTemplate, /:disabled="talentActionBusy"/g), 2);
  assert.equal(countMatches(talentRollDialogTemplate, /:aria-busy=/g), 4);
  assert.match(talentRollDialogTemplate, /:aria-busy="removingTalentId === talent\.id"/);
});
