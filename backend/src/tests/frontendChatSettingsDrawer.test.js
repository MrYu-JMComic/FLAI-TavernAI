import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: chatSettingsDrawerScript, template: chatSettingsDrawerTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatSettingsDrawer.vue',
  ['script', 'template']
);
const stylesSource = readFrontendStyles();

test('ChatSettingsDrawer keeps close actions visible but locked while saves are pending', () => {
  assert.match(
    chatSettingsDrawerScript,
    /const drawerCloseLocked = computed\(\(\) => props\.appearanceSaving \|\| props\.accessorySaving \|\| props\.statusBarSaving\)/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function requestClose\(\)\s*{\s*if \(drawerCloseLocked\.value\) return;\s*emit\('close'\);/
  );
  assert.match(chatSettingsDrawerTemplate, /:disabled="drawerCloseLocked"[\s\S]*:aria-busy="drawerCloseLocked"[\s\S]*@click="requestClose"/);
  assert.match(
    chatSettingsDrawerTemplate,
    /class="deep-icon-button" type="button" aria-label="关闭设置" title="关闭设置" :disabled="drawerCloseLocked" :aria-busy="drawerCloseLocked" @click="requestClose"/
  );
  assert.doesNotMatch(chatSettingsDrawerTemplate, /@click="emit\('close'\)"/);
});

test('ChatSettingsDrawer locks appearance controls while saving appearance', () => {
  assert.equal(countMatches(chatSettingsDrawerTemplate, /:disabled="appearanceSaving"/g), 11);
  assert.equal(countMatches(chatSettingsDrawerTemplate, /:class="{ 'is-disabled': appearanceSaving }"/g), 2);
  assert.match(chatSettingsDrawerTemplate, /:disabled="worldBooksLoading \|\| appearanceSaving"/);
  assert.match(chatSettingsDrawerTemplate, /:aria-busy="appearanceSaving"/);
  assert.match(chatSettingsDrawerTemplate, /@click="emit\('reset-appearance'\)"/);
  assert.match(chatSettingsDrawerTemplate, /@click="emit\('save-appearance'\)"/);

  assert.match(stylesSource, /\.chat-setting-upload\.is-disabled,/);
  assert.match(stylesSource, /\.chat-setting-inline-button:disabled/);
  assert.match(stylesSource, /\.chat-setting-upload\.is-disabled input/);
});

test('ChatSettingsDrawer resolves chat lorebook binding labels without template list scans', () => {
  assert.match(
    chatSettingsDrawerScript,
    /const chatLorebookBindingLabel = computed\(\(\) => \{[\s\S]*const books = Array\.isArray\(props\.worldBooks\) \? props\.worldBooks : \[\];[\s\S]*for \(let index = 0; index < books\.length; index \+= 1\) \{[\s\S]*if \(book\?\.id === selectedId\) \{[\s\S]*return book\?\.name \|\| selectedId;[\s\S]*return selectedId;[\s\S]*\}\);/
  );
  assert.match(chatSettingsDrawerTemplate, /v-else-if="chatLorebookBindingLabel"[\s\S]*已绑定：\{\{ chatLorebookBindingLabel \}\}/);
  assert.doesNotMatch(chatSettingsDrawerTemplate, /worldBooks\.find\(/);
});

test('ChatSettingsDrawer input handlers tolerate missing event targets', () => {
  assert.match(
    chatSettingsDrawerScript,
    /function readEventTargetValue\(event\) {\s*const target = event\?\.target;\s*return target && target\.value !== undefined \? target\.value : undefined;\s*}/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function onChatLorebookChange\(event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*emit\('update:chatLorebookId', value \|\| null\);\s*}/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function onStatusBarTemplateModeChange\(event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*emit\('update:statusBarTemplateMode', value\);\s*}/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function setColorValueFromEvent\(target, key, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setColorValue\(target, key, value\);\s*}/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function setStatusBarVariableValueFromEvent\(name, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setStatusBarVariableValue\(name, value\);\s*}/
  );
  assert.match(chatSettingsDrawerTemplate, /@change="onChatLorebookChange"/);
  assert.match(chatSettingsDrawerTemplate, /@change="onStatusBarTemplateModeChange"/);
  assert.equal(countMatches(chatSettingsDrawerTemplate, /setColorValueFromEvent\(/g), 4);
  assert.match(chatSettingsDrawerTemplate, /@input="setStatusBarVariableValueFromEvent\(part\.name, \$event\)"/);
  assert.doesNotMatch(chatSettingsDrawerTemplate, /\$event\.target\.value/);
});

test('ChatSettingsDrawer freezes status bar editor fields while saving status bar', () => {
  assert.match(
    chatSettingsDrawerTemplate,
    /<button v-if="!statusBar" class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('open-status-bar-editor'\)">/
  );
  assert.match(
    chatSettingsDrawerTemplate,
    /<button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('open-status-bar-editor'\)">/
  );
  assert.match(
    chatSettingsDrawerTemplate,
    /<button class="chat-setting-inline-button danger" type="button" :disabled="statusBarSaving" :aria-busy="statusBarSaving" @click="emit\('delete-status-bar'\)">/
  );
  assert.match(chatSettingsDrawerTemplate, /<div v-if="statusBarEditorOpen" class="status-bar-editor" :aria-busy="statusBarSaving">/);
  assert.match(chatSettingsDrawerTemplate, /<fieldset class="status-bar-editor-fields" :disabled="statusBarSaving">/);
  assert.match(chatSettingsDrawerTemplate, /<\/fieldset>\s*<div class="status-bar-editor-footer">/);
  assert.match(
    chatSettingsDrawerTemplate,
    /<button class="chat-settings-save" type="button" :disabled="statusBarSaving \|\| statusBarTemplateIssues\.length > 0" :aria-busy="statusBarSaving" @click="emit\('save-status-bar'\)">/
  );
  assert.match(
    chatSettingsDrawerTemplate,
    /<button class="chat-setting-inline-button" type="button" :disabled="statusBarSaving" @click="emit\('close-status-bar-editor'\)">/
  );

  assert.match(stylesSource, /\.status-bar-editor-fields\s*{\s*display: grid;/);
  assert.match(stylesSource, /\.status-bar-editor-fields:disabled/);
  assert.match(stylesSource, /\.variable-remove:hover:not\(:disabled\)/);
});

test('ChatSettingsDrawer builds status bar editor rows without intermediate mapping arrays', () => {
  assert.match(chatSettingsDrawerScript, /from '..\/..\/..\/..\/shared\/statusTemplateTokens\.js'/);
  assert.match(
    chatSettingsDrawerScript,
    /const statusBarEditorRows = computed\(\(\) => \{[\s\S]*const rows = \[\];\s*for \(let index = 0; index < compositeRows\.length; index \+= 1\) \{[\s\S]*let compositePartKey = '';[\s\S]*for \(let partIndex = 0; partIndex < row\.parts\.length; partIndex \+= 1\) \{[\s\S]*compositePartKey \+= `\$\{partIndex > 0 \? '\|' : ''\}\$\{part\?\.name \?\? ''\}`;[\s\S]*key: `composite:\$\{index\}:\$\{row\.label\}:\$\{compositePartKey\}`,[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*const variable = variables\[index\];[\s\S]*continue;[\s\S]*key: `variable:\$\{index\}:\$\{key\}`,/
  );
  assert.match(
    chatSettingsDrawerScript,
    /function findStatusBarVariable\(name = ''\) \{[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*return variable;[\s\S]*return null;[\s\S]*\}/
  );
  assert.match(
    chatSettingsDrawerScript,
    /const parsed = parseStatusTemplateToken\(token\);\s*const rawProperty = parsed\.rawProperty\.trim\(\) \|\| 'value';\s*const name = normalizeTemplateVariableName\(parsed\.rawName\.trim\(\)\);/
  );
  assert.doesNotMatch(chatSettingsDrawerScript, /compositeRows\.map\(/);
  assert.doesNotMatch(chatSettingsDrawerScript, /row\.parts\.map\(/);
  assert.doesNotMatch(chatSettingsDrawerScript, /variables\.forEach\(/);
  assert.doesNotMatch(chatSettingsDrawerScript, /variables\.find\(/);
  assert.doesNotMatch(chatSettingsDrawerScript, /token\.split\('\.'\)\.map/);
});

test('ChatSettingsDrawer freezes accessory skill fields while saving accessory settings', () => {
  assert.match(
    chatSettingsDrawerTemplate,
    /<fieldset v-if="accessorySettingsOpen" class="accessory-skills-grid" :disabled="accessorySaving" :aria-busy="accessorySaving">/
  );
  assert.match(chatSettingsDrawerTemplate, /<\/fieldset>\s*<\/section>\s*<section class="chat-settings-section">/);
  assert.match(chatSettingsDrawerTemplate, /@click="emit\('save-accessory'\)"/);

  assert.match(stylesSource, /fieldset\.accessory-skills-grid\s*{\s*min-width: 0;/);
  assert.match(stylesSource, /fieldset\.accessory-skills-grid:disabled/);
});
