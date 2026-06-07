import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const chatSettingsDrawerSource = readRepoText('frontend/src/components/chat/ChatSettingsDrawer.vue');
const stylesSource = readRepoText('frontend/src/styles.css');

test('ChatSettingsDrawer locks appearance controls while saving appearance', () => {
  const template = readVueBlock(chatSettingsDrawerSource, 'template');

  assert.equal(countMatches(template, /:disabled="appearanceSaving"/g), 11);
  assert.equal(countMatches(template, /:class="{ 'is-disabled': appearanceSaving }"/g), 2);
  assert.match(template, /:disabled="worldBooksLoading \|\| appearanceSaving"/);
  assert.match(template, /:aria-busy="appearanceSaving"/);
  assert.match(template, /@click="emit\('reset-appearance'\)"/);
  assert.match(template, /@click="emit\('save-appearance'\)"/);

  assert.match(stylesSource, /\.chat-setting-upload\.is-disabled,/);
  assert.match(stylesSource, /\.chat-setting-inline-button:disabled/);
  assert.match(stylesSource, /\.chat-setting-upload\.is-disabled input/);
});

test('ChatSettingsDrawer freezes status bar editor fields while saving status bar', () => {
  const template = readVueBlock(chatSettingsDrawerSource, 'template');

  assert.match(
    template,
    /<button v-if="!statusBar" class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('open-status-bar-editor'\)">/
  );
  assert.match(
    template,
    /<button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('open-status-bar-editor'\)">/
  );
  assert.match(
    template,
    /<button class="chat-setting-inline-button danger" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('delete-status-bar'\)">/
  );
  assert.match(template, /<div v-if="statusBarEditorOpen" class="status-bar-editor" :aria-busy="statusBarSaving">/);
  assert.match(template, /<fieldset class="status-bar-editor-fields" :disabled="statusBarSaving">/);
  assert.match(template, /<\/fieldset>\s*<div class="status-bar-editor-footer">/);
  assert.match(
    template,
    /<button class="chat-settings-save" type="button" :disabled="statusBarSaving \|\| statusBarTemplateIssues\.length > 0" :aria-busy="statusBarSaving" @click="emit\('save-status-bar'\)">/
  );
  assert.match(
    template,
    /<button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" @click="emit\('close-status-bar-editor'\)">/
  );

  assert.match(stylesSource, /\.status-bar-editor-fields\s*{\s*display: grid;/);
  assert.match(stylesSource, /\.status-bar-editor-fields:disabled/);
  assert.match(stylesSource, /\.variable-remove:hover:not\(:disabled\)/);
});

test('ChatSettingsDrawer freezes accessory skill fields while saving accessory settings', () => {
  const template = readVueBlock(chatSettingsDrawerSource, 'template');

  assert.match(
    template,
    /<fieldset v-if="accessorySettingsOpen" class="accessory-skills-grid" :disabled="accessorySaving" :aria-busy="accessorySaving">/
  );
  assert.match(template, /<\/fieldset>\s*<\/section>\s*<section class="chat-settings-section">/);
  assert.match(template, /@click="emit\('save-accessory'\)"/);

  assert.match(stylesSource, /fieldset\.accessory-skills-grid\s*{\s*min-width: 0;/);
  assert.match(stylesSource, /fieldset\.accessory-skills-grid:disabled/);
});
