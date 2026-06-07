import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { template: chatComposerTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatComposer.vue',
  ['template']
);
const chatSubmitSource = readRepoText('frontend/src/composables/chat/useChatSubmit.js');
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue');
const { script: statusBarScript } = readVueBlocks('frontend/src/components/StatusBar.vue', ['script']);

test('ChatComposer locks configuration controls while sending', () => {
  assert.match(chatComposerTemplate, /<form class="deep-composer" :aria-busy="sending" @submit\.prevent="emit\('submit', \{ isEnter: false \}\)">/);
  assert.match(chatComposerTemplate, /class="preset-select"[\s\S]*:disabled="sending"[\s\S]*@change="emit\('update:selectedPresetId', \$event\.target\.value\)"/);
  assert.match(chatComposerTemplate, /class="mode-pill model-switch-pill"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('open-model-switcher'\)"/);
  assert.match(chatComposerTemplate, /:aria-pressed="String\(useStream\)"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-stream'\)"/);
  assert.match(chatComposerTemplate, /:disabled="sending \|\| !canToggleThinking"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-thinking'\)"/);

  assert.match(chatSubmitSource, /function toggleUseStream\(\)\s*{\s*if \(sending\.value\) {\s*return;\s*}/);
  assert.match(chatSubmitSource, /function toggleThinking\(\)\s*{\s*if \(sending\.value \|\| !canToggleThinking\.value\) {\s*return;\s*}/);
});

test('ChatView ignores model switcher open events while sending', () => {
  assert.match(
    chatViewScript,
    /function openModelSwitcher\(\) {\s*if \(sending\.value\) {\s*return;\s*}\s*syncProviderModels\(\);\s*modelSwitcherOpen\.value = true;\s*}/
  );
});

test('ChatView routes preset selection through the guarded submit setter', () => {
  assert.match(chatViewScript, /submit, stop, setSelectedPresetId, toggleUseStream, toggleThinking/);
  assert.match(chatViewTemplate, /@update:selected-preset-id="setSelectedPresetId"/);
  assert.doesNotMatch(chatViewTemplate, /@update:selected-preset-id="\([^"]+\) => selectedPresetId =/);
});

test('ChatView requests mobile status bar collapse before assistant-reply anchoring', () => {
  assert.match(chatViewScript, /const statusBarCollapseRequest = ref\(0\)/);
  assert.match(chatViewScript, /function prepareExpandedStatusBarForSubmit\(\) {[\s\S]*aria-expanded'[\s\S]*statusBarExpanded && chatViewportIsPhone\.value[\s\S]*statusBarCollapseRequest\.value \+= 1;[\s\S]*return statusBarExpanded;/);
  assert.match(chatViewScript, /prepareExpandedStatusBarForSubmit,/);
  assert.match(chatViewTemplate, /:collapse-request="statusBarCollapseRequest"/);
  assert.match(statusBarScript, /collapseRequest: \{\s*type: Number,\s*default: 0\s*\}/);
  assert.match(statusBarScript, /watch\(\(\) => props\.collapseRequest,[\s\S]*setCollapsed\(true\);[\s\S]*\}\);/);
});
