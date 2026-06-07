import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: settingsViewScript, template: settingsViewTemplate } = readVueBlocks('frontend/src/views/SettingsView.vue');

test('SettingsView personal-page retry and balance handlers ignore disabled states', () => {
  assert.match(
    settingsViewTemplate,
    /<button class="ghost-button" type="button" :disabled="loading" @click="loadSettings">/
  );
  assert.match(
    settingsViewScript,
    /async function loadSettings\(\) {\s*if \(!isPersonalPage\.value \|\| loading\.value\) {\s*return;\s*}/
  );
  assert.match(
    settingsViewTemplate,
    /:disabled="providerControlsBusy \|\| !canCheckBalance \|\| balanceLoading"[\s\S]*@click="checkBalance"/
  );
  assert.match(
    settingsViewScript,
    /async function checkBalance\(\) {\s*if \(!isPersonalPage\.value \|\| providerControlsBusy\.value \|\| balanceLoading\.value \|\| !canCheckBalance\.value\) {\s*return;\s*}/
  );
});

test('SettingsView model refresh ignores events while refresh is unavailable or already loading', () => {
  assert.match(
    settingsViewTemplate,
    /<button class="ghost-button compact-button" type="button" :disabled="providerControlsBusy \|\| !canFetchModels" @click="loadModels">/
  );
  assert.match(
    settingsViewScript,
    /async function loadModels\(\) {\s*if \(!isPersonalPage\.value \|\| providerControlsBusy\.value \|\| !canFetchModels\.value\) {\s*return;\s*}/
  );
});

test('SettingsView personal provider and profile saves expose visible busy guards', () => {
  assert.match(
    settingsViewScript,
    /const providerControlsBusy = computed\(\(\) => saving\.value \|\| modelLoading\.value\);/
  );
  assert.match(
    settingsViewScript,
    /async function submit\(\) {\s*if \(!isPersonalPage\.value \|\| providerControlsBusy\.value\) {\s*return;\s*}/
  );
  assert.match(
    settingsViewScript,
    /async function submitProfile\(\) {\s*if \(!isPersonalPage\.value \|\| profileSaving\.value\) {\s*return;\s*}/
  );
  assert.match(
    settingsViewTemplate,
    /<form class="profile-form" :aria-busy="profileSaving" @submit\.prevent="submitProfile">/
  );
  assert.match(
    settingsViewTemplate,
    /v-model\.trim="profile\.displayName"[\s\S]*:disabled="profileSaving"[\s\S]*placeholder=/
  );
  assert.match(
    settingsViewTemplate,
    /<form v-if="isPersonalPage && !loading && !loadError" class="form-panel" :aria-busy="providerControlsBusy" @submit\.prevent="submit">/
  );
  assert.match(
    settingsViewTemplate,
    /<select v-model="form\.providerType" :disabled="providerControlsBusy" @change="applyPreset">/
  );
  assert.match(
    settingsViewTemplate,
    /<input v-model\.trim="form\.gatewayName" :disabled="providerControlsBusy" \/>/
  );
  assert.match(
    settingsViewTemplate,
    /<input v-model\.trim="form\.baseUrl" placeholder="https:\/\/api\.example\.com\/v1" :disabled="providerControlsBusy" required \/>/
  );
  assert.match(
    settingsViewTemplate,
    /<select v-model="form\.model" :disabled="providerControlsBusy" required aria-label="[^"]+">/
  );
  assert.match(
    settingsViewTemplate,
    /v-model\.trim="form\.apiKey"[\s\S]*:disabled="providerControlsBusy"[\s\S]*type="password"/
  );
  assert.match(
    settingsViewTemplate,
    /<input v-model="form\.clearApiKey" type="checkbox" :disabled="providerControlsBusy" \/>/
  );
  assert.match(
    settingsViewTemplate,
    /<button class="primary-button" type="submit" :disabled="providerControlsBusy">/
  );
});

test('SettingsView extension retry handlers ignore events while already loading', () => {
  const cases = [
    ['loadTags', 'tagControlsBusy', 'tagControlsBusy'],
    ['loadPresets', 'presetControlsBusy', 'presetControlsBusy'],
    ['loadMods', 'modControlsBusy', 'modControlsBusy'],
    ['loadRegexRules', 'regexControlsBusy', 'regexControlsBusy']
  ];

  for (const [handler, disabledRef, guardRef] of cases) {
    assert.match(
      settingsViewTemplate,
      new RegExp(`:disabled="${disabledRef}" @click="${handler}"`)
    );
    assert.match(
      settingsViewScript,
      new RegExp(`async function ${handler}\\(\\) \\{\\s*if \\(!isExtensionsPage\\.value \\|\\| ${guardRef}\\.value\\) \\{\\s*return;\\s*\\}`)
    );
  }

  assert.match(
    settingsViewTemplate,
    /:disabled="modCharactersLoading \|\| modActionBusy" @click="loadModCharacterOptions"/
  );
  assert.match(
    settingsViewScript,
    /async function loadModCharacterOptions\(\) {\s*if \(!isExtensionsPage\.value \|\| modCharactersLoading\.value \|\| modActionBusy\.value\) {\s*return;/
  );
});

test('SettingsView tag mutations expose one busy guard for add, delete, and load-limit edits', () => {
  assert.match(settingsViewScript, /const tagActionBusyId = ref\(''\);/);
  assert.match(settingsViewScript, /const tagActionBusy = computed\(\(\) => Boolean\(tagActionBusyId\.value\)\);/);
  assert.match(settingsViewScript, /const tagControlsBusy = computed\(\(\) => tagLoading\.value \|\| tagActionBusy\.value\);/);
  assert.match(settingsViewScript, /function updateTagLoadLimit\(\) {\s*if \(tagControlsBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function addTag\(\) {[\s\S]*if \(!name \|\| tagControlsBusy\.value\) return;[\s\S]*beginTagMutation\('tag-add'\)[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function removeTag\(id, name\) {\s*if \(tagControlsBusy\.value\) return;[\s\S]*beginTagMutation\(tagDeleteActionId\(id\)\)[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );

  assert.match(settingsViewTemplate, /:disabled="tagControlsBusy" @keyup\.enter="addTag"/);
  assert.match(settingsViewTemplate, /:disabled="tagControlsBusy \|\| !newTagName\.trim\(\)" :aria-busy="tagActionBusyId === 'tag-add'"/);
  assert.match(settingsViewTemplate, /:disabled="tagControlsBusy"[\s\S]*@change="updateTagLoadLimit"/);
  assert.match(settingsViewTemplate, /:disabled="tagControlsBusy" @click="loadTags"/);
  assert.match(settingsViewTemplate, /:disabled="tagControlsBusy"[\s\S]*:aria-busy="isTagDeleteBusy\(tag\.id\)"[\s\S]*@click="removeTag\(tag\.id, tag\.name\)"/);
});

test('SettingsView preset mutations expose visible busy guards for edit, import, save, default, and delete actions', () => {
  assert.match(settingsViewScript, /const presetActionBusyId = ref\(''\);/);
  assert.match(settingsViewScript, /const presetActionBusy = computed\(\(\) => Boolean\(presetActionBusyId\.value\)\);/);
  assert.match(settingsViewScript, /const presetControlsBusy = computed\(\(\) => presetLoading\.value \|\| presetActionBusy\.value\);/);
  assert.match(settingsViewScript, /function startNewPreset\(\) {\s*if \(presetControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function startEditPreset\(preset\) {\s*if \(presetControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function cancelPresetEdit\(\) {\s*if \(presetActionBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function savePreset\(\) {\s*if \(presetControlsBusy\.value\) return;[\s\S]*beginPresetMutation\('preset-save'\)[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function removePreset\(id, name\) {\s*if \(presetControlsBusy\.value\) return;[\s\S]*beginPresetMutation\(presetDeleteActionId\(id\)\)[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function makeDefaultPreset\(id\) {\s*if \(presetControlsBusy\.value\) return;[\s\S]*beginPresetMutation\(presetDefaultActionId\(id\)\)[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(settingsViewScript, /async function importPresets\(mutationToken = beginPresetMutation\('preset-import'\)\)/);
  assert.match(settingsViewScript, /if \(!file \|\| presetControlsBusy\.value\) return;/);

  assert.match(settingsViewTemplate, /<button class="ghost-button" type="button" :disabled="presetControlsBusy" @click="startNewPreset">/);
  assert.match(settingsViewTemplate, /@click="exportPresets" :disabled="presetControlsBusy \|\| !presetList\.length"/);
  assert.match(settingsViewTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: presetControlsBusy \}">[\s\S]*<input type="file" accept="\.json" :disabled="presetControlsBusy" @change="handlePresetImportFile" \/>/);
  assert.match(settingsViewTemplate, /:disabled="presetControlsBusy" @click="loadPresets"/);
  assert.match(settingsViewTemplate, /<form v-if="showPresetEditor" class="preset-editor" :aria-busy="presetActionBusy" @submit\.prevent="savePreset">/);
  assert.match(settingsViewTemplate, /<input v-model\.trim="presetForm\.name"[\s\S]*:disabled="presetActionBusy" required \/>/);
  assert.match(settingsViewTemplate, /<textarea v-model="presetForm\.systemPrompt"[\s\S]*:disabled="presetActionBusy" \/>/);
  assert.match(settingsViewTemplate, /type="submit" :disabled="presetActionBusy" :aria-busy="presetActionBusyId === 'preset-save'"/);
  assert.match(settingsViewTemplate, /:disabled="presetActionBusy" @click="cancelPresetEdit"/);
  assert.match(settingsViewTemplate, /:disabled="presetControlsBusy" @click="startEditPreset\(preset\)"/);
  assert.match(settingsViewTemplate, /:disabled="presetControlsBusy"[\s\S]*:aria-busy="isPresetDefaultBusy\(preset\.id\)"[\s\S]*@click="makeDefaultPreset\(preset\.id\)"/);
  assert.match(settingsViewTemplate, /:disabled="presetControlsBusy"[\s\S]*:aria-busy="isPresetDeleteBusy\(preset\.id\)"[\s\S]*@click="removePreset\(preset\.id, preset\.name\)"/);
});

test('SettingsView mod mutations expose visible busy guards for editor, toggle, delete, and reorder actions', () => {
  assert.match(settingsViewScript, /const modActionBusyId = ref\(''\);/);
  assert.match(settingsViewScript, /const modActionBusy = computed\(\(\) => Boolean\(modActionBusyId\.value\)\);/);
  assert.match(settingsViewScript, /const modControlsBusy = computed\(\(\) => modLoading\.value \|\| modActionBusy\.value\);/);
  assert.match(settingsViewScript, /function startNewMod\(\) {\s*if \(modControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function startEditMod\(mod\) {\s*if \(modControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function cancelModEdit\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function saveMod\(\) {\s*if \(modControlsBusy\.value\) return;[\s\S]*beginModMutation\('mod-save'\)[\s\S]*finishModMutation\(mutationToken\);\s*await loadMods\(\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function removeMod\(id, name\) {\s*if \(modControlsBusy\.value\) return;[\s\S]*beginModMutation\(modDeleteActionId\(id\)\)[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function toggleMod\(mod\) {\s*if \(modControlsBusy\.value\) return;[\s\S]*beginModMutation\(modToggleActionId\(mod\.id\)\)[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(settingsViewScript, /function selectAllModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsViewScript, /function clearModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsViewScript, /function onModDragStart\(event, mod\) {\s*if \(modControlsBusy\.value\) {[\s\S]*event\.preventDefault\(\);/);
  assert.match(settingsViewScript, /async function onModDrop\(event, targetMod\) {[\s\S]*if \(modControlsBusy\.value\) return;[\s\S]*beginModMutation\('mod-reorder'\)[\s\S]*finally {\s*finishModMutation\(mutationToken\);/);

  assert.match(settingsViewTemplate, /<button class="ghost-button" type="button" :disabled="modControlsBusy" @click="startNewMod">/);
  assert.match(settingsViewTemplate, /:disabled="modControlsBusy" @click="loadMods"/);
  assert.match(settingsViewTemplate, /<form class="preset-editor mod-editor-modal" role="dialog" aria-modal="true" :aria-busy="modActionBusy"/);
  assert.match(settingsViewTemplate, /aria-label="关闭 Mod 编辑器" :disabled="modActionBusy" @click="cancelModEdit"/);
  assert.match(settingsViewTemplate, /<input v-model\.trim="modForm\.name"[\s\S]*:disabled="modActionBusy" required \/>/);
  assert.match(settingsViewTemplate, /<select v-model="modForm\.type" :disabled="modActionBusy">/);
  assert.match(settingsViewTemplate, /<textarea v-model="modForm\.content"[\s\S]*:disabled="modActionBusy" required \/>/);
  assert.match(settingsViewTemplate, /:disabled="modActionBusy \|\| !modCharacterOptions\.length" @click="selectAllModCharacters"/);
  assert.match(settingsViewTemplate, /:disabled="modActionBusy \|\| !modForm\.characterIds\.length" @click="clearModCharacters"/);
  assert.match(settingsViewTemplate, /<input v-model="modForm\.enabled" type="checkbox" :disabled="modActionBusy" \/>/);
  assert.match(settingsViewTemplate, /type="submit" :disabled="modActionBusy" :aria-busy="modActionBusyId === 'mod-save'"/);
  assert.match(settingsViewTemplate, /:draggable="!modControlsBusy"[\s\S]*:aria-busy="isModToggleBusy\(mod\.id\) \|\| isModDeleteBusy\(mod\.id\) \|\| modActionBusyId === 'mod-reorder'"/);
  assert.match(settingsViewTemplate, /:disabled="modControlsBusy"[\s\S]*:aria-busy="isModToggleBusy\(mod\.id\)"[\s\S]*@click="toggleMod\(mod\)"/);
  assert.match(settingsViewTemplate, /:disabled="modControlsBusy" @click="startEditMod\(mod\)"/);
  assert.match(settingsViewTemplate, /:disabled="modControlsBusy" :aria-busy="isModDeleteBusy\(mod\.id\)" @click="removeMod\(mod\.id, mod\.name\)"/);
});

test('SettingsView regex mutations expose visible busy guards for filter, import, toggle, and reorder actions', () => {
  assert.match(settingsViewScript, /const regexActionBusyId = ref\(''\);/);
  assert.match(settingsViewScript, /const regexActionBusy = computed\(\(\) => Boolean\(regexActionBusyId\.value\)\);/);
  assert.match(settingsViewScript, /const regexControlsBusy = computed\(\(\) => regexLoading\.value \|\| regexActionBusy\.value\);/);
  assert.match(settingsViewScript, /function handleRegexGroupFilterChange\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function handleToggleRegexRule\(ruleId\) {\s*if \(regexControlsBusy\.value\) return;[\s\S]*beginRegexMutation\(regexToggleActionId\(ruleId\)\)[\s\S]*finishRegexMutation\(mutationToken\);\s*await loadRegexRules\(\);[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.match(settingsViewScript, /function onRegexDragStart\(event, index\) {\s*if \(regexControlsBusy\.value\) {[\s\S]*event\.preventDefault\(\);/);
  assert.match(
    settingsViewScript,
    /async function onRegexDrop\(dropIndex\) {[\s\S]*if \(regexControlsBusy\.value\) return;[\s\S]*beginRegexMutation\('regex-reorder'\)[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.match(settingsViewScript, /function exportRegexRules\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /async function importRegexRules\(mutationToken = beginRegexMutation\('regex-import'\), groupFilter = regexGroupFilter\.value\)/);
  assert.match(settingsViewScript, /if \(!file \|\| regexControlsBusy\.value\) return;/);

  assert.match(settingsViewTemplate, /<select v-model="regexGroupFilter"[\s\S]*:disabled="regexControlsBusy" @change="handleRegexGroupFilterChange">/);
  assert.match(settingsViewTemplate, /@click="exportRegexRules" :disabled="regexControlsBusy \|\| !regexRules\.length"/);
  assert.match(settingsViewTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: regexControlsBusy \}" :aria-busy="regexActionBusyId === 'regex-import'">[\s\S]*<input type="file" accept="\.json" :disabled="regexControlsBusy" @change="handleRegexImportFile" \/>/);
  assert.match(settingsViewTemplate, /:disabled="regexControlsBusy" @click="loadRegexRules"/);
  assert.match(settingsViewTemplate, /:draggable="!regexControlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\) \|\| regexActionBusyId === 'regex-reorder'"/);
  assert.match(settingsViewTemplate, /@dragstart="onRegexDragStart\(\$event, index\)"/);
  assert.match(settingsViewTemplate, /:disabled="regexControlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\)"[\s\S]*@click="handleToggleRegexRule\(rule\.id\)"/);
});
