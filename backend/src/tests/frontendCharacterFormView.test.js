import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: characterFormScript,
  template: characterFormTemplate
} = readVueBlocks('frontend/src/views/CharacterFormView.vue');

test('CharacterFormView locks AI actions behind one shared busy state', () => {
  assert.match(
    characterFormScript,
    /const characterAiActionBusy = computed\(\(\) => \([\s\S]*aiLoading\.value[\s\S]*advancedAiLoading\.value[\s\S]*saving\.value[\s\S]*!canEdit\.value[\s\S]*\)\);/
  );
  assert.match(
    characterFormScript,
    /async function completeWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );
  assert.match(
    characterFormScript,
    /async function completeAdvancedSettingsWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );

  assert.ok(countMatches(characterFormTemplate, /:disabled="characterAiActionBusy"/g) >= 8);
  assert.match(characterFormTemplate, /class="primary-button ai-draft-button" type="button" :disabled="characterAiActionBusy" :aria-busy="aiLoading"/);
  assert.match(characterFormTemplate, /class="ghost-button"\s+type="button"\s+:disabled="characterAiActionBusy"\s+:aria-busy="advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="aiLoading \|\| advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /class="primary-button ai-draft-button" type="button" :disabled="aiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="advancedAiLoading \|\| !canEdit"/);
});

test('CharacterFormView footer actions share one busy state', () => {
  assert.match(
    characterFormScript,
    /const characterFooterActionBusy = computed\(\(\) => saving\.value \|\| deleting\.value \|\| exporting\.value\);/
  );
  assert.match(
    characterFormScript,
    /async function submit\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    characterFormScript,
    /async function removeCharacter\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    characterFormScript,
    /async function handleExport\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value\)/
  );

  assert.equal(countMatches(characterFormTemplate, /:disabled="characterFooterActionBusy"/g), 3);
  assert.match(characterFormTemplate, /class="danger-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="deleting"/);
  assert.match(characterFormTemplate, /class="ghost-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="exporting"/);
  assert.match(characterFormTemplate, /class="primary-button" type="submit" :disabled="characterFooterActionBusy" :aria-busy="saving"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="deleting"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="exporting"/);
  assert.doesNotMatch(characterFormTemplate, /type="submit" :disabled="saving"/);
});

test('CharacterFormView tag creation freezes tag controls while pending', () => {
  assert.match(characterFormScript, /const tagCreating = ref\(false\);/);
  assert.match(
    characterFormScript,
    /tagCreateToken \+= 1;\s*tagCreating\.value = false;/
  );
  assert.match(
    characterFormScript,
    /async function createAndSelectTag\(\)\s*{\s*if \(characterFormDisposed \|\| tagCreating\.value \|\| !canEdit\.value\) return;/
  );
  assert.match(
    characterFormScript,
    /const createToken = \+\+tagCreateToken;\s*tagCreating\.value = true;/
  );
  assert.match(
    characterFormScript,
    /finally {\s*if \(isActiveTagCreate\(createToken\)\) {\s*tagCreating\.value = false;/
  );
  assert.match(
    characterFormScript,
    /function isCurrentTagCreate\(createToken, name\) {\s*return isActiveTagCreate\(createToken\)[\s\S]*tagSearch\.value\.trim\(\) === name;/
  );
  assert.match(
    characterFormScript,
    /function isActiveTagCreate\(createToken\) {\s*return !characterFormDisposed && createToken === tagCreateToken;/
  );
  assert.match(
    characterFormScript,
    /function toggleTagSelection\(name\) {\s*if \(!canEdit\.value \|\| tagCreating\.value\) {\s*return;/
  );

  assert.match(characterFormTemplate, /<div class="tag-selector" :class="\{ disabled: !canEdit \|\| tagCreating \}">/);
  assert.match(characterFormTemplate, /@click="canEdit && !tagCreating && toggleTagSelection\(tagName\)"/);
  assert.match(characterFormTemplate, /<span v-if="canEdit && !tagCreating" class="tag-remove">/);
  assert.match(
    characterFormTemplate,
    /class="tag-search-input" aria-label="搜索或创建角色标签" :disabled="tagCreating" :aria-busy="tagCreating"/
  );
  assert.match(
    characterFormTemplate,
    /class="ghost-button tag-create-btn"[\s\S]*:disabled="tagCreating"[\s\S]*:aria-busy="tagCreating"[\s\S]*{{ tagCreating \? '创建中\.\.\.' : '创建' }}/
  );
  assert.match(
    characterFormTemplate,
    /class="tag-option"[\s\S]*:disabled="tagCreating"[\s\S]*@click="toggleTagSelection\(tag\.name\)"/
  );
});
