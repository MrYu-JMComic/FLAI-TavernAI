import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const chatModelSwitcherSource = readRepoText('frontend/src/components/chat/ChatModelSwitcher.vue');
const chatViewSource = readRepoText('frontend/src/views/ChatView.vue');
const stylesSource = readRepoText('frontend/src/styles.css');

test('ChatModelSwitcher locks model selection while saving', () => {
  const scriptSetup = readVueBlock(chatModelSwitcherSource, 'script');
  const template = readVueBlock(chatModelSwitcherSource, 'template');

  assert.match(scriptSetup, /const modelSelectionLocked = computed\(\(\) => props\.saving\)/);
  assert.match(scriptSetup, /const canRefresh = computed\(\(\) => Boolean\(props\.provider\?\.baseUrl\) && !props\.refreshing && !modelSelectionLocked\.value\)/);
  assert.match(scriptSetup, /function chooseModel\(modelId\)\s*{\s*if \(modelSelectionLocked\.value\) return;/);

  assert.match(template, /:aria-busy="saving \|\| refreshing"/);
  assert.match(template, /:class="{ 'is-disabled': modelSelectionLocked }"/);
  assert.match(template, /<input v-model\.trim="search" type="search" placeholder="搜索当前网关模型" :disabled="modelSelectionLocked" \/>/);
  assert.match(template, /:disabled="modelSelectionLocked"/);
  assert.match(template, /:aria-busy="saving && draftModel === model\.id"/);
  assert.match(template, /:aria-busy="saving"/);
  assert.match(template, /:aria-busy="refreshing"/);

  assert.match(stylesSource, /\.chat-model-search\.is-disabled/);
  assert.match(stylesSource, /\.chat-model-option:hover:not\(:disabled\),/);
  assert.match(stylesSource, /\.chat-model-option:disabled/);
});

test('ChatView guards model switcher refresh and save handlers while work is pending', () => {
  const scriptSetup = readVueBlock(chatViewSource, 'script');

  assert.match(
    scriptSetup,
    /async function refreshQuickModels\(\)\s*{\s*if \(modelSwitcherRefreshing\.value \|\| modelSwitcherSaving\.value\)\s*{\s*return;\s*}/
  );
  assert.match(
    scriptSetup,
    /async function saveQuickModel\(model\)\s*{\s*if \(modelSwitcherSaving\.value\)\s*{\s*return;\s*}/
  );
});
