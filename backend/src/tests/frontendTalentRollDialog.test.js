import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const talentRollDialogSource = readRepoText('frontend/src/components/TalentRollDialog.vue');

test('TalentRollDialog disables roll and talent mutations while one action is busy', () => {
  const scriptSetup = readVueBlock(talentRollDialogSource, 'script');
  const template = readVueBlock(talentRollDialogSource, 'template');

  assert.match(scriptSetup, /const removingTalentId = ref\(''\)/);
  assert.match(scriptSetup, /const talentMutationBusy = computed\(\(\) => clearingAll\.value \|\| Boolean\(removingTalentId\.value\)\)/);
  assert.match(scriptSetup, /const talentActionBusy = computed\(\(\) => loading\.value \|\| rolling\.value \|\| talentMutationBusy\.value\)/);
  assert.match(scriptSetup, /pools\.value = \[\];\s*talents\.value = \[\];\s*selectedPoolId\.value = '';/);
  assert.match(scriptSetup, /if \(talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(scriptSetup, /if \(!props\.canEdit \|\| talentActionBusy\.value\)\s*{\s*return;\s*}/);
  assert.match(scriptSetup, /removingTalentId\.value = talentId/);
  assert.match(scriptSetup, /removingTalentId\.value = ''/);

  assert.match(template, /<select v-model="selectedPoolId" :disabled="talentActionBusy \|\| !pools\.length">/);
  assert.match(template, /:disabled="talentActionBusy \|\| !pools\.length \|\| !selectedPoolId"/);
  assert.equal(countMatches(template, /:disabled="talentActionBusy"/g), 2);
  assert.equal(countMatches(template, /:aria-busy=/g), 3);
  assert.match(template, /:aria-busy="removingTalentId === talent\.id"/);
});
