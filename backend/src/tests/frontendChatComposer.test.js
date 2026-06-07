import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const chatComposerSource = readRepoText('frontend/src/components/chat/ChatComposer.vue');
const chatSubmitSource = readRepoText('frontend/src/composables/chat/useChatSubmit.js');
const chatViewSource = readRepoText('frontend/src/views/ChatView.vue');

test('ChatComposer locks configuration controls while sending', () => {
  const template = readVueBlock(chatComposerSource, 'template');

  assert.match(template, /<form class="deep-composer" :aria-busy="sending" @submit\.prevent="emit\('submit', \{ isEnter: false \}\)">/);
  assert.match(template, /class="preset-select"[\s\S]*:disabled="sending"[\s\S]*@change="emit\('update:selectedPresetId', \$event\.target\.value\)"/);
  assert.match(template, /class="mode-pill model-switch-pill"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('open-model-switcher'\)"/);
  assert.match(template, /:aria-pressed="String\(useStream\)"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-stream'\)"/);
  assert.match(template, /:disabled="sending \|\| !canToggleThinking"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-thinking'\)"/);

  assert.match(chatSubmitSource, /function toggleUseStream\(\)\s*{\s*if \(sending\.value\) {\s*return;\s*}/);
  assert.match(chatSubmitSource, /function toggleThinking\(\)\s*{\s*if \(sending\.value \|\| !canToggleThinking\.value\) {\s*return;\s*}/);
});

test('ChatView ignores model switcher open events while sending', () => {
  const scriptSetup = readVueBlock(chatViewSource, 'script');

  assert.match(
    scriptSetup,
    /function openModelSwitcher\(\) {\s*if \(sending\.value\) {\s*return;\s*}\s*syncProviderModels\(\);\s*modelSwitcherOpen\.value = true;\s*}/
  );
});

test('ChatView routes preset selection through the guarded submit setter', () => {
  const scriptSetup = readVueBlock(chatViewSource, 'script');
  const template = readVueBlock(chatViewSource, 'template');

  assert.match(scriptSetup, /submit, stop, setSelectedPresetId, toggleUseStream, toggleThinking/);
  assert.match(template, /@update:selected-preset-id="setSelectedPresetId"/);
  assert.doesNotMatch(template, /@update:selected-preset-id="\([^"]+\) => selectedPresetId =/);
});
