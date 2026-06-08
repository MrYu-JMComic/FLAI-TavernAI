import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatModelSwitcherScript, template: chatModelSwitcherTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatModelSwitcher.vue'
);
const { script: chatViewScript } = readVueBlocks('frontend/src/views/ChatView.vue', ['script']);
const stylesSource = readFrontendStyles();

test('ChatModelSwitcher locks model selection while saving', () => {
  assert.match(chatModelSwitcherScript, /const modelSelectionLocked = computed\(\(\) => props\.saving\)/);
  assert.match(chatModelSwitcherScript, /const canRefresh = computed\(\(\) => Boolean\(props\.provider\?\.baseUrl\) && !props\.refreshing && !modelSelectionLocked\.value\)/);
  assert.match(chatModelSwitcherScript, /function chooseModel\(modelId\)\s*{\s*if \(modelSelectionLocked\.value\) return;\s*if \(!hasModelOption\(modelOptions\.value, modelId\)\) return;/);
  assert.match(chatModelSwitcherScript, /function closeSwitcher\(\)\s*{\s*if \(props\.saving\) return;\s*emit\('close'\);/);

  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving \|\| refreshing"/);
  assert.match(chatModelSwitcherTemplate, /@click\.self="closeSwitcher"/);
  assert.match(chatModelSwitcherTemplate, /:class="{ 'is-disabled': modelSelectionLocked }"/);
  assert.match(chatModelSwitcherTemplate, /<input v-model\.trim="search" type="search" placeholder="[^"]+" aria-label="[^"]+" :disabled="modelSelectionLocked" \/>/);
  assert.match(chatModelSwitcherTemplate, /:disabled="modelSelectionLocked"/);
  assert.match(chatModelSwitcherTemplate, /:disabled="saving" :aria-busy="saving" @click="closeSwitcher"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving && draftModel === model\.id"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="refreshing"/);
  assert.doesNotMatch(chatModelSwitcherTemplate, /@click="emit\('close'\)"/);

  assert.match(stylesSource, /\.chat-model-search\.is-disabled/);
  assert.match(stylesSource, /\.chat-model-option:hover:not\(:disabled\),/);
  assert.match(stylesSource, /\.chat-model-option:disabled/);
});

test('ChatModelSwitcher filters model search results without model-options filter callbacks', () => {
  assert.match(
    chatModelSwitcherScript,
    /const filteredModels = computed\(\(\) => filterModelOptions\(modelOptions\.value, search\.value\)\);/
  );
  assert.match(
    chatModelSwitcherScript,
    /function filterModelOptions\(options, rawKeyword\) \{\s*const currentOptions = Array\.isArray\(options\) \? options : \[\];\s*const keyword = String\(rawKeyword \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*if \(!keyword\) \{\s*return currentOptions;\s*\}[\s\S]*const matches = \[\];\s*for \(const model of currentOptions\) \{[\s\S]*matches\.push\(model\);[\s\S]*\}\s*return matches;\s*\}/
  );
  assert.doesNotMatch(chatModelSwitcherScript, /modelOptions\.value\.filter\(/);
});

test('ChatModelSwitcher keeps draft model scoped to refreshed options', () => {
  assert.match(
    chatModelSwitcherScript,
    /const canSave = computed\(\(\) => \{[\s\S]*draftModel\.value !== currentModel\.value &&[\s\S]*hasModelOption\(modelOptions\.value, draftModel\.value\) &&[\s\S]*!props\.saving;[\s\S]*\}\);/
  );
  assert.match(
    chatModelSwitcherScript,
    /watch\(modelOptions, \(options\) => \{\s*if \(!props\.open\) return;\s*syncDraftModelWithOptions\(options\);[\s\S]*\}\);/
  );
  assert.match(
    chatModelSwitcherScript,
    /function hasModelOption\(options, modelId\)\s*{\s*const id = String\(modelId \|\| ''\)\.trim\(\);[\s\S]*if \(!id\) {[\s\S]*return false;[\s\S]*const currentOptions = Array\.isArray\(options\) \? options : \[\];[\s\S]*for \(const model of currentOptions\) {[\s\S]*if \(model\?\.id === id\) {[\s\S]*return true;[\s\S]*return false;[\s\S]*}/
  );
  assert.match(
    chatModelSwitcherScript,
    /function syncDraftModelWithOptions\(options = modelOptions\.value\)\s*{\s*const current = currentModel\.value;[\s\S]*if \(!draftModel\.value\) {[\s\S]*draftModel\.value = current;[\s\S]*return;[\s\S]*if \(hasModelOption\(options, draftModel\.value\)\) {[\s\S]*return;[\s\S]*draftModel\.value = current;[\s\S]*}/
  );
  assert.doesNotMatch(chatModelSwitcherScript, /modelOptions\.value\.some/);
});

test('ChatView guards model switcher refresh and save handlers while work is pending', () => {
  assert.match(
    chatViewScript,
    /async function refreshQuickModels\(\)\s*{\s*if \(modelSwitcherRefreshing\.value \|\| modelSwitcherSaving\.value\)\s*{\s*return;\s*}/
  );
  assert.match(
    chatViewScript,
    /async function saveQuickModel\(model\)\s*{\s*if \(modelSwitcherSaving\.value\)\s*{\s*return;\s*}/
  );
});
