import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const characterFormSource = readRepoText('frontend/src/views/CharacterFormView.vue');

test('CharacterFormView locks AI actions behind one shared busy state', () => {
  const scriptSetup = readVueBlock(characterFormSource, 'script');
  const template = readVueBlock(characterFormSource, 'template');

  assert.match(
    scriptSetup,
    /const characterAiActionBusy = computed\(\(\) => \([\s\S]*aiLoading\.value[\s\S]*advancedAiLoading\.value[\s\S]*saving\.value[\s\S]*!canEdit\.value[\s\S]*\)\);/
  );
  assert.match(
    scriptSetup,
    /async function completeWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /async function completeAdvancedSettingsWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );

  assert.ok(countMatches(template, /:disabled="characterAiActionBusy"/g) >= 8);
  assert.match(template, /class="primary-button ai-draft-button" type="button" :disabled="characterAiActionBusy" :aria-busy="aiLoading"/);
  assert.match(template, /class="ghost-button"\s+type="button"\s+:disabled="characterAiActionBusy"\s+:aria-busy="advancedAiLoading"/);
  assert.doesNotMatch(template, /:disabled="aiLoading \|\| advancedAiLoading"/);
  assert.doesNotMatch(template, /class="primary-button ai-draft-button" type="button" :disabled="aiLoading"/);
  assert.doesNotMatch(template, /:disabled="advancedAiLoading \|\| !canEdit"/);
});

test('CharacterFormView footer actions share one busy state', () => {
  const scriptSetup = readVueBlock(characterFormSource, 'script');
  const template = readVueBlock(characterFormSource, 'template');

  assert.match(
    scriptSetup,
    /const characterFooterActionBusy = computed\(\(\) => saving\.value \|\| deleting\.value \|\| exporting\.value\);/
  );
  assert.match(
    scriptSetup,
    /async function submit\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    scriptSetup,
    /async function removeCharacter\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    scriptSetup,
    /async function handleExport\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value\)/
  );

  assert.equal(countMatches(template, /:disabled="characterFooterActionBusy"/g), 3);
  assert.match(template, /class="danger-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="deleting"/);
  assert.match(template, /class="ghost-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="exporting"/);
  assert.match(template, /class="primary-button" type="submit" :disabled="characterFooterActionBusy" :aria-busy="saving"/);
  assert.doesNotMatch(template, /:disabled="deleting"/);
  assert.doesNotMatch(template, /:disabled="exporting"/);
  assert.doesNotMatch(template, /type="submit" :disabled="saving"/);
});
