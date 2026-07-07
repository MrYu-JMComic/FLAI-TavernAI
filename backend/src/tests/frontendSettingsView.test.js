import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalOrPrivateBaseUrl } from '../../../shared/privateNetwork.js';
import { countMatches, readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: settingsViewScript, template: settingsViewTemplate } = readVueBlocks('frontend/src/views/SettingsView.vue');
const settingsDataExportsComposableSource = readRepoText('frontend/src/composables/settings/useSettingsDataExports.js');
const downloadJsonSource = readRepoText('frontend/src/utils/downloadJson.js');
const settingsModsComposableSource = readRepoText('frontend/src/composables/settings/useSettingsMods.js');
const settingsProfileComposableSource = readRepoText('frontend/src/composables/settings/useSettingsProfile.js');
const settingsProviderComposableSource = readRepoText('frontend/src/composables/settings/useSettingsProvider.js');
const settingsPresetsComposableSource = readRepoText('frontend/src/composables/settings/useSettingsPresets.js');
const settingsRegexComposableSource = readRepoText('frontend/src/composables/settings/useSettingsRegex.js');
const settingsSectionNavigationSource = readRepoText('frontend/src/composables/settings/useSettingsSectionNavigation.js');
const settingsStatusTemplatesComposableSource = readRepoText('frontend/src/composables/settings/useSettingsStatusTemplates.js');
const settingsTagsComposableSource = readRepoText('frontend/src/composables/settings/useSettingsTags.js');
const settingsListStateSource = readRepoText('frontend/src/composables/settings/settingsListState.js');
const {
  script: settingsProfilePanelScript,
  template: settingsProfilePanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsProfilePanel.vue');
const {
  script: settingsDataExportPanelScript,
  template: settingsDataExportPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsDataExportPanel.vue');
const {
  script: settingsPresetPanelScript,
  template: settingsPresetPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsPresetPanel.vue');
const {
  script: settingsModPanelScript,
  template: settingsModPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsModPanel.vue');
const {
  script: settingsProviderPanelScript,
  template: settingsProviderPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsProviderPanel.vue');
const {
  script: settingsRegexPanelScript,
  template: settingsRegexPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsRegexPanel.vue');
const {
  script: settingsStatusTemplatePanelScript,
  template: settingsStatusTemplatePanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsStatusTemplatePanel.vue');
const {
  script: settingsTagPanelScript,
  template: settingsTagPanelTemplate
} = readVueBlocks('frontend/src/components/settings/SettingsTagPanel.vue');
const stylesSource = readFrontendStyles();

function readCssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rulePattern = new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{`, 'g');
  const match = rulePattern.exec(stylesSource);
  assert.ok(match, `${selector} rule should exist`);
  const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const bodyStart = stylesSource.indexOf('{', start);
  const bodyEnd = stylesSource.indexOf('}', bodyStart);
  assert.notEqual(bodyEnd, -1, `${selector} rule should close`);
  return stylesSource.slice(bodyStart + 1, bodyEnd);
}

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
    settingsProviderPanelTemplate,
    /:disabled="controlsBusy \|\| !canCheckBalance \|\| balanceLoading"[\s\S]*@click="emit\('check-balance'\)"/
  );
  assert.match(
    settingsProviderComposableSource,
    /async function checkBalance\(\) {\s*if \(!isProviderPageReady\(\) \|\| providerControlsBusy\.value \|\| balanceLoading\.value \|\| !canCheckBalance\.value\) {\s*return;\s*}/
  );
});

test('SettingsView model refresh ignores events while refresh is unavailable or already loading', () => {
  assert.match(
    settingsProviderComposableSource,
    /areProviderModelListsEqual,[\s\S]*buildModelSelectOptions,[\s\S]*readCachedProviderModels,[\s\S]*refreshProviderModels/
  );
  assert.match(
    settingsProviderComposableSource,
    /watch\(\s*\(\) => \[[\s\S]*form\.providerType,[\s\S]*form\.gatewayName,[\s\S]*form\.baseUrl,[\s\S]*Boolean\(form\.apiKey \|\| form\.apiKeySet\),[\s\S]*form\.supportsReasoning,[\s\S]*form\.extraBody[\s\S]*\]/
  );
  assert.match(
    settingsProviderComposableSource,
    /function syncCachedModelOptions\(\) \{\s*applyModelOptions\(readCachedProviderModels\(form\)\);\s*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /function applyModelOptions\(nextOptions\) \{\s*if \(areProviderModelListsEqual\(modelOptions\.value, nextOptions\)\) \{\s*return false;\s*\}\s*modelOptions\.value = nextOptions;\s*return true;\s*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /const nextOptions = await refreshProviderModels\(request, \{ forceRefresh: true \}\);[\s\S]*applyModelOptions\(nextOptions\);[\s\S]*if \(!nextOptions\.length\)[\s\S]*!hasProviderModelOption\(nextOptions, form\.model\)[\s\S]*form\.model = nextOptions\[0\]\.id;/
  );
  assert.match(
    settingsProviderComposableSource,
    /function hasProviderModelOption\(options, modelId\) \{\s*const id = String\(modelId \|\| ''\)\.trim\(\);[\s\S]*if \(!id\) \{[\s\S]*return false;[\s\S]*for \(const model of Array\.isArray\(options\) \? options : \[\]\) \{[\s\S]*if \(model\?\.id === id\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(settingsProviderComposableSource, /nextOptions\.some\(\(model\) => model\.id === form\.model\)/);
  assert.match(
    settingsProviderPanelTemplate,
    /<button class="ghost-button compact-button" type="button" :disabled="controlsBusy \|\| !canFetchModels" @click="emit\('load-models'\)">/
  );
  assert.match(
    settingsProviderComposableSource,
    /async function loadModels\(\) {\s*if \(!isProviderPageReady\(\) \|\| providerControlsBusy\.value \|\| !canFetchModels\.value\) {\s*return;\s*}/
  );
});

test('SettingsView personal provider and profile saves expose visible busy guards', () => {
  assert.match(
    settingsProviderComposableSource,
    /const providerControlsBusy = computed\(\(\) => saving\.value \|\| modelLoading\.value \|\| modelProbeLoading\.value\);/
  );
  assert.match(
    settingsProviderComposableSource,
    /async function submit\(\) {\s*if \(!isProviderPageReady\(\) \|\| providerControlsBusy\.value\) {\s*return;\s*}/
  );
  assert.match(
    settingsProfileComposableSource,
    /async function submitProfile\(\) {\s*if \(!isPersonalPageReady\(\) \|\| profileSaving\.value\) {\s*return;\s*}/
  );
  assert.match(
    settingsProviderComposableSource,
    /function updateProviderFormField\(key, value\) \{\s*if \(!Object\.prototype\.hasOwnProperty\.call\(form, key\)\) \{\s*return;\s*\}\s*form\[key\] = value;\s*}/
  );
  assert.match(
    settingsProfileComposableSource,
    /function updateProfileDisplayName\(value\) {\s*profile\.displayName = String\(value \|\| ''\)\.slice\(0, 8\);\s*}/
  );
  assert.match(settingsViewScript, /import \{ useSettingsProfile \} from '\.\.\/composables\/settings\/useSettingsProfile';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*applyProfile,[\s\S]*avatarSaving,[\s\S]*handleUserAvatar,[\s\S]*loadUserProfile,[\s\S]*ownedCharacters,[\s\S]*profile,[\s\S]*profileSaving,[\s\S]*profileStats,[\s\S]*resetProfileAsyncScope,[\s\S]*submitProfile,[\s\S]*updateProfileDisplayName[\s\S]*\} = useSettingsProfile\(\{[\s\S]*user: computed\(\(\) => props\.user\),[\s\S]*isPersonalPage,[\s\S]*notify,[\s\S]*emitProfileSaved: \(user\) => emit\('profile-saved', user\)[\s\S]*\}\);/
  );
  assert.match(settingsViewScript, /import \{ useSettingsProvider \} from '\.\.\/composables\/settings\/useSettingsProvider';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*loadProviderSettingsBundle,[\s\S]*resetProviderAsyncScope,[\s\S]*applyProviderSettingsBundle,[\s\S]*updateProviderFormField[\s\S]*\} = useSettingsProvider\(\{[\s\S]*isPersonalPage,[\s\S]*notify,[\s\S]*emitProviderSaved: \(\) => emit\('provider-saved'\)[\s\S]*\}\);/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsProfilePanel[\s\S]*:avatar-saving="avatarSaving"[\s\S]*:owned-characters="ownedCharacters"[\s\S]*:profile="profile"[\s\S]*:profile-saving="profileSaving"[\s\S]*:stats="profileStats"[\s\S]*@avatar-change="handleUserAvatar"[\s\S]*@submit="submitProfile"[\s\S]*@update-display-name="updateProfileDisplayName"/
  );
  assert.match(
    settingsProfilePanelTemplate,
    /<form class="profile-form" :aria-busy="profileSaving" @submit\.prevent="emit\('submit'\)">/
  );
  assert.match(
    settingsProfilePanelTemplate,
    /:value="profile\.displayName"[\s\S]*:disabled="profileSaving"[\s\S]*placeholder="可选，最多 8 个字符"[\s\S]*@input="emit\('update-display-name', readInputValue\(\$event\)\.trim\(\)\)"/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsProviderPanel[\s\S]*:balance-loading="balanceLoading"[\s\S]*:can-check-balance="canCheckBalance"[\s\S]*:can-fetch-models="canFetchModels"[\s\S]*:controls-busy="providerControlsBusy"[\s\S]*:form="form"[\s\S]*:model-options="settingsModelOptions"[\s\S]*@apply-preset="applyPreset"[\s\S]*@update-field="updateProviderFormField"/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<form id="personal-section-provider" class="form-panel provider-settings-panel" :aria-busy="controlsBusy" @submit\.prevent="emit\('submit'\)">/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<select[\s\S]*:value="form\.providerType"[\s\S]*:disabled="controlsBusy"[\s\S]*@change="updateField\('providerType', readInputValue\(\$event\)\); emit\('apply-preset'\)"/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<input :value="form\.gatewayName" :disabled="controlsBusy" @input="updateTrimmedField\('gatewayName', \$event\)" \/>/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<input :value="form\.baseUrl" placeholder="https:\/\/api\.example\.com\/v1" :disabled="controlsBusy" required @input="updateTrimmedField\('baseUrl', \$event\)" \/>/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<select :value="form\.model" :disabled="controlsBusy" required aria-label="[^"]+" @change="updateField\('model', readInputValue\(\$event\)\)">/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /:value="form\.apiKey"[\s\S]*:disabled="controlsBusy"[\s\S]*type="password"[\s\S]*@input="updateTrimmedField\('apiKey', \$event\)"/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<input :checked="form\.clearApiKey" type="checkbox" :disabled="controlsBusy" @change="updateField\('clearApiKey', readInputChecked\(\$event\)\)" \/>/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<details class="provider-advanced-settings">[\s\S]*<summary>[\s\S]*<span>高级模型参数<\/span>[\s\S]*<input :checked="form\.supportsReasoning" type="checkbox" :disabled="controlsBusy" @change="updateField\('supportsReasoning', readInputChecked\(\$event\)\)" \/>[\s\S]*<textarea[\s\S]*:value="form\.extraBody"[\s\S]*:disabled="controlsBusy"[\s\S]*@input="updateField\('extraBody', readInputValue\(\$event\)\)"[\s\S]*\/>[\s\S]*<\/details>/
  );
  assert.doesNotMatch(settingsProviderPanelTemplate, /<details class="provider-advanced-settings" open>/);
  assert.match(
    settingsProviderPanelTemplate,
    /<button class="primary-button" type="submit" :disabled="controlsBusy">/
  );
});

test('SettingsView structures personal settings and extensions through shared section navigation', () => {
  const settingsSectionNavRule = readCssRule('.settings-section-nav');
  const workspaceSettingsNavRule = readCssRule('.workspace-layout-shell .settings-section-nav');

  assert.match(
    settingsViewScript,
    /import \{ useSettingsSectionNavigation \} from '\.\.\/composables\/settings\/useSettingsSectionNavigation';/
  );
  assert.match(
    settingsSectionNavigationSource,
    /export const personalSections = \[\s*\{ id: 'profile', label: '个人资料' \},\s*\{ id: 'provider', label: '模型网关' \},\s*\{ id: 'data', label: '数据导出' \}\s*\];/
  );
  assert.match(
    settingsSectionNavigationSource,
    /\{ id: 'status-templates', label: '状态栏模板', icon: 'Save' \}/
  );
  assert.match(settingsSectionNavigationSource, /const activePersonalSection = ref\('profile'\);/);
  assert.match(settingsSectionNavigationSource, /const personalNavRef = ref\(null\);/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*activeExtensionSection,[\s\S]*activePersonalSection,[\s\S]*extensionNavRef,[\s\S]*extensionSections,[\s\S]*personalNavRef,[\s\S]*personalSections,[\s\S]*scrollToExtensionSection,[\s\S]*scrollToPersonalSection[\s\S]*\} = useSettingsSectionNavigation\(\);/
  );
  assert.match(
    settingsViewTemplate,
    /<nav v-if="isPersonalPage && !loading && !loadError" ref="personalNavRef" class="form-section-nav settings-section-nav personal-section-nav" aria-label="个人设置分区">[\s\S]*v-for="section in personalSections"[\s\S]*:class="\{ active: activePersonalSection === section\.id \}"[\s\S]*@click="scrollToPersonalSection\(section\.id\)"/
  );
  assert.match(settingsViewScript, /import SettingsProfilePanel from '\.\.\/components\/settings\/SettingsProfilePanel\.vue';/);
  assert.match(settingsViewTemplate, /<SettingsProfilePanel[\s\S]*v-if="isPersonalPage && !loading && !loadError"/);
  assert.match(settingsProfilePanelScript, /import \{ Bot, Heart, MessageSquareText, Save, ShieldCheck, Upload \} from '@lucide\/vue';/);
  assert.match(settingsProfilePanelScript, /function formatNumber\(value\) \{[\s\S]*toLocaleString\('zh-CN'\);[\s\S]*\}/);
  assert.match(settingsProfilePanelTemplate, /id="personal-section-profile" class="form-panel profile-panel"/);
  assert.match(settingsProfilePanelTemplate, /<input[\s\S]*type="file"[\s\S]*accept="image\/png,image\/jpeg,image\/webp"[\s\S]*@change="emit\('avatar-change', \$event\)"/);
  assert.match(settingsProfilePanelTemplate, /<Bot :size="18" \/>[\s\S]*\{\{ formatNumber\(stats\.ownedAiCount\) \}\}/);
  assert.match(settingsProfilePanelTemplate, /v-for="character in ownedCharacters"[\s\S]*\{\{ visibilityText\(character\.visibility\) \}\} · 使用 \{\{ formatNumber\(character\.useCount\) \}\}/);
  assert.match(settingsViewScript, /import SettingsProviderPanel from '\.\.\/components\/settings\/SettingsProviderPanel\.vue';/);
  assert.match(settingsProviderPanelScript, /import \{ RefreshCw, Save, ShieldCheck, WalletCards \} from '@lucide\/vue';/);
  assert.match(settingsProviderPanelTemplate, /id="personal-section-provider" class="form-panel provider-settings-panel"/);
  assert.match(settingsViewScript, /import \{ useSettingsDataExports \} from '\.\.\/composables\/settings\/useSettingsDataExports';/);
  assert.match(settingsViewScript, /import SettingsDataExportPanel from '\.\.\/components\/settings\/SettingsDataExportPanel\.vue';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*dataExportBusy,[\s\S]*diagnosticsExporting,[\s\S]*exportDiagnosticsBundle,[\s\S]*exportProjectSnapshotBundle,[\s\S]*resetDataExportScope,[\s\S]*snapshotExporting[\s\S]*\} = useSettingsDataExports\(\{[\s\S]*isPersonalPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(settingsViewScript, /function resetPersonalAsyncScope\(\) \{[\s\S]*resetProviderAsyncScope\(\);[\s\S]*resetProfileAsyncScope\(\);[\s\S]*resetDataExportScope\(\);/);
  assert.match(
    settingsViewTemplate,
    /<SettingsDataExportPanel[\s\S]*v-if="isPersonalPage && !loading && !loadError"[\s\S]*:busy="dataExportBusy"[\s\S]*:diagnostics-exporting="diagnosticsExporting"[\s\S]*:snapshot-exporting="snapshotExporting"[\s\S]*@export-diagnostics="exportDiagnosticsBundle"[\s\S]*@export-snapshot="exportProjectSnapshotBundle"/
  );
  assert.match(settingsDataExportPanelScript, /import \{ Download, FileArchive, Stethoscope \} from '@lucide\/vue';/);
  assert.match(settingsDataExportPanelScript, /const emit = defineEmits\(\['export-diagnostics', 'export-snapshot'\]\);/);
  assert.match(settingsDataExportPanelTemplate, /id="personal-section-data" class="form-panel settings-data-export-panel"/);
  assert.match(settingsDataExportPanelTemplate, /:disabled="busy"[\s\S]*:aria-busy="snapshotExporting"[\s\S]*@click="emit\('export-snapshot'\)"/);
  assert.match(settingsDataExportPanelTemplate, /:disabled="busy"[\s\S]*:aria-busy="diagnosticsExporting"[\s\S]*@click="emit\('export-diagnostics'\)"/);
  assert.match(settingsViewScript, /import SettingsTagPanel from '\.\.\/components\/settings\/SettingsTagPanel\.vue';/);
  assert.match(settingsTagPanelScript, /import \{ Plus, RefreshCw, Tag, Trash2 \} from '@lucide\/vue';/);
  assert.match(settingsTagPanelTemplate, /id="extension-section-tags" class="form-panel tag-management-panel form-section-group"/);
  assert.match(
    settingsViewTemplate,
    /<SettingsTagPanel[\s\S]*v-if="isExtensionsPage"[\s\S]*:action-busy-id="tagActionBusyId"[\s\S]*:tag-list="tagList"[\s\S]*@add="addTag"[\s\S]*@remove="removeTag"/
  );
  assert.match(settingsViewScript, /import SettingsPresetPanel from '\.\.\/components\/settings\/SettingsPresetPanel\.vue';/);
  assert.match(settingsViewScript, /import \{ useSettingsPresets \} from '\.\.\/composables\/settings\/useSettingsPresets';/);
  assert.match(settingsPresetPanelScript, /import \{ Download, Plus, RefreshCw, Save, Sliders, Trash2, Upload \} from '@lucide\/vue';/);
  assert.match(settingsPresetPanelTemplate, /id="extension-section-presets" class="form-panel preset-management-panel form-section-group"/);
  assert.match(
    settingsViewTemplate,
    /<SettingsPresetPanel[\s\S]*v-if="isExtensionsPage"[\s\S]*:action-busy="presetActionBusy"[\s\S]*:preset-list="presetList"[\s\S]*@save="savePreset"[\s\S]*@update-form-field="updatePresetFormField"/
  );
  assert.match(settingsViewScript, /import SettingsModPanel from '\.\.\/components\/settings\/SettingsModPanel\.vue';/);
  assert.match(settingsViewScript, /import \{ useSettingsMods \} from '\.\.\/composables\/settings\/useSettingsMods';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*cancelModEdit,[\s\S]*exportMods,[\s\S]*handleModImportFile,[\s\S]*loadModCharacterOptions,[\s\S]*loadMods,[\s\S]*modActionBusy,[\s\S]*modList,[\s\S]*resetModAsyncScope,[\s\S]*resetModCharacterLoadScope,[\s\S]*saveMod,[\s\S]*toggleMod,[\s\S]*updateModFormField[\s\S]*\} = useSettingsMods\(\{[\s\S]*isExtensionsPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(
    settingsModPanelScript,
    /import \{ Download, GripVertical, Plus, Power, Puzzle, RefreshCw, Save, Sliders, Trash2, Upload, X \} from '@lucide\/vue';/
  );
  assert.match(
    settingsModPanelScript,
    /from '\.\.\/\.\.\/utils\/modDisplay';/
  );
  assert.match(settingsModPanelTemplate, /id="extension-section-mods" class="form-panel mod-management-panel form-section-group"/);
  assert.match(
    settingsViewTemplate,
    /<SettingsModPanel[\s\S]*v-if="isExtensionsPage"[\s\S]*:action-busy="modActionBusy"[\s\S]*:mod-list="modList"[\s\S]*@export="exportMods"[\s\S]*@import-file="handleModImportFile"[\s\S]*@save="saveMod"[\s\S]*@update-form-field="updateModFormField"/
  );
  assert.match(settingsViewScript, /import SettingsRegexPanel from '\.\.\/components\/settings\/SettingsRegexPanel\.vue';/);
  assert.match(settingsViewScript, /import \{ useSettingsRegex \} from '\.\.\/composables\/settings\/useSettingsRegex';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*exportRegexRules,[\s\S]*handleRegexGroupFilterChange,[\s\S]*handleRegexImportFile,[\s\S]*handleToggleRegexRule,[\s\S]*loadRegexRules,[\s\S]*regexRules,[\s\S]*resetRegexAsyncScope,[\s\S]*updateRegexGroupFilter[\s\S]*\} = useSettingsRegex\(\{[\s\S]*isExtensionsPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(settingsRegexPanelScript, /import \{ Download, GripVertical, Power, RefreshCw, Regex, Upload \} from '@lucide\/vue';/);
  assert.match(settingsRegexPanelTemplate, /id="extension-section-regex" class="form-panel regex-rules-panel form-section-group"/);
  assert.match(
    settingsViewTemplate,
    /<SettingsRegexPanel[\s\S]*v-if="isExtensionsPage"[\s\S]*:action-busy-id="regexActionBusyId"[\s\S]*:regex-rules="regexRules"[\s\S]*@toggle="handleToggleRegexRule"[\s\S]*@update-group-filter="updateRegexGroupFilter"/
  );
  assert.match(settingsViewScript, /import \{ useSettingsStatusTemplates \} from '\.\.\/composables\/settings\/useSettingsStatusTemplates';/);
  assert.match(settingsViewScript, /import SettingsStatusTemplatePanel from '\.\.\/components\/settings\/SettingsStatusTemplatePanel\.vue';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*exportStatusBarTemplates,[\s\S]*handleStatusBarTemplateImportFile,[\s\S]*resetStatusTemplateAsyncScope,[\s\S]*statusTemplateActionBusyId,[\s\S]*statusTemplateControlsBusy[\s\S]*\} = useSettingsStatusTemplates\(\{[\s\S]*isExtensionsPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(settingsViewScript, /function resetExtensionAsyncScopes\(\) \{[\s\S]*resetRegexAsyncScope\(\);[\s\S]*resetStatusTemplateAsyncScope\(\);/);
  assert.match(settingsStatusTemplatePanelScript, /import \{ Download, Save, Upload \} from '@lucide\/vue';/);
  assert.match(settingsStatusTemplatePanelTemplate, /id="extension-section-status-templates" class="form-panel status-template-envelope-panel form-section-group"/);
  assert.match(
    settingsViewTemplate,
    /<SettingsStatusTemplatePanel[\s\S]*v-if="isExtensionsPage"[\s\S]*:action-busy-id="statusTemplateActionBusyId"[\s\S]*:controls-busy="statusTemplateControlsBusy"[\s\S]*@export="exportStatusBarTemplates"[\s\S]*@import-file="handleStatusBarTemplateImportFile"/
  );
  assert.match(
    settingsViewTemplate,
    /<nav v-if="isExtensionsPage" ref="extensionNavRef" class="form-section-nav settings-section-nav extension-section-nav" aria-label="扩展管理分区">/
  );
  assert.match(
    settingsSectionNavRule,
    /position:\s*sticky;[\s\S]*backdrop-filter:\s*blur\(14px\);/
  );
  assert.match(
    settingsSectionNavRule,
    /align-self:\s*start;/
  );
  assert.match(
    workspaceSettingsNavRule,
    /top:\s*calc\(-1 \* var\(--workspace-page-padding-top, 28px\)\);/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell \.narrow-page,\s*\.workspace-layout-shell \.extensions-page,\s*\.workspace-layout-shell \.preset-page\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;[^}]*\}/
  );
  assert.match(
    stylesSource,
    /section\[id\^="personal-section-"\],[\s\S]*section\[id\^="extension-section-"\]\s*{[\s\S]*scroll-margin-top:\s*146px;[\s\S]*}/
  );
  assert.match(
    stylesSource,
    /\.provider-advanced-settings\s*{[\s\S]*border:\s*1px solid[\s\S]*border-radius:\s*8px;[\s\S]*}/
  );
  assert.match(
    stylesSource,
    /\.provider-advanced-body textarea\s*{[\s\S]*min-height:\s*138px;[\s\S]*font-family:\s*ui-monospace[\s\S]*}/
  );
});

test('SettingsView exposes provider connection probing beside model refresh', () => {
  assert.match(
    settingsProviderComposableSource,
    /checkProviderHealth,[\s\S]*fetchDeepSeekBalance,[\s\S]*fetchProviderCapabilities,[\s\S]*getProviderSettings/
  );
  assert.match(settingsProviderComposableSource, /const modelProbeLoading = ref\(false\);/);
  assert.match(settingsProviderComposableSource, /const modelProbeStatus = ref\('idle'\);/);
  assert.match(settingsProviderComposableSource, /const modelProbeMessage = ref\(''\);/);
  assert.match(settingsProviderComposableSource, /const providerCapabilities = ref\(\[\]\);/);
  assert.match(settingsProviderComposableSource, /const providerCapabilityLoadError = ref\(''\);/);
  assert.match(settingsProviderComposableSource, /const currentProviderCapability = computed\(\(\) => findCurrentProviderCapability\(\)\);/);
  assert.match(
    settingsViewScript,
    /const \[providerBundle, userProfile\] = await Promise\.all\(\[[\s\S]*loadProviderSettingsBundle\(\),[\s\S]*loadUserProfile\(\)[\s\S]*\]\);[\s\S]*applyProviderSettingsBundle\(providerBundle\);/
  );
  assert.match(
    settingsProviderComposableSource,
    /async function loadProviderSettingsBundle\(\) \{[\s\S]*const \[settings, capabilityResult\] = await Promise\.all\(\[[\s\S]*getProviderSettings\(\),[\s\S]*loadProviderCapabilities\(\)[\s\S]*\]\);[\s\S]*return \{ settings, capabilityResult \};[\s\S]*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /async function probeProviderConnection\(\) \{[\s\S]*if \(!isProviderPageReady\(\) \|\| providerControlsBusy\.value \|\| !canFetchModels\.value\) \{[\s\S]*return;[\s\S]*modelProbeLoading\.value = true;[\s\S]*setProviderProbeResult\('checking', '正在检测网关健康状态\.\.\.'\);[\s\S]*checkProviderHealth\(request\)/
  );
  assert.match(
    settingsProviderComposableSource,
    /applyProviderHealthResult\(health\);[\s\S]*const sampleOptions = Array\.isArray\(health\?\.sampleModels\) \? health\.sampleModels : \[\];[\s\S]*applyModelOptions\(sampleOptions\);/
  );
  assert.match(
    settingsProviderComposableSource,
    /setProviderProbeResult\('success', message\);[\s\S]*notify\?\.success\?\.?\(message\);/
  );
  assert.match(
    settingsProviderComposableSource,
    /if \(!health\?\.ok\) \{[\s\S]*setProviderProbeResult\('error', message\);[\s\S]*notify\?\.error\?\.\(`连接检测失败：\$\{message\}`\);/
  );
  assert.match(
    settingsProviderComposableSource,
    /function applyProviderCapabilitiesResult\(result = \{\}\) \{[\s\S]*providerCapabilityLoadError\.value = result\.error\?\.message \|\| '能力注册表加载失败';[\s\S]*applyProviderCapabilities\(result\.data\);[\s\S]*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /function applyProviderHealthResult\(health = \{\}\) \{[\s\S]*if \(health\?\.capability\) \{[\s\S]*upsertProviderCapability\(health\.capability\);[\s\S]*\}/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsProviderPanel[\s\S]*:provider-capability="currentProviderCapability"[\s\S]*:provider-capability-error="providerCapabilityLoadError"/
  );
  assert.match(
    settingsProviderPanelTemplate,
    /<button class="ghost-button compact-button" type="button" :disabled="controlsBusy \|\| !canFetchModels" :aria-busy="probeLoading" @click="emit\('probe-provider'\)">/
  );
  assert.match(settingsProviderPanelTemplate, /<span>\{\{ probeLoading \? '检测中' : '检测连接' \}\}<\/span>/);
  assert.match(
    settingsProviderPanelTemplate,
    /<p v-if="probeMessage" class="provider-probe-message" :class="`probe-\$\{probeStatus\}`" role="status">/
  );
  assert.match(settingsProviderPanelScript, /import \{ computed \} from 'vue';/);
  assert.match(settingsProviderPanelScript, /providerCapability: \{ type: Object, default: null \}/);
  assert.match(settingsProviderPanelScript, /providerCapabilityError: \{ type: String, default: '' \}/);
  assert.match(settingsProviderPanelScript, /const capabilityDefinitions = \[[\s\S]*\{ key: 'streaming', label: '流式' \}[\s\S]*\{ key: 'imageGeneration', label: '生图' \}[\s\S]*\];/);
  assert.match(settingsProviderPanelScript, /const capabilityItems = computed\(\(\) => \{[\s\S]*const capabilities = props\.providerCapability\?\.capabilities \|\| \{\};[\s\S]*enabled: Boolean\(capabilities\[definition\.key\]\)[\s\S]*\}\);/);
  assert.match(
    settingsProviderPanelTemplate,
    /<div class="provider-capability-panel" :aria-label="`\$\{providerCapabilityName\} 能力`">[\s\S]*<div class="provider-capability-grid">[\s\S]*v-for="item in capabilityItems"[\s\S]*:class="\{ enabled: item\.enabled, disabled: !item\.enabled \}"/
  );
  assert.match(stylesSource, /\.provider-capability-grid\s*{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(92px, 1fr\)\);[\s\S]*}/);
  assert.match(stylesSource, /\.provider-capability-chip\.enabled\s*{[\s\S]*border-color:[\s\S]*var\(--green\)[\s\S]*}/);
});

test('SettingsView no-key custom provider readiness trusts parsed private IPv4 hosts only', () => {
  assert.equal(isLocalOrPrivateBaseUrl('http://127.0.0.1:8317/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://10.0.0.8:8317/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://172.31.255.1/v1'), true);
  assert.equal(isLocalOrPrivateBaseUrl('http://172.32.0.1/v1'), false);
  assert.equal(isLocalOrPrivateBaseUrl('http://127.evil.test/v1'), false);

  assert.match(settingsProviderComposableSource, /from '..\/..\/..\/..\/shared\/privateNetwork\.js'/);
  assert.doesNotMatch(settingsViewScript, /privateNetwork\.js/);
  assert.doesNotMatch(settingsViewScript, /function isLocalOrPrivateBaseUrl\(value\) \{/);
  assert.doesNotMatch(settingsViewScript, /function parseIpv4Address\(host\) \{/);
  assert.doesNotMatch(settingsViewScript, /host\.startsWith\('127\.'\)/);
  assert.doesNotMatch(settingsViewScript, /host\.split\('\\.'\)\.map/);
  assert.doesNotMatch(settingsProviderComposableSource, /function isLocalOrPrivateBaseUrl\(value\) \{/);
  assert.doesNotMatch(settingsProviderComposableSource, /function parseIpv4Address\(host\) \{/);
});

test('SettingsView extension retry handlers ignore events while already loading', () => {
  assert.match(
    settingsViewTemplate,
    /<SettingsTagPanel[\s\S]*:controls-busy="tagControlsBusy"[\s\S]*@load="loadTags"/
  );
  assert.match(
    settingsTagPanelTemplate,
    /:disabled="controlsBusy" @click="emit\('load'\)"/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsPresetPanel[\s\S]*:controls-busy="presetControlsBusy"[\s\S]*@load="loadPresets"/
  );
  assert.match(
    settingsPresetPanelTemplate,
    /:disabled="controlsBusy" @click="emit\('load'\)"/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsModPanel[\s\S]*:controls-busy="modControlsBusy"[\s\S]*@load="loadMods"/
  );
  assert.match(
    settingsModPanelTemplate,
    /:disabled="controlsBusy" @click="emit\('load'\)"/
  );
  assert.match(
    settingsViewTemplate,
    /<SettingsRegexPanel[\s\S]*:controls-busy="regexControlsBusy"[\s\S]*@load="loadRegexRules"/
  );
  assert.match(
    settingsRegexPanelTemplate,
    /:disabled="controlsBusy" @click="emit\('load'\)"/
  );
  assert.match(
    settingsModPanelTemplate,
    /:disabled="charactersLoading \|\| actionBusy" @click="emit\('load-characters'\)"/
  );
  assert.match(
    settingsModsComposableSource,
    /async function loadModCharacterOptions\(\) {\s*if \(!isExtensionPageReady\(\) \|\| modCharactersLoading\.value \|\| modActionBusy\.value\) {\s*return;/
  );
});

test('SettingsView direct-scans Mod select-all and extension sections', () => {
  const selectAllStart = settingsModsComposableSource.indexOf('function selectAllModCharacters() {');
  const selectAllEnd = settingsModsComposableSource.indexOf('\n  function clearModCharacters()', selectAllStart);
  assert.notEqual(selectAllStart, -1);
  assert.notEqual(selectAllEnd, -1);
  const selectAllSnippet = settingsModsComposableSource.slice(selectAllStart, selectAllEnd);

  assert.match(
    selectAllSnippet,
    /function selectAllModCharacters\(\) \{\s*if \(modActionBusy\.value\) return;\s*const characterIds = \[\];\s*for \(const character of modCharacterOptions\.value\) \{\s*characterIds\.push\(character\.id\);\s*\}\s*modForm\.characterIds = characterIds;\s*\}/
  );
  assert.doesNotMatch(selectAllSnippet, /modCharacterOptions\.value\.map/);

  assert.match(
    settingsSectionNavigationSource,
    /function hasSettingsSection\(sections, sectionId\) \{\s*for \(const section of sections\) \{\s*if \(section\.id === sectionId\) \{\s*return true;\s*\}\s*\}\s*return false;\s*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function setActiveSettingsSection\(activeSectionRef, sections, sectionId\) \{\s*if \(!hasSettingsSection\(sections, sectionId\)\) \{\s*return false;\s*\}\s*activeSectionRef\.value = sectionId;\s*return true;\s*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function getSettingsScrollContainer\(navRef\) \{[\s\S]*navRef\.value\?\.closest\?\.\('\.page-shell'\)[\s\S]*document\.querySelector\('\.page-shell'\);[\s\S]*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function getSettingsTopbarBottom\(\) \{[\s\S]*document\.querySelector\('\.topbar'\)\?\.getBoundingClientRect\(\)\.bottom[\s\S]*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function getSettingsSectionActivationOffset\(navRef\) \{[\s\S]*const navBottom = navRef\.value\?\.getBoundingClientRect\(\)\.bottom;[\s\S]*if \(Number\.isFinite\(navBottom\)\) \{[\s\S]*return Math\.max\(0, Math\.ceil\(navBottom\)\) \+ 14;[\s\S]*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function scrollSettingsPageTo\(navRef, top\) \{[\s\S]*const scroller = getSettingsScrollContainer\(navRef\);[\s\S]*scroller\.scrollTo\(\{ top: roundedTop, behavior: 'smooth' \}\);[\s\S]*window\.scrollTo\(\{ top: roundedTop, behavior: 'smooth' \}\);[\s\S]*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function scrollToSettingsSection\(prefix, activeSectionRef, sections, navRef, sectionId\) \{\s*if \(!setActiveSettingsSection\(activeSectionRef, sections, sectionId\)\) \{\s*return;\s*\}[\s\S]*document\.getElementById\(`\$\{prefix\}-\$\{sectionId\}`\);[\s\S]*const top = el\.getBoundingClientRect\(\)\.top \+ getSettingsScrollTop\(navRef\) - getSettingsSectionActivationOffset\(navRef\);[\s\S]*scrollSettingsPageTo\(navRef, top\);/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function scrollToPersonalSection\(sectionId\) \{\s*scrollToSettingsSection\('personal-section', activePersonalSection, personalSections, personalNavRef, sectionId\);\s*\}/
  );
  assert.match(
    settingsSectionNavigationSource,
    /function scrollToExtensionSection\(sectionId\) \{\s*scrollToSettingsSection\('extension-section', activeExtensionSection, extensionSections, extensionNavRef, sectionId\);\s*\}/
  );
  assert.doesNotMatch(settingsSectionNavigationSource, /extensionSections\.some/);
  assert.doesNotMatch(settingsViewScript, /function hasSettingsSection/);
  assert.doesNotMatch(settingsViewScript, /function setActiveSettingsSection/);
  assert.doesNotMatch(settingsViewScript, /function getSettingsScrollContainer/);
  assert.doesNotMatch(settingsViewScript, /function scrollToSettingsSection/);
  assert.doesNotMatch(settingsViewScript, /function setActiveExtensionSection/);
  assert.doesNotMatch(settingsViewScript, /function hasExtensionSection/);
  assert.doesNotMatch(settingsViewScript, /function scrollActiveExtensionTab/);
  assert.doesNotMatch(settingsViewScript, /el\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\);/);
});

test('SettingsView preserves unchanged extension list references during refreshes', () => {
  const extensionStateSources = [
    settingsViewScript,
    settingsTagsComposableSource,
    settingsPresetsComposableSource,
    settingsModsComposableSource,
    settingsRegexComposableSource
  ].join('\n');

  assert.match(
    extensionStateSources,
    /import \{ callEventMethod \} from '\.\.\/\.\.\/utils\/eventMethods';/
  );
  assert.doesNotMatch(settingsViewScript, /eventMethods/);
  assert.match(
    `${extensionStateSources}\n${settingsProfileComposableSource}`,
    /from '\.\/settingsListState\.js';/
  );
  assert.doesNotMatch(settingsViewScript, /settingsListState/);
  assert.match(
    settingsListStateSource,
    /import \{ samePlainValue \} from '\.\.\/\.\.\/utils\/plainValues';/
  );
  assert.doesNotMatch(
    settingsViewScript,
    /function samePlainValue\(/
  );
  assert.match(
    settingsListStateSource,
    /function sameListItems\(currentList, nextList\) \{[\s\S]*currentList\.length !== nextList\.length[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*samePlainValue\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsListStateSource,
    /function setListIfChanged\(listRef, nextList\) \{[\s\S]*sameListItems\(listRef\.value, normalizedNextList\)[\s\S]*listRef\.value = normalizedNextList;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsTagsComposableSource,
    /const nextTags = await fetchTags\(\{ limit \}\);[\s\S]*setListIfChanged\(tagList, nextTags\);/
  );
  assert.match(
    settingsPresetsComposableSource,
    /const nextPresets = await fetchPresets\(\);[\s\S]*setListIfChanged\(presetList, nextPresets\);/
  );
  assert.match(
    settingsModsComposableSource,
    /const nextMods = await fetchMods\(\);[\s\S]*setListIfChanged\(modList, nextMods\);/
  );
  assert.match(
    settingsModsComposableSource,
    /const characters = await fetchCharacters\(\{ sort: 'name' \}\);[\s\S]*setModCharacterOptionsIfChanged\(characters\);/
  );
  assert.match(
    settingsModsComposableSource,
    /function setModCharacterOptionsIfChanged\(characters\) \{\s*const nextOptions = \[\];\s*if \(Array\.isArray\(characters\)\) \{\s*for \(const character of characters\) \{\s*if \(character\?\.canUse !== false\) \{\s*nextOptions\.push\(character\);\s*\}\s*\}\s*\}\s*return setListIfChanged\(modCharacterOptions, nextOptions\);\s*\}/
  );
  assert.match(
    settingsListStateSource,
    /function getListItemById\(listRef, itemId\) \{\s*const targetId = String\(itemId \|\| ''\);[\s\S]*const currentList = Array\.isArray\(listRef\.value\) \? listRef\.value : \[\];[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*return item;[\s\S]*}\s*}\s*return null;[\s\S]*\}/
  );
  assert.match(
    settingsListStateSource,
    /function prependListItemByIdWithLimit\(listRef, nextItem, limit\) \{[\s\S]*const nextList = \[nextItem\];[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === nextId\) continue;[\s\S]*if \(nextList\.length >= normalizedLimit\) break;[\s\S]*nextList\.push\(item\);[\s\S]*return setListIfChanged\(listRef, nextList\);[\s\S]*\}/
  );
  assert.match(
    settingsListStateSource,
    /function removeListItemByIdIfPresent\(listRef, itemId\) \{[\s\S]*const nextList = \[\];\s*let changed = false;[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextList\.push\(item\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return changed;[\s\S]*\}/
  );
  assert.match(
    settingsListStateSource,
    /function updateListItemByIdIfChanged\(listRef, itemId, nextItem\) \{[\s\S]*const nextList = \[\];\s*let changed = false;[\s\S]*for \(const item of currentList\) \{[\s\S]*if \(item\?\.id === targetId\) \{[\s\S]*if \(!samePlainValue\(item, nextItem\)\) \{[\s\S]*changed = true;[\s\S]*nextList\.push\(nextItem\);[\s\S]*} else \{[\s\S]*nextList\.push\(item\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return changed;[\s\S]*\}/
  );
  assert.match(
    settingsListStateSource,
    /function moveListItemToTargetIndexById\(listRef, itemId, targetItemId\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*if \(id === sourceId\) \{[\s\S]*fromIndex = index;[\s\S]*} else if \(id === targetId\) \{[\s\S]*targetIndex = index;[\s\S]*}[\s\S]*const nextList = currentList\.slice\(\);[\s\S]*nextList\.splice\(targetIndex, 0, moved\);[\s\S]*const ids = \[\];[\s\S]*for \(const item of nextList\) \{[\s\S]*ids\.push\(item\.id\);[\s\S]*setListIfChanged\(listRef, nextList\);[\s\S]*return \{ previousList: currentList, nextList, ids \};[\s\S]*\}/
  );
  assert.match(
    settingsRegexComposableSource,
    /const nextRules = await fetchRegexRules\(groupFilter\);[\s\S]*setListIfChanged\(regexRules, nextRules\);/
  );
  assert.doesNotMatch(
    extensionStateSources,
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
    settingsListStateSource,
    /function setPlainValueIfChanged\(valueRef, nextValue\) \{[\s\S]*samePlainValue\(valueRef\.value, nextValue\)[\s\S]*valueRef\.value = nextValue;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /function setProviderPlainValueIfChanged\(valueRef, nextValue\) \{[\s\S]*samePlainValue\(valueRef\.value, nextValue\)[\s\S]*valueRef\.value = nextValue;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /function setBalanceIfChanged\(nextBalance\) \{\s*return setProviderPlainValueIfChanged\(balance, nextBalance\);\s*\}/
  );
  assert.match(
    settingsProfileComposableSource,
    /function setProfileStatsIfChanged\(nextStats\) \{\s*return setPlainValueIfChanged\(profileStats, nextStats \|\| profileStats\.value\);\s*\}/
  );
  assert.match(
    settingsProfileComposableSource,
    /function setOwnedCharactersIfChanged\(nextCharacters\) \{\s*return setListIfChanged\(ownedCharacters, nextCharacters\);\s*\}/
  );
  assert.match(
    settingsProviderComposableSource,
    /const nextBalance = await fetchDeepSeekBalance\(\);[\s\S]*setBalanceIfChanged\(nextBalance\);/
  );
  assert.match(
    settingsProfileComposableSource,
    /function applyProfile\(result = \{\}\) \{\s*applyProfileUser\(result\.user \|\| \{\}\);\s*setProfileStatsIfChanged\(result\.stats\);\s*setOwnedCharactersIfChanged\(result\.ownedCharacters\);\s*\}/
  );
  assert.doesNotMatch(settingsViewScript, /balance\.value\s*=\s*nextBalance/);
  assert.doesNotMatch(settingsProviderComposableSource, /balance\.value\s*=\s*nextBalance/);
  assert.doesNotMatch(settingsProfileComposableSource, /profileStats\.value\s*=\s*result\.stats/);
  assert.doesNotMatch(settingsProfileComposableSource, /ownedCharacters\.value\s*=\s*result\.ownedCharacters/);
  assert.doesNotMatch(settingsViewScript, /function (applyProfile|submitProfile|handleUserAvatar|setProfileStatsIfChanged|setOwnedCharactersIfChanged)\(/);
});

test('SettingsView tag mutations expose one busy guard for add, delete, and load-limit edits', () => {
  assert.match(settingsViewScript, /import \{ useSettingsTags \} from '\.\.\/composables\/settings\/useSettingsTags';/);
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*addTag,[\s\S]*loadTags,[\s\S]*newTagName,[\s\S]*normalizedTagLoadLimit,[\s\S]*removeTag,[\s\S]*resetTagAsyncScope,[\s\S]*tagActionBusyId,[\s\S]*tagControlsBusy,[\s\S]*tagList,[\s\S]*tagLoadError,[\s\S]*tagLoading,[\s\S]*tagLoadLimit,[\s\S]*updateNewTagName,[\s\S]*updateTagLoadLimit,[\s\S]*updateTagLoadLimitDraft[\s\S]*\} = useSettingsTags\(\{[\s\S]*isExtensionsPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(settingsTagsComposableSource, /const tagActionBusyId = ref\(''\);/);
  assert.match(settingsTagsComposableSource, /const tagActionBusy = computed\(\(\) => Boolean\(tagActionBusyId\.value\)\);/);
  assert.match(settingsTagsComposableSource, /const tagControlsBusy = computed\(\(\) => tagLoading\.value \|\| tagActionBusy\.value\);/);
  assert.match(settingsTagsComposableSource, /function getCurrentTag\(id\) {\s*return getListItemById\(tagList, id\);\s*}/);
  assert.match(settingsTagsComposableSource, /function updateNewTagName\(value\) {\s*newTagName\.value = String\(value \|\| ''\);\s*}/);
  assert.match(settingsTagsComposableSource, /function updateTagLoadLimitDraft\(value\) {\s*tagLoadLimit\.value = value;\s*}/);
  assert.match(settingsTagsComposableSource, /function updateTagLoadLimit\(\) {\s*if \(tagControlsBusy\.value\) return;/);
  assert.match(
    settingsTagsComposableSource,
    /async function addTag\(\) {[\s\S]*if \(!name \|\| tagControlsBusy\.value\) return;[\s\S]*beginTagMutation\('tag-add'\)[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );
  assert.match(
    settingsTagsComposableSource,
    /const tag = await createTag\(\{ name \}\);[\s\S]*prependListItemByIdWithLimit\(tagList, tag, normalizedTagLoadLimit\.value\);/
  );
  assert.match(
    settingsTagsComposableSource,
    /async function removeTag\(id, name\) {\s*if \(tagControlsBusy\.value\) return;\s*const currentTag = getCurrentTag\(id\);\s*if \(!currentTag\) return;[\s\S]*beginTagMutation\(tagDeleteActionId\(currentTag\.id\)\)[\s\S]*await deleteTag\(currentTag\.id\);[\s\S]*removeListItemByIdIfPresent\(tagList, currentTag\.id\);[\s\S]*finally {\s*finishTagMutation\(mutationToken\);/
  );
  assert.equal(countMatches(settingsTagsComposableSource, /removeListItemByIdIfPresent\(tagList, currentTag\.id\);/g), 2);
  assert.doesNotMatch(settingsTagsComposableSource, /tagList\.value\.filter/);
  assert.doesNotMatch(settingsViewScript, /async function addTag\(\)/);
  assert.doesNotMatch(settingsViewScript, /async function removeTag\(/);

  assert.match(
    settingsViewTemplate,
    /<SettingsTagPanel[\s\S]*:controls-busy="tagControlsBusy"[\s\S]*:new-tag-name="newTagName"[\s\S]*:normalized-load-limit="normalizedTagLoadLimit"[\s\S]*@update-load-limit="updateTagLoadLimit"[\s\S]*@update-load-limit-draft="updateTagLoadLimitDraft"[\s\S]*@update-new-tag-name="updateNewTagName"/
  );
  assert.match(settingsTagPanelScript, /function isTagDeleteBusy\(id\) {\s*return props\.actionBusyId === tagDeleteActionId\(id\);\s*}/);
  assert.match(settingsTagPanelTemplate, /:disabled="controlsBusy"[\s\S]*@input="emit\('update-new-tag-name', readInputValue\(\$event\)\)"[\s\S]*@keyup\.enter="emit\('add'\)"/);
  assert.match(settingsTagPanelTemplate, /:disabled="controlsBusy \|\| !newTagName\.trim\(\)"[\s\S]*:aria-busy="actionBusyId === 'tag-add'"[\s\S]*@click="emit\('add'\)"/);
  assert.match(settingsTagPanelTemplate, /:disabled="controlsBusy"[\s\S]*@input="emit\('update-load-limit-draft', readNumericInputValue\(\$event\)\)"[\s\S]*@change="emit\('update-load-limit'\)"/);
  assert.match(settingsTagPanelTemplate, /:disabled="controlsBusy" @click="emit\('load'\)"/);
  assert.match(settingsTagPanelTemplate, /:disabled="controlsBusy"[\s\S]*:aria-busy="isTagDeleteBusy\(tag\.id\)"[\s\S]*@click="emit\('remove', tag\.id, tag\.name\)"/);
});

test('SettingsView preset mutations expose visible busy guards for edit, import, save, default, and delete actions', () => {
  assert.match(
    settingsViewScript,
    /const \{[\s\S]*cancelPresetEdit,[\s\S]*exportPresets,[\s\S]*handlePresetImportFile,[\s\S]*loadPresets,[\s\S]*makeDefaultPreset,[\s\S]*presetActionBusy,[\s\S]*presetActionBusyId,[\s\S]*presetControlsBusy,[\s\S]*presetEditing,[\s\S]*presetForm,[\s\S]*presetList,[\s\S]*presetLoadError,[\s\S]*presetLoading,[\s\S]*removePreset,[\s\S]*resetPresetAsyncScope,[\s\S]*savePreset,[\s\S]*showPresetEditor,[\s\S]*startEditPreset,[\s\S]*startNewPreset,[\s\S]*updatePresetFormField[\s\S]*\} = useSettingsPresets\(\{[\s\S]*isExtensionsPage,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(settingsPresetsComposableSource, /const presetActionBusyId = ref\(''\);/);
  assert.match(settingsPresetsComposableSource, /const presetActionBusy = computed\(\(\) => Boolean\(presetActionBusyId\.value\)\);/);
  assert.match(settingsPresetsComposableSource, /const presetControlsBusy = computed\(\(\) => presetLoading\.value \|\| presetActionBusy\.value\);/);
  assert.match(settingsPresetsComposableSource, /import \{ exportEnvelope, importEnvelope \} from '\.\.\/\.\.\/api\/envelopes\.js';/);
  assert.match(settingsPresetsComposableSource, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/\.\.\/utils\/downloadJson\.js';/);
  assert.match(settingsPresetsComposableSource, /function getCurrentPreset\(id\) {\s*return getListItemById\(presetList, id\);\s*}/);
  assert.match(settingsPresetsComposableSource, /function startNewPreset\(\) {\s*if \(presetControlsBusy\.value\) return;/);
  assert.match(settingsPresetsComposableSource, /function startEditPreset\(preset\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(preset\?\.id\);\s*if \(!currentPreset\) return;[\s\S]*presetEditing\.value = currentPreset\.id;/);
  assert.match(settingsPresetsComposableSource, /function cancelPresetEdit\(\) {\s*if \(presetActionBusy\.value\) return;/);
  assert.match(
    settingsPresetsComposableSource,
    /async function savePreset\(\) {\s*if \(presetControlsBusy\.value\) return;\s*const editingId = presetEditing\.value;\s*const editingPreset = editingId \? getCurrentPreset\(editingId\) : null;\s*if \(editingId && !editingPreset\) {[\s\S]*closePresetEditor\(\);[\s\S]*return;[\s\S]*}[\s\S]*beginPresetMutation\('preset-save'\)[\s\S]*await updatePreset\(editingPreset\.id, payload\);[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(
    settingsPresetsComposableSource,
    /async function removePreset\(id, name\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(id\);\s*if \(!currentPreset\) return;[\s\S]*beginPresetMutation\(presetDeleteActionId\(currentPreset\.id\)\)[\s\S]*await deletePreset\(currentPreset\.id\);[\s\S]*removeListItemByIdIfPresent\(presetList, currentPreset\.id\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsPresetsComposableSource, /presetList\.value\.filter/);
  assert.match(
    settingsPresetsComposableSource,
    /async function makeDefaultPreset\(id\) {\s*if \(presetControlsBusy\.value\) return;\s*const currentPreset = getCurrentPreset\(id\);\s*if \(!currentPreset\) return;[\s\S]*beginPresetMutation\(presetDefaultActionId\(currentPreset\.id\)\)[\s\S]*await setDefaultPreset\(currentPreset\.id\);[\s\S]*finishPresetMutation\(mutationToken\);\s*await loadPresets\(\);[\s\S]*finally {\s*finishPresetMutation\(mutationToken\);/
  );
  assert.match(
    settingsPresetsComposableSource,
    /async function exportPresets\(\) \{\s*if \(presetControlsBusy\.value\) return;[\s\S]*beginPresetMutation\('preset-export'\)[\s\S]*const envelope = await exportEnvelope\('presets'\);[\s\S]*downloadJsonFile\(envelope, `flai-presets-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(settingsPresetsComposableSource, /async function importPresets\(mutationToken = beginPresetMutation\('preset-import'\)\)/);
  assert.match(settingsPresetsComposableSource, /const result = await importEnvelope\('presets', parsed\);/);
  assert.match(settingsPresetsComposableSource, /if \(!file \|\| presetControlsBusy\.value\) return;/);
  assert.match(
    settingsPresetsComposableSource,
    /function updatePresetFormField\(key, value\) \{\s*if \(!Object\.prototype\.hasOwnProperty\.call\(presetForm, key\)\) \{\s*return;\s*\}\s*presetForm\[key\] = value;\s*\}/
  );
  assert.doesNotMatch(settingsViewScript, /async function savePreset\(\)/);
  assert.doesNotMatch(settingsViewScript, /async function removePreset\(/);

  assert.match(
    settingsViewTemplate,
    /<SettingsPresetPanel[\s\S]*:controls-busy="presetControlsBusy"[\s\S]*:editing="presetEditing"[\s\S]*:form="presetForm"[\s\S]*:show-editor="showPresetEditor"[\s\S]*@cancel-edit="cancelPresetEdit"[\s\S]*@export="exportPresets"[\s\S]*@import-file="handlePresetImportFile"[\s\S]*@load="loadPresets"[\s\S]*@make-default="makeDefaultPreset"[\s\S]*@remove="removePreset"[\s\S]*@save="savePreset"[\s\S]*@start-edit="startEditPreset"[\s\S]*@start-new="startNewPreset"[\s\S]*@update-form-field="updatePresetFormField"/
  );
  assert.match(settingsPresetPanelTemplate, /<button class="ghost-button" type="button" :disabled="controlsBusy" @click="emit\('start-new'\)">/);
  assert.match(settingsPresetPanelTemplate, /:disabled="controlsBusy \|\| !presetList\.length" @click="emit\('export'\)"/);
  assert.match(settingsPresetPanelTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: controlsBusy \}">[\s\S]*<input type="file" accept="\.json" :disabled="controlsBusy" @change="emit\('import-file', \$event\)" \/>/);
  assert.match(settingsPresetPanelTemplate, /:disabled="controlsBusy" @click="emit\('load'\)"/);
  assert.match(settingsPresetPanelTemplate, /<form v-if="showEditor" class="preset-editor" :aria-busy="actionBusy" @submit\.prevent="emit\('save'\)">/);
  assert.match(settingsPresetPanelTemplate, /:value="form\.name"[\s\S]*:disabled="actionBusy"[\s\S]*required[\s\S]*@input="updateField\('name', readInputValue\(\$event\)\.trim\(\)\)"/);
  assert.match(settingsPresetPanelTemplate, /<textarea[\s\S]*:value="form\.systemPrompt"[\s\S]*:disabled="actionBusy"[\s\S]*@input="updateField\('systemPrompt', readInputValue\(\$event\)\)"/);
  assert.match(settingsPresetPanelTemplate, /type="submit" :disabled="actionBusy" :aria-busy="actionBusyId === 'preset-save'"/);
  assert.match(settingsPresetPanelTemplate, /:disabled="actionBusy" @click="emit\('cancel-edit'\)"/);
  assert.match(settingsPresetPanelTemplate, /:disabled="controlsBusy" @click="emit\('start-edit', preset\)"/);
  assert.match(settingsPresetPanelScript, /function isPresetDefaultBusy\(id\) {\s*return props\.actionBusyId === presetDefaultActionId\(id\);\s*}/);
  assert.match(settingsPresetPanelScript, /function isPresetDeleteBusy\(id\) {\s*return props\.actionBusyId === presetDeleteActionId\(id\);\s*}/);
  assert.match(settingsPresetPanelTemplate, /:disabled="controlsBusy"[\s\S]*:aria-busy="isPresetDefaultBusy\(preset\.id\)"[\s\S]*@click="emit\('make-default', preset\.id\)"/);
  assert.match(settingsPresetPanelTemplate, /:disabled="controlsBusy"[\s\S]*:aria-busy="isPresetDeleteBusy\(preset\.id\)"[\s\S]*@click="emit\('remove', preset\.id, preset\.name\)"/);
});

test('SettingsView import file handlers tolerate missing event targets', () => {
  const presetStart = settingsPresetsComposableSource.indexOf('function handlePresetImportFile(event) {');
  const presetEnd = settingsPresetsComposableSource.indexOf('\n  function closePresetEditor()', presetStart);
  const presetHandler = settingsPresetsComposableSource.slice(presetStart, presetEnd);
  const modStart = settingsModsComposableSource.indexOf('function handleModImportFile(event) {');
  const modEnd = settingsModsComposableSource.indexOf('\n  function selectAllModCharacters()', modStart);
  const modHandler = settingsModsComposableSource.slice(modStart, modEnd);
  const regexStart = settingsRegexComposableSource.indexOf('function handleRegexImportFile(event) {');
  const regexEnd = settingsRegexComposableSource.indexOf('\n  function isExtensionPageReady()', regexStart);
  const regexHandler = settingsRegexComposableSource.slice(regexStart, regexEnd);
  const statusTemplateStart = settingsStatusTemplatesComposableSource.indexOf('function handleStatusBarTemplateImportFile(event) {');
  const statusTemplateEnd = settingsStatusTemplatesComposableSource.indexOf('\n  return {', statusTemplateStart);
  const statusTemplateHandler = settingsStatusTemplatesComposableSource.slice(statusTemplateStart, statusTemplateEnd);

  assert.match(
    presetHandler,
    /const input = event\?\.target;\s*const file = input\?\.files\?\.\[0\];\s*if \(input\) \{\s*input\.value = '';\s*\}\s*if \(!file \|\| presetControlsBusy\.value\) return;/
  );
  assert.doesNotMatch(presetHandler, /event\.target\.files/);
  assert.doesNotMatch(presetHandler, /event\.target\.value/);

  assert.match(
    modHandler,
    /const input = event\?\.target;\s*const file = input\?\.files\?\.\[0\];\s*if \(input\) \{\s*input\.value = '';\s*\}\s*if \(!file \|\| modControlsBusy\.value\) return;/
  );
  assert.doesNotMatch(modHandler, /event\.target\.files/);
  assert.doesNotMatch(modHandler, /event\.target\.value/);

  assert.match(
    regexHandler,
    /const input = event\?\.target;\s*const file = input\?\.files\?\.\[0\];\s*if \(input\) \{\s*input\.value = '';\s*\}\s*if \(!file \|\| regexControlsBusy\.value\) return;/
  );
  assert.doesNotMatch(regexHandler, /event\.target\.files/);
  assert.doesNotMatch(regexHandler, /event\.target\.value/);

  assert.match(
    statusTemplateHandler,
    /const input = event\?\.target;\s*const file = input\?\.files\?\.\[0\];\s*if \(input\) \{\s*input\.value = '';\s*\}\s*if \(!file \|\| statusTemplateControlsBusy\.value \|\| isExtensionsPage\?\.value !== true\) return;/
  );
  assert.doesNotMatch(statusTemplateHandler, /event\.target\.files/);
  assert.doesNotMatch(statusTemplateHandler, /event\.target\.value/);
});

test('SettingsView import file handlers settle busy state when reads throw synchronously', () => {
  const presetStart = settingsPresetsComposableSource.indexOf('function handlePresetImportFile(event) {');
  const presetEnd = settingsPresetsComposableSource.indexOf('\n  function closePresetEditor()', presetStart);
  const presetHandler = settingsPresetsComposableSource.slice(presetStart, presetEnd);
  const modStart = settingsModsComposableSource.indexOf('function handleModImportFile(event) {');
  const modEnd = settingsModsComposableSource.indexOf('\n  function selectAllModCharacters()', modStart);
  const modHandler = settingsModsComposableSource.slice(modStart, modEnd);
  const regexStart = settingsRegexComposableSource.indexOf('function handleRegexImportFile(event) {');
  const regexEnd = settingsRegexComposableSource.indexOf('\n  function isExtensionPageReady()', regexStart);
  const regexHandler = settingsRegexComposableSource.slice(regexStart, regexEnd);
  const statusTemplateStart = settingsStatusTemplatesComposableSource.indexOf('function handleStatusBarTemplateImportFile(event) {');
  const statusTemplateEnd = settingsStatusTemplatesComposableSource.indexOf('\n  return {', statusTemplateStart);
  const statusTemplateHandler = settingsStatusTemplatesComposableSource.slice(statusTemplateStart, statusTemplateEnd);

  assert.match(
    presetHandler,
    /try \{\s*reader\.readAsText\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );
  assert.match(
    modHandler,
    /try \{\s*reader\.readAsText\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );
  assert.match(
    regexHandler,
    /try \{\s*reader\.readAsText\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );
  assert.match(
    statusTemplateHandler,
    /try \{\s*reader\.readAsText\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );
  assert.doesNotMatch(presetHandler, /reader\.onerror[\s\S]*;\s*reader\.readAsText\(file\);\s*$/);
  assert.doesNotMatch(modHandler, /reader\.onerror[\s\S]*;\s*reader\.readAsText\(file\);\s*$/);
  assert.doesNotMatch(regexHandler, /reader\.onerror[\s\S]*;\s*reader\.readAsText\(file\);\s*$/);
  assert.doesNotMatch(statusTemplateHandler, /reader\.onerror[\s\S]*;\s*reader\.readAsText\(file\);\s*$/);
});

test('SettingsView export downloads revoke object URLs through the shared JSON downloader', () => {
  assert.match(
    downloadJsonSource,
    /export function downloadJsonFile\(data, filename\) \{[\s\S]*const url = URL\.createObjectURL\(blob\);[\s\S]*link\.download = filename;[\s\S]*try \{\s*link\.click\(\);[\s\S]*\} finally \{\s*URL\.revokeObjectURL\(url\);[\s\S]*\}/
  );
  assert.match(
    downloadJsonSource,
    /export function todayStamp\(\) \{[\s\S]*toISOString\(\)\.slice\(0, 10\)/
  );
  assert.match(settingsDataExportsComposableSource, /import \{ exportProjectSnapshot \} from '\.\.\/\.\.\/api\/app\.js';/);
  assert.match(settingsDataExportsComposableSource, /import \{ exportDiagnostics \} from '\.\.\/\.\.\/api\/diagnostics\.js';/);
  assert.match(settingsDataExportsComposableSource, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/\.\.\/utils\/downloadJson\.js';/);
  assert.match(
    settingsPresetsComposableSource,
    /downloadJsonFile\(envelope, `flai-presets-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsRegexComposableSource,
    /downloadJsonFile\(envelope, `flai-regex-rules-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsModsComposableSource,
    /downloadJsonFile\(envelope, `flai-mods-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsStatusTemplatesComposableSource,
    /downloadJsonFile\(envelope, `flai-status-bar-templates-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsDataExportsComposableSource,
    /async function exportProjectSnapshotBundle\(\) \{[\s\S]*if \(!isPersonalExportReady\(\)\) \{[\s\S]*const snapshot = await exportProjectSnapshot\(\);[\s\S]*downloadJsonFile\(snapshot, `flai-project-snapshot-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsDataExportsComposableSource,
    /async function exportDiagnosticsBundle\(\) \{[\s\S]*if \(!isPersonalExportReady\(\)\) \{[\s\S]*const diagnostics = await exportDiagnostics\(\);[\s\S]*downloadJsonFile\(diagnostics, `flai-diagnostics-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsDataExportsComposableSource,
    /function isPersonalExportReady\(\) \{[\s\S]*return isPersonalPage\?\.value === true && !dataExportBusy\.value;[\s\S]*\}/
  );
  assert.doesNotMatch(settingsPresetsComposableSource, /URL\.createObjectURL/);
  assert.doesNotMatch(settingsRegexComposableSource, /URL\.createObjectURL/);
  assert.doesNotMatch(settingsModsComposableSource, /URL\.createObjectURL/);
  assert.doesNotMatch(settingsStatusTemplatesComposableSource, /URL\.createObjectURL/);
  assert.doesNotMatch(settingsDataExportsComposableSource, /URL\.createObjectURL/);
  assert.doesNotMatch(settingsDataExportsComposableSource, /link\.click\(\);\s*URL\.revokeObjectURL\(url\);/);
});

test('SettingsView status bar template envelopes use shared import and export controls', () => {
  assert.match(settingsStatusTemplatesComposableSource, /import \{ computed, ref \} from 'vue';/);
  assert.match(settingsStatusTemplatesComposableSource, /import \{ exportEnvelope, importEnvelope \} from '\.\.\/\.\.\/api\/envelopes\.js';/);
  assert.match(settingsStatusTemplatesComposableSource, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/\.\.\/utils\/downloadJson\.js';/);
  assert.match(settingsStatusTemplatesComposableSource, /const statusTemplateActionBusyId = ref\(''\);/);
  assert.match(settingsStatusTemplatesComposableSource, /const statusTemplateControlsBusy = computed\(\(\) => statusTemplateActionBusy\.value\);/);
  assert.match(
    settingsStatusTemplatesComposableSource,
    /async function exportStatusBarTemplates\(\) \{\s*if \(statusTemplateControlsBusy\.value \|\| isExtensionsPage\?\.value !== true\) return;[\s\S]*beginStatusTemplateMutation\('status-template-export'\)[\s\S]*const envelope = await exportEnvelope\('status-bar-templates'\);[\s\S]*downloadJsonFile\(envelope, `flai-status-bar-templates-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(
    settingsStatusTemplatesComposableSource,
    /async function importStatusBarTemplates\(importText, mutationToken = beginStatusTemplateMutation\('status-template-import'\)\) \{[\s\S]*const parsed = JSON\.parse\(String\(importText \|\| ''\)\);[\s\S]*const result = await importEnvelope\('status-bar-templates', parsed\);/
  );
  assert.match(settingsStatusTemplatePanelScript, /const emit = defineEmits\(\['export', 'import-file'\]\);/);
  assert.match(settingsStatusTemplatePanelTemplate, /:aria-busy="actionBusyId === 'status-template-export'"[\s\S]*@click="emit\('export'\)"/);
  assert.match(
    settingsStatusTemplatePanelTemplate,
    /<label[\s\S]*:aria-busy="actionBusyId === 'status-template-import'"[\s\S]*<input type="file" accept="\.json" :disabled="controlsBusy" @change="emit\('import-file', \$event\)" \/>/
  );
  assert.doesNotMatch(settingsStatusTemplatesComposableSource, /fetchStatusBar/);
});

test('SettingsView mod mutations expose visible busy guards for editor, toggle, delete, and reorder actions', () => {
  assert.match(settingsModsComposableSource, /const modActionBusyId = ref\(''\);/);
  assert.match(settingsModsComposableSource, /const modActionBusy = computed\(\(\) => Boolean\(modActionBusyId\.value\)\);/);
  assert.match(settingsModsComposableSource, /const modControlsBusy = computed\(\(\) => modLoading\.value \|\| modActionBusy\.value\);/);
  assert.match(settingsModsComposableSource, /import \{ exportEnvelope, importEnvelope \} from '\.\.\/\.\.\/api\/envelopes\.js';/);
  assert.match(settingsModsComposableSource, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/\.\.\/utils\/downloadJson\.js';/);
  assert.match(settingsModsComposableSource, /function getCurrentMod\(id\) {\s*return getListItemById\(modList, id\);\s*}/);
  assert.match(settingsModsComposableSource, /function startNewMod\(\) {\s*if \(modControlsBusy\.value\) return;/);
  assert.match(settingsModsComposableSource, /function startEditMod\(mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;[\s\S]*modEditing\.value = currentMod\.id;/);
  assert.match(settingsModsComposableSource, /function cancelModEdit\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(
    settingsModsComposableSource,
    /async function saveMod\(\) {\s*if \(modControlsBusy\.value\) return;[\s\S]*if \(editingId && !getCurrentMod\(editingId\)\) {[\s\S]*closeModEditor\(\);[\s\S]*return;[\s\S]*}[\s\S]*beginModMutation\('mod-save'\)[\s\S]*finishModMutation\(mutationToken\);\s*await loadMods\(\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsModsComposableSource,
    /async function removeMod\(id, name\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(id\);\s*if \(!currentMod\) return;[\s\S]*beginModMutation\(modDeleteActionId\(currentMod\.id\)\)[\s\S]*await deleteMod\(currentMod\.id\);[\s\S]*removeListItemByIdIfPresent\(modList, currentMod\.id\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.match(
    settingsModsComposableSource,
    /async function toggleMod\(mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;[\s\S]*beginModMutation\(modToggleActionId\(currentMod\.id\)\)[\s\S]*await updateMod\(currentMod\.id, \{ enabled: nextEnabled \}\);[\s\S]*if \(!getCurrentMod\(currentMod\.id\)\) return;[\s\S]*updateListItemByIdIfChanged\(modList, currentMod\.id, nextMod\);[\s\S]*finally {\s*finishModMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsModsComposableSource, /modList\.value\.filter/);
  assert.doesNotMatch(settingsModsComposableSource, /modList\.value\.map\(\(item\) => \(item\.id === currentMod\.id \? nextMod : item\)\)/);
  assert.match(settingsModsComposableSource, /function selectAllModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsModsComposableSource, /function clearModCharacters\(\) {\s*if \(modActionBusy\.value\) return;/);
  assert.match(settingsModsComposableSource, /function onModDragStart\(event, mod\) {\s*if \(modControlsBusy\.value\) {[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*const currentMod = getCurrentMod\(mod\?\.id\);[\s\S]*if \(!currentMod\) {[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*draggingMod\.value = currentMod\.id;[\s\S]*const dataTransfer = event\?\.dataTransfer;[\s\S]*if \(dataTransfer\) {\s*dataTransfer\.effectAllowed = 'move';\s*}/);
  assert.match(
    settingsModsComposableSource,
    /function onModDragOver\(event, mod\) {\s*if \(modControlsBusy\.value\) return;\s*const currentMod = getCurrentMod\(mod\?\.id\);\s*if \(!currentMod\) return;\s*callEventMethod\(event, 'preventDefault'\);\s*if \(dragOverMod\.value !== currentMod\.id\) {\s*dragOverMod\.value = currentMod\.id;\s*}/
  );
  assert.match(settingsModsComposableSource, /async function onModDrop\(event, targetMod\) {[\s\S]*if \(modControlsBusy\.value\) return;[\s\S]*const currentDraggedMod = getCurrentMod\(draggedId\);[\s\S]*const currentTargetMod = getCurrentMod\(targetMod\?\.id\);[\s\S]*if \(!currentDraggedMod \|\| !currentTargetMod \|\| currentDraggedMod\.id === currentTargetMod\.id\)[\s\S]*beginModMutation\('mod-reorder'\)[\s\S]*finally {\s*finishModMutation\(mutationToken\);/);
  assert.match(
    settingsModsComposableSource,
    /const moveResult = moveListItemToTargetIndexById\(modList, currentDraggedMod\.id, currentTargetMod\.id\);[\s\S]*await reorderMods\(moveResult\.ids\);[\s\S]*setListIfChanged\(modList, moveResult\.previousList\);/
  );
  assert.match(
    settingsModsComposableSource,
    /async function exportMods\(\) \{\s*if \(modControlsBusy\.value\) return;[\s\S]*beginModMutation\('mod-export'\)[\s\S]*const envelope = await exportEnvelope\('mods'\);[\s\S]*downloadJsonFile\(envelope, `flai-mods-\$\{todayStamp\(\)\}\.json`\);/
  );
  assert.match(settingsModsComposableSource, /async function importMods\(importText, mutationToken = beginModMutation\('mod-import'\)\)/);
  assert.match(settingsModsComposableSource, /const result = await importEnvelope\('mods', parsed\);/);
  assert.match(settingsModsComposableSource, /if \(!file \|\| modControlsBusy\.value\) return;/);
  assert.doesNotMatch(settingsModsComposableSource, /modList\.value\.findIndex/);
  assert.doesNotMatch(settingsModsComposableSource, /reorderMods\([^)]*\.map/);
  assert.doesNotMatch(settingsModsComposableSource, /event\.dataTransfer\.effectAllowed/);
  assert.match(settingsModsComposableSource, /import \{ normalizeModCharacterIds, normalizeModScope \} from '\.\.\/\.\.\/utils\/modDisplay';/);
  assert.match(
    settingsModsComposableSource,
    /function updateModFormField\(key, value\) \{\s*if \(!Object\.prototype\.hasOwnProperty\.call\(modForm, key\)\) \{\s*return;\s*\}\s*modForm\[key\] = value;\s*\}/
  );
  assert.doesNotMatch(settingsModsComposableSource, /function modTypeLabel\(type\)/);
  assert.doesNotMatch(settingsModsComposableSource, /function modScopeLabel\(mod\)/);
  assert.doesNotMatch(settingsViewScript, /function (loadMods|loadModCharacterOptions|saveMod|removeMod|toggleMod|onModDrop)\(/);
  assert.doesNotMatch(settingsViewScript, /const modActionBusyId = ref/);
  assert.doesNotMatch(settingsViewScript, /fetchMods\(\)/);

  assert.match(
    settingsViewTemplate,
    /<SettingsModPanel[\s\S]*:controls-busy="modControlsBusy"[\s\S]*:form="modForm"[\s\S]*:show-editor="showModEditor"[\s\S]*@cancel-edit="cancelModEdit"[\s\S]*@clear-characters="clearModCharacters"[\s\S]*@drag-end="onModDragEnd"[\s\S]*@drag-over="onModDragOver"[\s\S]*@drag-start="onModDragStart"[\s\S]*@drop="onModDrop"[\s\S]*@export="exportMods"[\s\S]*@import-file="handleModImportFile"[\s\S]*@load="loadMods"[\s\S]*@load-characters="loadModCharacterOptions"[\s\S]*@remove="removeMod"[\s\S]*@save="saveMod"[\s\S]*@select-all-characters="selectAllModCharacters"[\s\S]*@start-edit="startEditMod"[\s\S]*@start-new="startNewMod"[\s\S]*@toggle="toggleMod"[\s\S]*@update-form-field="updateModFormField"/
  );
  assert.match(settingsModPanelTemplate, /<button class="ghost-button" type="button" :disabled="controlsBusy" @click="emit\('start-new'\)">/);
  assert.match(settingsModPanelTemplate, /:disabled="controlsBusy \|\| !modList\.length" @click="emit\('export'\)"/);
  assert.match(settingsModPanelTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: controlsBusy \}" :aria-busy="actionBusyId === 'mod-import'">[\s\S]*<input type="file" accept="\.json" :disabled="controlsBusy" @change="emit\('import-file', \$event\)" \/>/);
  assert.match(settingsModPanelTemplate, /:disabled="controlsBusy" @click="emit\('load'\)"/);
  assert.match(settingsModPanelTemplate, /<form class="preset-editor mod-editor-modal" role="dialog" aria-modal="true" :aria-busy="actionBusy"/);
  assert.match(settingsModPanelTemplate, /aria-label="关闭 Mod 编辑器" :disabled="actionBusy" @click="emit\('cancel-edit'\)"/);
  assert.match(settingsModPanelTemplate, /<input :value="form\.name"[\s\S]*:disabled="actionBusy"[\s\S]*required[\s\S]*@input="updateTrimmedField\('name', \$event\)"/);
  assert.match(settingsModPanelTemplate, /<select :value="form\.type" :disabled="actionBusy" @change="updateField\('type', readInputValue\(\$event\)\)">/);
  assert.match(settingsModPanelTemplate, /<textarea :value="form\.content"[\s\S]*:disabled="actionBusy" required @input="updateField\('content', readInputValue\(\$event\)\)" \/>/);
  assert.match(settingsModPanelTemplate, /:disabled="actionBusy \|\| !characterOptions\.length" @click="emit\('select-all-characters'\)"/);
  assert.match(settingsModPanelTemplate, /:disabled="actionBusy \|\| !form\.characterIds\.length" @click="emit\('clear-characters'\)"/);
  assert.match(settingsModPanelTemplate, /<input :checked="form\.enabled" type="checkbox" :disabled="actionBusy" @change="updateField\('enabled', readInputChecked\(\$event\)\)" \/>/);
  assert.match(settingsModPanelTemplate, /type="submit" :disabled="actionBusy" :aria-busy="actionBusyId === 'mod-save'"/);
  assert.match(settingsModPanelTemplate, /:draggable="!controlsBusy"[\s\S]*:aria-busy="isModToggleBusy\(mod\.id\) \|\| isModDeleteBusy\(mod\.id\) \|\| actionBusyId === 'mod-reorder'"/);
  assert.match(settingsModPanelScript, /function isModToggleBusy\(id\) {\s*return props\.actionBusyId === modToggleActionId\(id\);\s*}/);
  assert.match(settingsModPanelScript, /function isModDeleteBusy\(id\) {\s*return props\.actionBusyId === modDeleteActionId\(id\);\s*}/);
  assert.match(settingsModPanelTemplate, /:disabled="controlsBusy"[\s\S]*:aria-busy="isModToggleBusy\(mod\.id\)"[\s\S]*@click="emit\('toggle', mod\)"/);
  assert.match(settingsModPanelTemplate, /:disabled="controlsBusy" @click="emit\('start-edit', mod\)"/);
  assert.match(settingsModPanelTemplate, /:disabled="controlsBusy" :aria-busy="isModDeleteBusy\(mod\.id\)" @click="emit\('remove', mod\.id, mod\.name\)"/);
});

test('SettingsView regex mutations expose visible busy guards for filter, import, toggle, and reorder actions', () => {
  assert.match(settingsRegexComposableSource, /const regexActionBusyId = ref\(''\);/);
  assert.match(settingsRegexComposableSource, /const regexActionBusy = computed\(\(\) => Boolean\(regexActionBusyId\.value\)\);/);
  assert.match(settingsRegexComposableSource, /const regexControlsBusy = computed\(\(\) => regexLoading\.value \|\| regexActionBusy\.value\);/);
  assert.match(settingsRegexComposableSource, /const regexGroupOptions = ref\(\[\]\);/);
  assert.match(settingsRegexComposableSource, /const draggingRegexRuleId = ref\(''\);/);
  assert.match(settingsRegexComposableSource, /function getCurrentRegexRule\(ruleId\) {\s*return getListItemById\(regexRules, ruleId\);\s*}/);
  assert.match(settingsRegexComposableSource, /setListIfChanged\(regexRules, nextRules\);\s*setRegexGroupOptionsFromRules\(nextRules, groupFilter\);/);
  assert.match(settingsRegexComposableSource, /const regexGroups = computed\(\(\) => regexGroupOptions\.value\);/);
  assert.match(
    settingsRegexComposableSource,
    /function setRegexGroupOptionsFromRules\(rules, selectedGroup = ''\) {[\s\S]*const replacingAllGroups = !selectedGroup;[\s\S]*if \(!replacingAllGroups\) {[\s\S]*appendKnownRegexGroups\(nextGroups, regexGroupOptions\.value\);[\s\S]*appendRegexGroupIfMissing\(nextGroups, selectedGroup\);[\s\S]*appendKnownRegexGroups\(nextGroups, normalizeRegexGroupNamesFromRules\(rules\)\);[\s\S]*nextGroups\.sort\(\);[\s\S]*return setListIfChanged\(regexGroupOptions, nextGroups\);[\s\S]*}/
  );
  assert.match(
    settingsRegexComposableSource,
    /function normalizeRegexGroupNamesFromRules\(rules\) {[\s\S]*const groups = \[\];[\s\S]*for \(const rule of Array\.isArray\(rules\) \? rules : \[\]\) {[\s\S]*appendRegexGroupIfMissing\(groups, normalizeRegexGroupName\(rule\?\.groupName\)\);[\s\S]*return groups;[\s\S]*}/
  );
  assert.match(
    settingsRegexComposableSource,
    /function appendRegexGroupIfMissing\(groups, groupName\) {[\s\S]*for \(const group of groups\) {[\s\S]*if \(group === normalizedName\) {[\s\S]*return false;[\s\S]*groups\.push\(normalizedName\);[\s\S]*return true;[\s\S]*}/
  );
  assert.doesNotMatch(settingsRegexComposableSource, /regexRules\.value\.forEach\(\(r\) => groups\.add/);
  assert.doesNotMatch(settingsRegexComposableSource, /return \[\.\.\.groups\]\.sort\(\)/);
  assert.match(settingsRegexComposableSource, /import \{ exportEnvelope, importEnvelope \} from '\.\.\/\.\.\/api\/envelopes\.js';/);
  assert.match(settingsRegexComposableSource, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/\.\.\/utils\/downloadJson\.js';/);
  assert.match(settingsRegexComposableSource, /function handleRegexGroupFilterChange\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(settingsRegexComposableSource, /function updateRegexGroupFilter\(value\) {\s*regexGroupFilter\.value = String\(value \|\| ''\);\s*}/);
  assert.match(
    settingsRegexComposableSource,
    /async function handleToggleRegexRule\(ruleId\) {\s*if \(regexControlsBusy\.value\) return;\s*const currentRule = getCurrentRegexRule\(ruleId\);\s*if \(!currentRule\) return;[\s\S]*beginRegexMutation\(regexToggleActionId\(currentRule\.id\)\)[\s\S]*await toggleRegexRule\(currentRule\.id\);[\s\S]*finishRegexMutation\(mutationToken\);\s*await loadRegexRules\(\);[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.match(settingsRegexComposableSource, /function onRegexDragStart\(event, ruleId\) {\s*if \(regexControlsBusy\.value\) {[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*const currentRule = getCurrentRegexRule\(ruleId\);[\s\S]*if \(!currentRule\) {[\s\S]*callEventMethod\(event, 'preventDefault'\);[\s\S]*draggingRegexRuleId\.value = currentRule\.id;/);
  assert.match(
    settingsRegexComposableSource,
    /function onRegexDragOver\(event, ruleId\) {\s*if \(regexControlsBusy\.value\) return;\s*if \(!getCurrentRegexRule\(ruleId\)\) return;\s*callEventMethod\(event, 'preventDefault'\);/
  );
  assert.match(
    settingsRegexComposableSource,
    /async function onRegexDrop\(targetRuleId\) {[\s\S]*const currentDraggedRule = getCurrentRegexRule\(draggingRegexRuleId\.value\);[\s\S]*const currentTargetRule = getCurrentRegexRule\(targetRuleId\);[\s\S]*if \(!currentDraggedRule \|\| !currentTargetRule \|\| currentDraggedRule\.id === currentTargetRule\.id\)[\s\S]*const moveResult = moveListItemToTargetIndexById\(regexRules, currentDraggedRule\.id, currentTargetRule\.id\);[\s\S]*await reorderRegexRules\(moveResult\.ids, groupFilter\);[\s\S]*setListIfChanged\(regexRules, moveResult\.previousList\);[\s\S]*finally {\s*finishRegexMutation\(mutationToken\);/
  );
  assert.doesNotMatch(settingsRegexComposableSource, /reorderRegexRules\(items\.map/);
  assert.doesNotMatch(settingsRegexComposableSource, /const fromIndex = items\.findIndex/);
  assert.match(settingsRegexComposableSource, /async function exportRegexRules\(\) {\s*if \(regexControlsBusy\.value\) return;/);
  assert.match(settingsRegexComposableSource, /const envelope = await exportEnvelope\('regex-rules'\);/);
  assert.match(settingsRegexComposableSource, /async function importRegexRules\(mutationToken = beginRegexMutation\('regex-import'\), groupFilter = regexGroupFilter\.value\)/);
  assert.match(settingsRegexComposableSource, /const result = await importEnvelope\('regex-rules', parsed\);/);
  assert.match(settingsRegexComposableSource, /if \(!file \|\| regexControlsBusy\.value\) return;/);
  assert.doesNotMatch(settingsRegexComposableSource, /importRegexRuleSet/);
  assert.doesNotMatch(settingsViewScript, /function (loadRegexRules|handleToggleRegexRule|onRegexDrop|exportRegexRules|handleRegexImportFile)\(/);
  assert.doesNotMatch(settingsViewScript, /const regexGroupOptions = ref/);
  assert.doesNotMatch(settingsViewScript, /fetchRegexRules\(groupFilter\)/);
  assert.doesNotMatch(settingsViewScript, /function isRegexToggleBusy\(id\)/);

  assert.match(
    settingsViewTemplate,
    /<SettingsRegexPanel[\s\S]*:controls-busy="regexControlsBusy"[\s\S]*:group-filter="regexGroupFilter"[\s\S]*:regex-rules="regexRules"[\s\S]*@drag-over="onRegexDragOver"[\s\S]*@drag-start="onRegexDragStart"[\s\S]*@drop="onRegexDrop"[\s\S]*@export="exportRegexRules"[\s\S]*@group-filter-change="handleRegexGroupFilterChange"[\s\S]*@import-file="handleRegexImportFile"[\s\S]*@load="loadRegexRules"[\s\S]*@toggle="handleToggleRegexRule"[\s\S]*@update-group-filter="updateRegexGroupFilter"/
  );
  assert.match(settingsRegexPanelTemplate, /<select[\s\S]*:value="groupFilter"[\s\S]*:disabled="controlsBusy"[\s\S]*@change="emit\('update-group-filter', readInputValue\(\$event\)\); emit\('group-filter-change'\)"/);
  assert.match(settingsRegexPanelTemplate, /:disabled="controlsBusy \|\| !regexRules\.length" @click="emit\('export'\)"/);
  assert.match(settingsRegexPanelTemplate, /<label class="ghost-button file-import-button" :class="\{ disabled: controlsBusy \}" :aria-busy="actionBusyId === 'regex-import'">[\s\S]*<input type="file" accept="\.json" :disabled="controlsBusy" @change="emit\('import-file', \$event\)" \/>/);
  assert.match(settingsRegexPanelTemplate, /:disabled="controlsBusy" @click="emit\('load'\)"/);
  assert.match(settingsRegexPanelTemplate, /:draggable="!controlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\) \|\| actionBusyId === 'regex-reorder'"/);
  assert.match(settingsRegexPanelTemplate, /@dragstart="emit\('drag-start', \$event, rule\.id\)"/);
  assert.match(settingsRegexPanelTemplate, /@dragover="emit\('drag-over', \$event, rule\.id\)"/);
  assert.match(settingsRegexPanelTemplate, /@drop="emit\('drop', rule\.id\)"/);
  assert.match(settingsRegexPanelScript, /function isRegexToggleBusy\(id\) {\s*return props\.actionBusyId === regexToggleActionId\(id\);\s*}/);
  assert.match(settingsRegexPanelTemplate, /:disabled="controlsBusy"[\s\S]*:aria-busy="isRegexToggleBusy\(rule\.id\)"[\s\S]*@click="emit\('toggle', rule\.id\)"/);
});
