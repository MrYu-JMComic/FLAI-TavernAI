import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatModelSwitcherScript, template: chatModelSwitcherTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatModelSwitcher.vue'
);
const { script: chatViewScript } = readVueBlocks('frontend/src/views/ChatView.vue', ['script']);
const stylesSource = readRepoText('frontend/src/styles.css');

test('ChatModelSwitcher locks model selection while saving', () => {
  assert.match(chatModelSwitcherScript, /const modelSelectionLocked = computed\(\(\) => props\.saving\)/);
  assert.match(chatModelSwitcherScript, /const canRefresh = computed\(\(\) => Boolean\(props\.provider\?\.baseUrl\) && !props\.refreshing && !modelSelectionLocked\.value\)/);
  assert.match(chatModelSwitcherScript, /function chooseModel\(modelId\)\s*{\s*if \(modelSelectionLocked\.value\) return;/);

  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving \|\| refreshing"/);
  assert.match(chatModelSwitcherTemplate, /:class="{ 'is-disabled': modelSelectionLocked }"/);
  assert.match(chatModelSwitcherTemplate, /<input v-model\.trim="search" type="search" placeholder="搜索当前网关模型" :disabled="modelSelectionLocked" \/>/);
  assert.match(chatModelSwitcherTemplate, /:disabled="modelSelectionLocked"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving && draftModel === model\.id"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="saving"/);
  assert.match(chatModelSwitcherTemplate, /:aria-busy="refreshing"/);

  assert.match(stylesSource, /\.chat-model-search\.is-disabled/);
  assert.match(stylesSource, /\.chat-model-option:hover:not\(:disabled\),/);
  assert.match(stylesSource, /\.chat-model-option:disabled/);
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
