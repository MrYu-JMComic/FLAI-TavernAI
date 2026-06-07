import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { template: chatComposerTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatComposer.vue',
  ['template']
);
const stylesSource = readRepoText('frontend/src/styles.css');
const chatSubmitSource = readRepoText('frontend/src/composables/chat/useChatSubmit.js');
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks('frontend/src/views/ChatView.vue');
const { script: statusBarScript } = readVueBlocks('frontend/src/components/StatusBar.vue', ['script']);

function readStyleRange(startMarker, endMarker, fromIndex = 0) {
  const startIndex = stylesSource.indexOf(startMarker, fromIndex);
  assert.notEqual(startIndex, -1, `missing style marker: ${startMarker}`);
  const endIndex = stylesSource.indexOf(endMarker, startIndex + startMarker.length);
  assert.notEqual(endIndex, -1, `missing style marker: ${endMarker}`);
  return stylesSource.slice(startIndex, endIndex);
}

test('ChatComposer locks configuration controls while sending', () => {
  assert.match(chatComposerTemplate, /<form class="deep-composer" :aria-busy="sending" @submit\.prevent="emit\('submit', \{ isEnter: false \}\)">/);
  assert.match(chatComposerTemplate, /class="preset-select"[\s\S]*:disabled="sending"[\s\S]*@change="emit\('update:selectedPresetId', \$event\.target\.value\)"/);
  assert.match(chatComposerTemplate, /class="mode-pill model-switch-pill"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('open-model-switcher'\)"/);
  assert.match(chatComposerTemplate, /:aria-pressed="String\(useStream\)"[\s\S]*:disabled="sending"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-stream'\)"/);
  assert.match(chatComposerTemplate, /:disabled="sending \|\| !canToggleThinking"[\s\S]*:aria-busy="sending"[\s\S]*@click="emit\('toggle-thinking'\)"/);

  assert.match(chatSubmitSource, /function toggleUseStream\(\)\s*{\s*if \(sending\.value\) {\s*return;\s*}/);
  assert.match(chatSubmitSource, /function toggleThinking\(\)\s*{\s*if \(sending\.value \|\| !canToggleThinking\.value\) {\s*return;\s*}/);
});

test('ChatComposer follows readable width when desktop sidebar is collapsed', () => {
  assert.match(
    stylesSource,
    /\.deep-chat-shell\.sidebar-collapsed\s*{\s*--chat-readable-width:\s*min\(100%, calc\(100vw - 32px\)\);\s*--chat-composer-width:\s*var\(--chat-readable-width\);/
  );
});

test('ChatComposer only uses edge-to-edge layout at the phone breakpoint', () => {
  const tabletBlock = readStyleRange('@media (max-width: 1179px) {', '@media (max-width: 520px) {');
  assert.doesNotMatch(tabletBlock, /\.deep-composer-wrap\s*{[\s\S]*?padding:\s*0\s*;/);
  assert.doesNotMatch(tabletBlock, /\.deep-composer\s*{[\s\S]*?width:\s*100%\s*;/);

  const phoneSearchStart = stylesSource.indexOf('@media (max-width: 520px) {');
  assert.notEqual(phoneSearchStart, -1, 'missing phone search marker');
  const phoneBlock = readStyleRange('@media (max-width: 620px) {', '.chat-model-switcher-overlay {', phoneSearchStart);
  assert.match(phoneBlock, /\.deep-composer-wrap\s*{[\s\S]*?position:\s*fixed\s*;[\s\S]*?padding:\s*0 0 calc\(var\(--chat-keyboard-inset\) \+ env\(safe-area-inset-bottom, 0px\)\)\s*;/);
  assert.match(phoneBlock, /\.deep-composer\s*{[\s\S]*?width:\s*100%\s*;/);
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
