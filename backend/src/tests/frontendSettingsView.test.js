import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalOrPrivateBaseUrl } from '../../../shared/privateNetwork.js';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

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
    settingsViewScript,
    /areProviderModelListsEqual,[\s\S]*buildModelSelectOptions,[\s\S]*readCachedProviderModels,[\s\S]*refreshProviderModels/
  );
  assert.match(
    settingsViewScript,
    /watch\(\s*\(\) => \[[\s\S]*form\.providerType,[\s\S]*form\.gatewayName,[\s\S]*form\.baseUrl,[\s\S]*Boolean\(form\.apiKey \|\| form\.apiKeySet\),[\s\S]*form\.supportsReasoning,[\s\S]*form\.extraBody[\s\S]*\]/
  );
  assert.match(
    settingsViewScript,
    /function syncCachedModelOptions\(\) \{\s*applyModelOptions\(readCachedProviderModels\(form\)\);\s*\}/
  );
  assert.match(
    settingsViewScript,
    /function applyModelOptions\(nextOptions\) \{\s*if \(areProviderModelListsEqual\(modelOptions\.value, nextOptions\)\) \{\s*return false;\s*\}\s*modelOptions\.value = nextOptions;\s*return true;\s*\}/
  );
  assert.match(
    settingsViewScript,
    /const nextOptions = await refreshProviderModels\(request, \{ forceRefresh: true \}\);[\s\S]*applyModelOptions\(nextOptions\);[\s\S]*if \(!nextOptions\.length\)[\s\S]*!nextOptions\.some\(\(model\) => model\.id === form\.model\)[\s\S]*form\.model = nextOptions\[0\]\.id;/
  );
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

test('SettingsView no-key custom provider readiness trusts parsed private IPv4 hosts only', () => {
  assert.equal(isLocalOrPrivateBaseUrl('http://127.0.0.1:8317/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://10.0.0.8:8317/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://172.31.255.1/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://172.32.0.1/v1'), false);
  assert.equal(isLocalOrPrivateBaseUrl('http://127.evil.test/v1'), false);

  assert.match(settingsViewScript, /from '..\/..\/..\/shared\/privateNetwork\.js'/);
  assert.doesNotMatch(settingsViewScript, /function isLocalOrPrivateBaseUrl\(value\) \{/);
  assert.doesNotMatch(settingsViewScript, /function parseIpv4Address\(host\) \{/);
  assert.doesNotMatch(settingsViewScript, /host\.startsWith\('127\.'\)/);
  assert.doesNotMatch(settingsViewScript, /host\.split\('\\.'\)\.map/);
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

test('SettingsView preserves unchanged extension list references during refreshes', () => {
  assert.match(
    settingsViewScript,
    /function samePlainValue\(left, right\) \{[\s\S]*Object\.is\(left, right\)[\s\S]*Array\.isArray\(left\)[\s\S]*for \(let index = 0; index < left\.length; index \+= 1\) \{[\s\S]*samePlainValue\(left\[index\], right\[index\]\)[\s\S]*let leftKeyCount = 0;[\s\S]*for \(const key in left\) \{[\s\S]*leftKeyCount \+= 1;[\s\S]*samePlainValue\(left\[key\], right\[key\]\)[\s\S]*let rightKeyCount = 0;[\s\S]*for \(const key in right\) \{[\s\S]*rightKeyCount \+= 1;[\s\S]*return leftKeyCount === rightKeyCount;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function sameListItems\(currentList, nextList\) \{[\s\S]*currentList\.length !== nextList\.length[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*samePlainValue\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function setListIfChanged\(listRef, nextList\) \{[\s\S]*sameListItems\(listRef\.value, normalizedNextList\)[\s\S]*listRef\.value = normalizedNextList;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /const nextTags = await fetchTags\(\{ limit \}\);[\s\S]*setListIfChanged\(tagList, nextTags\);/
  );
  assert.match(
    settingsViewScript,
    /const nextPresets = await fetchPresets\(\);[\s\S]*setListIfChanged\(presetList, nextPresets\);/
  );
  assert.match(
    settingsViewScript,
    /const nextMods = await fetchMods\(\);[\s\S]*setListIfChanged\(modList, nextMods\);/
  );
  assert.match(
    settingsViewScript,
    /const characters = await fetchCharacters\(\{ sort: 'name' \}\);[\s\S]*setModCharacterOptionsIfChanged\(characters\);/
  );
  assert.match(
    settingsViewScript,
    /function setModCharacterOptionsIfChanged\(characters\) \{\s*const nextOptions = \[\];\s*if \(Array\.isArray\(characters\)\) \{\s*for \(const character of characters\) \{\s*if \(character\?\.canUse !== false\) \{\s*nextOptions\.push\(character\);\s*\}\s*\}\s*\}\s*return setListIfChanged\(modCharacterOptions, nextOptions\);\s*\}/
  );
  assert.match(
    settingsViewScript,
    /function getListItemById\(listRef, itemId\) \{\s*const targetId = String\(itemId \|\| ''\);[\s\S]*const currentList = Array\.isArray\(listRef\.value\) \? listRef\.value : \[\];[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*return item;[\s\S]*}\s*}\s*return null;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function prependListItemByIdWithLimit\(listRef, nextItem, limit\) \{[\s\S]*const nextList = \[nextItem\];[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === nextId\) continue;[\s\S]*if \(nextList\.length >= normalizedLimit\) break;[\s\S]*nextList\.push\(item\);[\s\S]*return setListIfChanged\(listRef, nextList\);[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function removeListItemByIdIfPresent\(listRef, itemId\) \{[\s\S]*const nextList = \[\];\s*let changed = false;[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextList\.push\(item\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return changed;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function updateListItemByIdIfChanged\(listRef, itemId, nextItem\) \{[\s\S]*const nextList = \[\];\s*let changed = false;[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*if \(!samePlainValue\(item, nextItem\)\) \{[\s\S]*changed = true;[\s\S]*nextList\.push\(nextItem\);[\s\S]*} else \{[\s\S]*nextList\.push\(item\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return changed;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function moveListItemToTargetIndexById\(listRef, itemId, targetItemId\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*if \(id === sourceId\) \{[\s\S]*fromIndex = index;[\s\S]*} else if \(id === targetId\) \{[\s\S]*targetIndex = index;[\s\S]*}[\s\S]*const nextList = currentList\.slice\(\);[\s\S]*nextList\.splice\(targetIndex, 0, moved\);[\s\S]*const ids = \[\];[\s\S]*for \(const item of nextList\) \{[\s\S]*ids\.push\(item\.id\);[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return \{ previousList: currentList, nextList, ids \};[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /const nextRules = await fetchRegexRules\(groupFilter\);[\s\S]*setListIfChanged\(regexRules, nextRules\);/
  );
  assert.doesNotMatch(
    settingsViewScript,
    /(tagList|presetList|modList|modCharacterOptions|regexRules)\.value\s*=/
  );
  assert.doesNotMatch(settingsViewScript, /left\.every\(/);
  assert.doesNotMatch(settingsViewScript, /leftKeys\.every\(/);
  assert.doesNotMatch(settingsViewScript, /currentList\.every\(/);
  assert.doesNotMatch(settingsViewScript, /Object\.keys\(left\)/);
  assert.doesNotMatch(settingsViewScript, /Object\.keys\(right\)/);
});

test('SettingsView preserves unchanged personal profile and balance references', () => {
  assert.match(
    settingsViewScript,
    /function setPlainValueIfChanged\(valueRef, nextValue\) \{[\s\S]*samePlainValue\(valueRef\.value, nextValue\)[\s\S]*valueRef\.value = nextValue;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsViewScript,
    /function setBalanceIfChanged\(nextBalance\) \{\s*return setPlainValueIfChanged\(balance, nextBalance\);\s*\}/
  );
  assert.match(
    settingsViewScript,
    /function setProfileStatsIfChanged\(nextStats\) \{\s*return setPlainValueIfChanged\(profileStats, nextStats \|\| profileStats\.value\);\s*\}/
  );
  assert.match(
    settingsViewScript,
    /function setOwnedCharactersIfChanged\(nextCharacters\) \{\s*return setListIfChanged\(ownedCharacters, nextCharacters\);\s*\}/
  );
  assert.match(
    settingsViewScript,
    /const nextBalance = await fetchDeepSeekBalance\(\);[\s\S]*setBalanceIfChanged\(nextBalance\);/
  );
  assert.match(
    settingsViewScript,
    /function applyProfile\(result = \{\}\) \{\s*applyProfileUser\(result\.user \|\| \{\}\);\s*setProfileStatsIfChanged\(result\.stats\);\s*setOwnedCharactersIfChanged\(result\.ownedCharacters\);\s*\}/
  );
  assert.doesNotMatch(settingsViewScript, /balance\.value\s*=\s*nextBalance/);
  assert.doesNotMatch(settingsViewScript, /profileStats\.value\s*=\s*result\.stats/);
  assert.doesNotMatch(settingsViewScript, /ownedCharacters\.value\s*=\s*result\.ownedCharacters/);
});

test('SettingsView tag mutations expose one busy guard for add, delete, and load-limit edits', () => {
  assert.match(settingsViewScript, /const tagActionBusyId = ref\(''\);/);
  assert.match(settingsViewScript, /const tagActionBusy = computed\(\(\) => Boolean\(tagActionBusyId\.value\)\);/);
  assert.match(settingsViewScript, /const tagControlsBusy = computed\(\(\) => tagLoading\.value \|\| tagActionBusy\.value\);/);
  assert.match(settingsViewScript, /function getCurrentTag\(id\) {\s*return getListItemById\(tagList, id\);\s*}/);
  assert.match(settingsViewScript, /function updateTagLoadLimit\(\) {\s*if \(tagControlsBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function addTag\(\) {[\s\S]*if \(!name \|\| tagControlsBusy\.value\) return;[\s\S]*beginTagMutation\('tag-add'\)[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /const tag = await createTag\(\{ name \}\);[\s\S]*prependListItemByIdWithLimit\(tagList, tag, normalizedTagLoadLimit\.value\);/
  );
  assert.match(
    settingsViewScript,
    /async function removeTag\(id, name\) {\s*if \(tagControlsBusy\.value\) return;\s*const currentTag = getCurrentTag\(id\);\s*if \(!currentTag\) return;[\s\S]*beginTagMutation\(tagDeleteActionId\(currentTag\.id\)\)[\s\S]*await deleteTag\(currentTag\.id\);[\s\S]*removeListItemByIdIfPresent\(tagList, currentTag\.id\);[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );
  assert.equal(countMatches(settingsViewScript, /removeListItemByIdIfPresent\(tagList, currentTag\.id\);/g), 2);
  assert.doesNotMatch(settingsViewScript, /tagList\.value\.filter/);

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
  assert.match(settingsViewScript, /function getCurrentPreset\(id\) {\s*return getListItemById\(presetList, id\);\s*}/);
  assert.match(settingsViewScript, /function startNewPreset\(\) {\s*if \(presetControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function startEditPreset\(preset\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(preset\?\.id\);\s*if \(!currentPreset\) return;[\s\S]*presetEditing\.value = currentPreset\.id;/);
  assert.match(settingsViewScript, /function cancelPresetEdit\(\) {\s*if \(presetActionBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function savePreset\(\) {\s*if \(presetControlsBusy\.value\) return;\s*const editingId = presetEditing\.value;\s*const editingPreset = editingId \? getCurrentPreset\(editingId\) : null;\s*if \(editingId && !editingPreset\) {[\s\S]*resetPresetForm\(\);[\s\S]*return;[\s\S]*}[\s\S]*beginPresetMutation\('preset-save'\)[\s\S]*await updatePreset\(editingPreset\.id, payload\);[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function removePreset\(id, name\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(id\);\s*if \(!currentPreset\) return;[\s\S]*beginPresetMutation\(presetDeleteActionId\(currentPreset\.id\)\)[\s\S]*await deletePreset\(currentPreset\.id\);[\s\S]*removeListItemByIdIfPresent\(presetList, currentPreset\.id\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsViewScript, /presetList\.value\.filter/);
  assert.match(
    settingsViewScript,
    /async function makeDefaultPreset\(id\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(id\);\s*if \(!currentPreset\) return;[\s\S]*beginPresetMutation\(presetDefaultActionId\(currentPreset\.id\)\)[\s\S]*await setDefaultPreset\(currentPreset\.id\);[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
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
  assert.match(settingsViewScript, /function getCurrentMod\(id\) {\s*return getListItemById\(modList, id\);\s*}/);
  assert.match(settingsViewScript, /function startNewMod\(\) {\s*if \(modControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /function startEditMod\(mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;[\s\S]*modEditing\.value = currentMod\.id;/);
  assert.match(settingsViewScript, /function cancelModEdit\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function saveMod\(\) {\s*if \(modControlsBusy\.value\) return;[\s\S]*if \(editingId && !getCurrentMod\(editingId\)\) {[\s\S]*closeModEditor\(\);[\s\S]*return;[\s\S]*}[\s\S]*beginModMutation\('mod-save'\)[\s\S]*finishModMutation\(mutationToken\);\s*await loadMods\(\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function removeMod\(id, name\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(id\);\s*if \(!currentMod\) return;[\s\S]*beginModMutation\(modDeleteActionId\(currentMod\.id\)\)[\s\S]*await deleteMod\(currentMod\.id\);[\s\S]*removeListItemByIdIfPresent\(modList, currentMod\.id\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsViewScript,
    /async function toggleMod\(mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;[\s\S]*beginModMutation\(modToggleActionId\(currentMod\.id\)\)[\s\S]*await updateMod\(currentMod\.id, \{ enabled: nextEnabled \}\);[\s\S]*if \(!getCurrentMod\(currentMod\.id\)\) return;[\s\S]*updateListItemByIdIfChanged\(modList, currentMod\.id, nextMod\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsViewScript, /modList\.value\.filter/);
  assert.doesNotMatch(settingsViewScript, /modList\.value\.map\(\(item\) => \(item\.id === currentMod\.id \? nextMod : item\)\)/);
  assert.match(settingsViewScript, /function selectAllModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsViewScript, /function clearModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsViewScript, /function onModDragStart\(event, mod\) {\s*if \(modControlsBusy\.value\) {[\s\S]*event\.preventDefault\(\);[\s\S]*const currentMod = getCurrentMod\(mod\?\.id\);[\s\S]*if \(!currentMod\) {[\s\S]*event\.preventDefault\(\);[\s\S]*draggingMod\.value = currentMod\.id;/);
  assert.match(
    settingsViewScript,
    /function onModDragOver\(event, mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;\s*event\.preventDefault\(\);\s*if \(dragOverMod\.value !== currentMod\.id\) {\s*dragOverMod\.value = currentMod\.id;\s*}/
  );
  assert.match(settingsViewScript, /async function onModDrop\(event, targetMod\) {[\s\S]*if \(modControlsBusy\.value\) return;[\s\S]*const currentDraggedMod = getCurrentMod\(draggedId\);[\s\S]*const currentTargetMod = getCurrentMod\(targetMod\?\.id\);[\s\S]*if \(!currentDraggedMod \|\| !currentTargetMod \|\| currentDraggedMod\.id === currentTargetMod\.id\)[\s\S]*beginModMutation\('mod-reorder'\)[\s\S]*finally {\s*finishModMutation\(mutationToken\);/);
  assert.match(
    settingsViewScript,
    /const moveResult = moveListItemToTargetIndexById\(modList, currentDraggedMod\.id, currentTargetMod\.id\);[\s\S]*await reorderMods\(moveResult\.ids\);[\s\S]*setListIfChanged\(modList, moveResult\.previousList\);/
  );
  assert.doesNotMatch(settingsViewScript, /modList\.value\.findIndex/);
  assert.doesNotMatch(settingsViewScript, /reorderMods\([^)]*\.map/);

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
  assert.match(settingsViewScript, /const draggingRegexRuleId = ref\(''\);/);
  assert.match(settingsViewScript, /function getCurrentRegexRule\(ruleId\) {\s*return getListItemById\(regexRules, ruleId\);\s*}/);
  assert.match(settingsViewScript, /function handleRegexGroupFilterChange\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(
    settingsViewScript,
    /async function handleToggleRegexRule\(ruleId\) {\s*if \(regexControlsBusy\.value\) return;\s*const currentRule = getCurrentRegexRule\(ruleId\);\s*if \(!currentRule\) return;[\s\S]*beginRegexMutation\(regexToggleActionId\(currentRule\.id\)\)[\s\S]*await toggleRegexRule\(currentRule\.id\);[\s\S]*finishRegexMutation\(mutationToken\);\s*await loadRegexRules\(\);[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.match(settingsViewScript, /function onRegexDragStart\(event, ruleId\) {\s*if \(regexControlsBusy\.value\) {[\s\S]*event\.preventDefault\(\);[\s\S]*const currentRule = getCurrentRegexRule\(ruleId\);[\s\S]*if \(!currentRule\) {[\s\S]*event\.preventDefault\(\);[\s\S]*draggingRegexRuleId\.value = currentRule\.id;/);
  assert.match(
    settingsViewScript,
    /function onRegexDragOver\(event, ruleId\) {\s*if \(regexControlsBusy\.value\) return;\s*if \(!getCurrentRegexRule\(ruleId\)\) return;\s*event\.preventDefault\(\);/
  );
  assert.match(
    settingsViewScript,
    /async function onRegexDrop\(targetRuleId\) {[\s\S]*const currentDraggedRule = getCurrentRegexRule\(draggingRegexRuleId\.value\);[\s\S]*const currentTargetRule = getCurrentRegexRule\(targetRuleId\);[\s\S]*if \(!currentDraggedRule \|\| !currentTargetRule \|\| currentDraggedRule\.id === currentTargetRule\.id\)[\s\S]*const moveResult = moveListItemToTargetIndexById\(regexRules, currentDraggedRule\.id, currentTargetRule\.id\);[\s\S]*await reorderRegexRules\(moveResult\.ids, groupFilter\);[\s\S]*setListIfChanged\(regexRules, moveResult\.previousList\);[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsViewScript, /reorderRegexRules\(items\.map/);
  assert.doesNotMatch(settingsViewScript, /const fromIndex = items\.findIndex/);
  assert.match(settingsViewScript, /function exportRegexRules\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(settingsViewScript, /async function importRegexRules\(mutationToken = beginRegexMutation\('regex-import'\), groupFilter = regexGroupFilter\.value\)/);
  assert.match(settingsViewScript, /if \(!file \|\| regexControlsBusy\.value\) return;/);

  assert.match(settingsViewTemplate, /<select v-model="regexGroupFilter"[\s\S]*:disabled="regexControlsBusy" @change="handleRegexGroupFilterChange">/);
  assert.match(settingsViewTemplate, /@click="exportRegexRules" :disabled="regexControlsBusy \|\| !regexRules\.length"/);
  assert.match(settingsViewTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: regexControlsBusy \}" :aria-busy="regexActionBusyId === 'regex-import'">[\s\S]*<input type="file" accept="\.json" :disabled="regexControlsBusy" @change="handleRegexImportFile" \/>/);
  assert.match(settingsViewTemplate, /:disabled="regexControlsBusy" @click="loadRegexRules"/);
  assert.match(settingsViewTemplate, /:draggable="!regexControlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\) \|\| regexActionBusyId === 'regex-reorder'"/);
  assert.match(settingsViewTemplate, /@dragstart="onRegexDragStart\(\$event, rule\.id\)"/);
  assert.match(settingsViewTemplate, /@dragover="onRegexDragOver\(\$event, rule\.id\)"/);
  assert.match(settingsViewTemplate, /@drop="onRegexDrop\(rule\.id\)"/);
  assert.match(settingsViewTemplate, /:disabled="regexControlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\)"[\s\S]*@click="handleToggleRegexRule\(rule\.id\)"/);
});
