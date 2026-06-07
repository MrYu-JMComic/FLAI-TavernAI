import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const settingsViewSource = readRepoText('frontend/src/views/SettingsView.vue');

test('SettingsView model refresh ignores events while refresh is unavailable or already loading', () => {
  const scriptSetup = readVueBlock(settingsViewSource, 'script');
  const template = readVueBlock(settingsViewSource, 'template');

  assert.match(
    template,
    /<button class="ghost-button compact-button" type="button" :disabled="!canFetchModels \|\| modelLoading" @click="loadModels">/
  );
  assert.match(
    scriptSetup,
    /async function loadModels\(\) {\s*if \(!isPersonalPage\.value \|\| modelLoading\.value \|\| !canFetchModels\.value\) {\s*return;\s*}/
  );
});
