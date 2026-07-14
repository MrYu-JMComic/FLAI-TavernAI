import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: summaryScript, template: summaryTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatStatusSummary.vue'
);
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks(
  'frontend/src/views/ChatView.vue',
  ['script', 'template']
);
const { script: statusBarScript, template: statusBarTemplate } = readVueBlocks(
  'frontend/src/components/StatusBar.vue',
  ['script', 'template']
);
const stylesSource = readFrontendStyles();

test('ChatStatusSummary exposes a controlled inline disclosure', () => {
  assert.match(summaryScript, /expanded: \{ type: Boolean, default: false \}/);
  assert.match(summaryScript, /const emit = defineEmits\(\['update:expanded'\]\);/);
  assert.match(summaryScript, /function toggleExpanded\(\) \{\s*emit\('update:expanded', !props\.expanded\);\s*\}/);
  assert.match(summaryTemplate, /:aria-expanded="String\(expanded\)"/);
  assert.match(summaryTemplate, /:aria-label="expanded \? '收起完整角色状态' : '展开完整角色状态'"/);
  assert.match(summaryTemplate, /<Transition name="chat-status-expand">[\s\S]*class="chat-status-details"[\s\S]*<slot name="details" \/>/);
  assert.doesNotMatch(summaryTemplate, /emit\('open'/);
});

test('ChatView renders the full status bar inside the expanding summary', () => {
  assert.match(chatViewScript, /const statusSummaryExpanded = ref\(false\);/);
  assert.match(chatViewTemplate, /<ChatStatusSummary[\s\S]*v-model:expanded="statusSummaryExpanded"[\s\S]*<template #details>[\s\S]*<StatusBar[\s\S]*embedded/);
  assert.match(chatViewScript, /watch\(statusSummaryExpanded, async \(expanded\) => \{[\s\S]*await nextTick\(\);[\s\S]*querySelector\('\.chat-status-disclosure'\)[\s\S]*scrollIntoView/);
  assert.match(chatViewScript, /if \(statusSummaryExpanded\.value\) \{\s*statusSummaryExpanded\.value = false;/);
});

test('StatusBar embedded mode keeps inline details expanded without duplicate collapse chrome', () => {
  assert.match(statusBarScript, /embedded: \{\s*type: Boolean,\s*default: false\s*\}/);
  assert.match(statusBarScript, /const effectiveCollapsed = computed\(\(\) => !props\.embedded && collapsed\.value\);/);
  assert.match(statusBarTemplate, /:aria-expanded="String\(!effectiveCollapsed\)"/);
  assert.match(statusBarTemplate, /v-if="effectiveCollapsed"/);
  assert.match(statusBarTemplate, /v-if="!embedded" class="flai-statusbar-header"/);
});

test('Chat status disclosure joins the summary and inline details visually', () => {
  assert.match(stylesSource, /\.chat-status-disclosure\s*\{[\s\S]*scroll-margin-bottom:\s*calc\(var\(--chat-composer-height\) \+ 16px\);/);
  assert.match(stylesSource, /\.chat-status-disclosure\.is-expanded \.chat-status-summary\s*\{[\s\S]*border-radius:\s*var\(--radius-md\) var\(--radius-md\) 0 0;/);
  assert.match(stylesSource, /\.chat-status-details\s*\{[\s\S]*border-radius:\s*0 0 var\(--radius-md\) var\(--radius-md\);/);
  assert.match(stylesSource, /\.chat-status-disclosure\.is-expanded \.chat-status-summary-chevron\s*\{\s*transform:\s*rotate\(180deg\);/);
});
