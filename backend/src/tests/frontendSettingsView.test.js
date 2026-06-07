import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const settingsViewSource = readRepoText('frontend/src/views/SettingsView.vue');

test('SettingsView personal-page retry and balance handlers ignore disabled states', () => {
  const scriptSetup = readVueBlock(settingsViewSource, 'script');
  const template = readVueBlock(settingsViewSource, 'template');

  assert.match(
    template,
    /<button class="ghost-button" type="button" :disabled="loading" @click="loadSettings">/
  );
  assert.match(
    scriptSetup,
    /async function loadSettings\(\) {\s*if \(!isPersonalPage\.value \|\| loading\.value\) {\s*return;\s*}/
  );
  assert.match(
    template,
    /:disabled="!canCheckBalance \|\| balanceLoading"[\s\S]*@click="checkBalance"/
  );
  assert.match(
    scriptSetup,
    /async function checkBalance\(\) {\s*if \(!isPersonalPage\.value \|\| balanceLoading\.value \|\| !canCheckBalance\.value\) {\s*return;\s*}/
  );
});

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

test('SettingsView extension retry handlers ignore events while already loading', () => {
  const scriptSetup = readVueBlock(settingsViewSource, 'script');
  const template = readVueBlock(settingsViewSource, 'template');

  const cases = [
    ['loadTags', 'tagLoading'],
    ['loadPresets', 'presetLoading'],
    ['loadMods', 'modLoading'],
    ['loadModCharacterOptions', 'modCharactersLoading'],
    ['loadRegexRules', 'regexLoading']
  ];

  for (const [handler, loadingRef] of cases) {
    assert.match(
      template,
      new RegExp(`:disabled="${loadingRef}" @click="${handler}"`)
    );
    assert.match(
      scriptSetup,
      new RegExp(`async function ${handler}\\(\\) \\{\\s*if \\(!isExtensionsPage\\.value \\|\\| ${loadingRef}\\.value\\) \\{\\s*return;\\s*\\}`)
    );
  }
});
