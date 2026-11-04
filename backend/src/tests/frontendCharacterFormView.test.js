import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: characterFormViewScript,
  template: characterFormViewTemplate
} = readVueBlocks('frontend/src/views/CharacterFormView.vue');
const {
  script: characterAiDraftActionsScript,
  template: characterAiDraftActionsTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAiDraftActions.vue');
const {
  script: characterAiDraftPanelScript,
  template: characterAiDraftPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAiDraftPanel.vue');
const {
  script: characterAiDraftInputsScript,
  template: characterAiDraftInputsTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAiDraftInputs.vue');
const {
  script: characterAiProcessPanelScript,
  template: characterAiProcessPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAiProcessPanel.vue');
const {
  script: characterAiModSuggestionsScript,
  template: characterAiModSuggestionsTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAiModSuggestions.vue');
// The former CharacterAdvancedSettingsPanel accordion is now four flat panels,
// one per section. Assertions about author-side fields hold across the set.
const advancedPanelBlocks = [
  'CharacterAuthorSettingsPanel',
  'CharacterStatusBarPanel',
  'CharacterAccessorySkillsPanel',
  'CharacterCustomCodePanel'
].map((name) => readVueBlocks(`frontend/src/components/character/${name}.vue`));
const characterAdvancedSettingsPanelScript = advancedPanelBlocks.map((block) => block.script).join('\n');
const characterAdvancedSettingsPanelTemplate = advancedPanelBlocks.map((block) => block.template).join('\n');
const {
  script: characterBasicInfoPanelScript,
  template: characterBasicInfoPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterBasicInfoPanel.vue');
const {
  script: characterCreationWizardPanelScript,
  template: characterCreationWizardPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterCreationWizardPanel.vue');
const {
  script: characterEditorDesktopScript,
  template: characterEditorDesktopTemplate
} = readVueBlocks('frontend/src/components/character/CharacterEditorDesktop.vue');
const {
  script: characterEditorMobileScript,
  template: characterEditorMobileTemplate
} = readVueBlocks('frontend/src/components/character/CharacterEditorMobile.vue');
const {
  script: characterSectionOutletScript,
  template: characterSectionOutletTemplate
} = readVueBlocks('frontend/src/components/character/CharacterSectionOutlet.vue');
const {
  script: characterRegexPanelScript,
  template: characterRegexPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterRegexPanel.vue');
const {
  script: characterRenderPluginPanelScript,
  template: characterRenderPluginPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterRenderPluginPanel.vue');
const {
  script: characterSettingsPanelScript,
  template: characterSettingsPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterSettingsPanel.vue');
const {
  script: characterWorldBookDialogScript,
  template: characterWorldBookDialogTemplate
} = readVueBlocks('frontend/src/components/character/CharacterWorldBookDialog.vue');
const {
  script: characterStatusBlueprintEditorScript,
  template: characterStatusBlueprintEditorTemplate
} = readVueBlocks('frontend/src/components/character/CharacterStatusBlueprintEditor.vue');
const {
  script: characterStatusPreviewDialogScript,
  template: characterStatusPreviewDialogTemplate
} = readVueBlocks('frontend/src/components/character/CharacterStatusPreviewDialog.vue');
const {
  script: characterTalentPanelScript,
  template: characterTalentPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterTalentPanel.vue');
const aiSectionLabelsSource = readRepoText('frontend/src/utils/aiSectionLabels.js');
const assistantRuntimePreferencesSource = readRepoText('frontend/src/composables/useAssistantRuntimePreferences.js');
const characterAiPreferencesSource = readRepoText('frontend/src/composables/character/useCharacterAiPreferences.js');
const characterAiGenerationSource = readRepoText('frontend/src/composables/character/useCharacterAiGeneration.js');
const characterCreationWizardSource = readRepoText('frontend/src/composables/character/useCharacterCreationWizard.js');
const characterFormDraftSource = readRepoText('frontend/src/composables/character/useCharacterFormDraft.js');
const characterFormOptionsSource = readRepoText('frontend/src/composables/character/useCharacterFormOptions.js');
const characterFormPayloadSource = readRepoText('frontend/src/composables/character/useCharacterFormPayload.js');
const characterImageUploadsSource = readRepoText('frontend/src/composables/character/useCharacterImageUploads.js');
const characterRegexRulesSource = readRepoText('frontend/src/composables/character/useCharacterRegexRules.js');
const characterRenderPluginsSource = readRepoText('frontend/src/composables/character/useCharacterRenderPlugins.js');
const characterStatusBlueprintSource = readRepoText('frontend/src/composables/character/useCharacterStatusBlueprint.js');
const characterSectionsSource = readRepoText('frontend/src/composables/character/useCharacterSections.js');
const characterEditorSource = readRepoText('frontend/src/composables/character/useCharacterEditor.js');
const characterWorldBookSelectionSource = readRepoText('frontend/src/composables/character/useCharacterWorldBookDialog.js');
const listReferencesSource = readRepoText('frontend/src/utils/listReferences.js');
// The editor is split into a shell view, a state composable and two layout
// shells. These aggregates let the behavioural assertions below stay focused on
// "the character editor" rather than on which file a line currently lives in.
const characterFormScript = [
  characterFormViewScript,
  characterEditorSource,
  characterSectionOutletScript,
  characterEditorDesktopScript,
  characterEditorMobileScript
].join('\n');
const characterFormTemplate = [
  characterFormViewTemplate,
  characterEditorDesktopTemplate,
  characterEditorMobileTemplate,
  characterSectionOutletTemplate
].join('\n');
const stylesSource = readFrontendStyles();

test('CharacterFormView opens a separate assistant through its shared busy state', () => {
  assert.match(characterAiGenerationSource, /const characterAiActionBusy = computed/);
  assert.match(characterAiGenerationSource, /async function runCharacterAi[\s\S]*if \(characterAiActionBusy\.value\) return;/);
  assert.match(characterAiGenerationSource, /isConversationMode\(\) && !aiSessionId\.value/);
  assert.match(characterSectionOutletTemplate, /@click="editor\.openAssistant"/);
  assert.doesNotMatch(characterSectionOutletTemplate, /<CharacterAiDraftPanel/);
  assert.match(characterFormViewTemplate, /@click="editor\.openAssistant"/);
  assert.match(characterFormViewTemplate, /<CharacterCardPreviewDialog/);
  assert.match(characterAiPreferencesSource, /useAssistantRuntimePreferences/);
});

test('CharacterFormView action rail shares one busy state', () => {
  assert.match(characterFormScript, /import \{ exportEnvelope \} from '\.\.\/(?:\.\.\/)?api\/envelopes\.js';/);
  assert.match(characterFormScript, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/(?:\.\.\/)?utils\/downloadJson\.js';/);
  assert.doesNotMatch(characterFormScript, /exportCharacter/);
  assert.match(
    characterFormScript,
    /const characterFooterActionBusy = computed\(\(\) => saving\.value \|\| deleting\.value \|\| exporting\.value\);/
  );
  assert.match(
    characterFormScript,
    /async function submit\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !canEdit\.value[\s\S]*?\|\| loading\.value \|\| loadError\.value[\s\S]*?aiWorldBookCreating\.value/
  );
  assert.match(
    characterFormScript,
    /async function removeCharacter\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value \|\| !canEdit\.value\)/
  );
  assert.match(
    characterFormScript,
    /async function handleExport\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !isEditing\.value\)/
  );
  assert.match(
    characterFormScript,
    /const envelope = await exportEnvelope\('characters', \{ ids: \[characterId\] \}\);[\s\S]*downloadJsonFile\(envelope, characterEnvelopeFileName\(envelope\.items\[0\]\)\);/
  );
  assert.match(
    characterFormScript,
    /function characterEnvelopeFileName\(item = \{\}\) \{[\s\S]*return `flai-character-\$\{name\}-\$\{todayStamp\(\)\}\.json`;[\s\S]*}/
  );

  assert.match(characterFormTemplate, /class="character-studio-actions"/);
  assert.match(characterEditorDesktopTemplate, /:disabled="editor\.saving \|\| editor\.deleting \|\| editor\.exporting"/);
  assert.ok(countMatches(characterEditorDesktopTemplate, /:disabled="editor\.saving \|\| editor\.deleting \|\| editor\.exporting"/g) >= 4);
  assert.match(characterEditorDesktopTemplate, /class="primary-button character-primary-action"[\s\S]*type="submit"[\s\S]*保存角色/);
  assert.match(characterEditorDesktopTemplate, /@click="editor\.handleExport"/);
  assert.match(characterEditorDesktopTemplate, /@click="editor\.removeCharacter"/);
  assert.match(characterEditorMobileScript, /const actionBusy = computed\(\(\) => editor\.saving \|\| editor\.deleting \|\| editor\.exporting\);/);
  assert.match(characterEditorMobileTemplate, /:disabled="actionBusy"/);
});

test('CharacterFormView autosaves editable drafts through one server session path', () => {
  assert.match(characterFormScript, /readDraft: readManualCharacterDraft/);
  assert.match(characterFormScript, /writeDraft: writeManualCharacterDraft/);
  assert.match(characterFormScript, /persistenceEnabled: \(\) => !isAssistantPage\.value/);
  assert.match(characterFormScript, /await initializeCharacterDraftState\(\)/);
  assert.match(characterFormScript, /await saveCharacterDraftNow\(\)/);
  assert.match(characterFormScript, /clearLegacyCharacterDraftStorage\(\)/);
  assert.match(characterFormScript, /resetCharacterAssistantDraftFromSavedCharacter\(current\.id\)/);
  assert.match(characterFormDraftSource, /saveQueue/);
  assert.match(characterFormDraftSource, /const saved = await writeDraft\(snapshot\)/);
  assert.match(characterFormDraftSource, /resetSnapshot = saved\?\.snapshot \|\| baseline/);
  assert.match(characterFormDraftSource, /draftEpoch/);
  assert.match(characterFormDraftSource, /CHARACTER_FORM_DRAFT_AUTOSAVE_MS = 30000/);
  assert.doesNotMatch(characterFormDraftSource, /localStorage|sessionStorage|CHARACTER_FORM_DRAFT_MAX_CHARS/);
  assert.doesNotMatch(characterFormScript, /localStorage\.setItem/);
});

test('CharacterFormView exposes compact draft recovery controls', () => {
  assert.match(
    characterFormTemplate,
    /class="character-draft-note"[\s\S]*:class="[\s\S]*pending: editor\.pendingCharacterDraft,[\s\S]*editor\.characterDraftStatus === 'error'[\s\S]*aria-live="polite"/
  );
  assert.match(characterFormTemplate, /@click="editor\.restoreCharacterDraft"/);
  assert.match(characterFormTemplate, /@click="editor\.discardCharacterDraft"/);
  assert.match(
    characterFormDraftSource,
    /function restoreCharacterDraft\(\) \{[\s\S]*applyPayload\(draft\.payload\);[\s\S]*setSelectedWorldBookIds\(draft\.selectedWorldBookIds\);[\s\S]*pendingCharacterDraft\.value = null;[\s\S]*characterDraftStatus\.value = 'restored';[\s\S]*scheduleCharacterDraftSave\(\);/
  );
  assert.match(characterFormDraftSource, /function discardCharacterDraft\(\)/);
  assert.match(
    characterFormScript,
    /function applyCharacterDraftPayload\(payload = \{\}\) \{[\s\S]*form\.name = normalized\.name;[\s\S]*form\.authorAdvancedSettings = normalized\.authorAdvancedSettings;[\s\S]*form\.selectedTags = \[\.\.\.normalized\.tags\];/
  );

  assert.match(
    stylesSource,
    /\.character-draft-note\s*\{[\s\S]*display:\s*flex;[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--green\) 28%, var\(--line\)\);/
  );
  assert.match(
    stylesSource,
    /\.character-draft-note\.pending\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--primary-soft\) 56%, var\(--surface\)\);/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 768px\) \{[\s\S]*\.character-draft-note\s*\{[\s\S]*flex-direction:\s*column;/
  );
});

test('CharacterFormView offers a scoped new-character creation wizard', () => {
  assert.match(characterFormScript, /import \{ useCharacterCreationWizard \} from '[^']*useCharacterCreationWizard';/);
  assert.match(characterFormScript, /import \{ configuredSectionStatus, countedSectionStatus, useCharacterSections \} from '[^']*useCharacterSections';/);
  assert.match(characterCreationWizardSource, /const characterCreationMode = ref\('wizard'\);/);
  assert.match(characterCreationWizardSource, /const characterWizardStepId = ref\('basic'\);/);
  assert.match(characterCreationWizardSource, /const isCharacterCreationWizardAvailable = computed\(\(\) => !isEditing\?\.value && canEdit\?\.value\);/);
  assert.match(characterCreationWizardSource, /id: 'settings'[\s\S]*sections: \['settings', 'ai'\][\s\S]*id: 'advanced'[\s\S]*'custom-code', 'render-plugins', 'regex'/);
  assert.match(characterCreationWizardSource, /function isCharacterSectionVisibleInCurrentMode\(sectionId\)/);
  assert.match(characterCreationWizardSource, /function setCharacterWizardStep\(stepId\)/);
  assert.doesNotMatch(characterCreationWizardSource, /skipCharacterWizardStep/);
  assert.match(characterFormScript, /useCharacterCreationWizard\(\{[\s\S]*isEditing,[\s\S]*canEdit,[\s\S]*setActiveSection: forceActiveSection/);
  assert.match(characterFormScript, /useCharacterSections\(\{[\s\S]*sections: formSections,[\s\S]*groups: CHARACTER_SECTION_GROUPS/);
  assert.match(characterFormTemplate, /<CharacterCreationWizardPanel[\s\S]*v-if="editor\.isCharacterCreationWizardAvailable"[\s\S]*:active="editor\.isCharacterCreationWizardActive"[\s\S]*:current-step="editor\.currentCharacterWizardStep"[\s\S]*:steps="editor\.CHARACTER_CREATION_WIZARD_STEPS"[\s\S]*@set-mode="editor\.setCharacterCreationMode"[\s\S]*@set-step="editor\.setCharacterWizardStep"/);
  assert.match(characterCreationWizardPanelScript, /const emit = defineEmits\(\['set-mode', 'set-step'\]\);/);
  assert.match(characterCreationWizardPanelTemplate, /class="character-wizard-panel"/);
  assert.match(characterCreationWizardPanelTemplate, /role="tablist" aria-label="角色创建向导步骤"/);
  assert.match(characterCreationWizardPanelTemplate, /v-for="\(step, index\) in steps"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('set-mode', 'full'\)"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('set-step', step\.id\)"/);
  assert.match(characterEditorDesktopTemplate, /<CharacterCreationWizardPanel[\s\S]*editor\.isCharacterCreationWizardAvailable/);
  assert.match(characterEditorMobileTemplate, /class="character-mobile-wizard"/);
  assert.match(stylesSource, /\.character-wizard-panel\s*\{/);
  assert.match(stylesSource, /\.character-mobile-wizard\s*\{/);
});

test('CharacterFormView load error state offers creation and navigation exits', () => {
  assert.match(
    characterFormTemplate,
    /<section v-else-if="editor\.loadError" class="form-panel empty-state error-state" role="alert">[\s\S]*@click="editor\.loadEditingCharacter"[\s\S]*@click="emit\('navigate', 'characterNew'\)"[\s\S]*创建新角色[\s\S]*@click="editor\.navigateHome"[\s\S]*返回首页/
  );
});

test('CharacterFormView completes saving and invalidates route-replacing action tokens before navigation', () => {
  assert.match(
    characterFormScript,
    /function navigateFromCharacterSubmit\(page, params\) \{[\s\S]*?saving\.value = false;\s*formSubmitToken \+= 1;\s*emit\('navigate', page, params\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /if \(editing\) \{\s*emit\('navigate', 'characterEdit', \{ id: saved\.id \}\);\s*\} else \{\s*navigateFromCharacterSubmit\('characterEdit', \{ id: saved\.id \}\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /function navigateFromCharacterDelete\(page, params\) \{\s*characterDeleteToken \+= 1;\s*emit\('navigate', page, params\);\s*\}/
  );
  assert.match(
    characterFormScript,
    /await deleteCharacter\(characterId\);[\s\S]*?if \(!isCurrentCharacterDelete\(deleteToken, characterId\)\) return;[\s\S]*?navigateFromCharacterDelete\('home'\);/
  );
});

test('CharacterFormView tag creation freezes tag controls while pending', () => {
  assert.match(characterFormScript, /import \{ useCharacterFormOptions \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterFormOptions';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*canCreateSearchedTag,[\s\S]*cancelCharacterFormOptions,[\s\S]*createAndSelectTag,[\s\S]*filteredTags,[\s\S]*loadFormOptions,[\s\S]*normalizeWorldBookIds,[\s\S]*optionsLoadError,[\s\S]*optionsLoading,[\s\S]*selectedWorldBookIds,[\s\S]*setSelectedWorldBookIdsFromBooksIfChanged,[\s\S]*setSelectedWorldBookIdsIfChanged,[\s\S]*tagCreating,[\s\S]*tagSearch,[\s\S]*toggleTagSelection,[\s\S]*toggleWorldBook,[\s\S]*worldBooks[\s\S]*\} = useCharacterFormOptions\(\{[\s\S]*canEdit,[\s\S]*isDisposed: \(\) => characterFormDisposed,[\s\S]*notify,[\s\S]*selectedTags: computed\(\(\) => form\.selectedTags\)[\s\S]*\}\);/
  );
  assert.match(characterFormScript, /cancelCharacterFormOptions\(\);/);
  assert.match(characterFormOptionsSource, /const tagCreating = ref\(false\);/);
  assert.match(
    characterFormOptionsSource,
    /function cancelCharacterFormOptions\(\) \{[\s\S]*formOptionsLoadToken \+= 1;[\s\S]*tagCreateToken \+= 1;[\s\S]*tagCreating\.value = false;[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /async function createAndSelectTag\(\)\s*{\s*if \(isDisposed\(\) \|\| tagCreating\.value \|\| !canEdit\?\.value\) return;/
  );
  assert.match(
    characterFormOptionsSource,
    /const createToken = \+\+tagCreateToken;\s*tagCreating\.value = true;/
  );
  assert.match(
    characterFormOptionsSource,
    /finally {\s*if \(isActiveTagCreate\(createToken\)\) {\s*tagCreating\.value = false;/
  );
  assert.match(
    characterFormOptionsSource,
    /function isCurrentTagCreate\(createToken, name\) {\s*return isActiveTagCreate\(createToken\)[\s\S]*tagSearch\.value\.trim\(\) === name;/
  );
  assert.match(
    characterFormOptionsSource,
    /function isActiveTagCreate\(createToken\) {\s*return !isDisposed\(\) && createToken === tagCreateToken;/
  );
  assert.match(
    characterFormOptionsSource,
    /function toggleTagSelection\(name\) {\s*if \(!canEdit\?\.value \|\| tagCreating\.value\) {\s*return;/
  );
  assert.doesNotMatch(characterFormScript, /async function createAndSelectTag/);
  assert.doesNotMatch(characterFormScript, /function toggleTagSelection/);

  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:tag-creating="editor\.tagCreating"[\s\S]*@toggle-tag="editor\.toggleTagSelection"/);
  assert.match(characterBasicInfoPanelTemplate, /<div class="tag-selector" :class="\{ disabled: !canEdit \|\| tagCreating \}">/);
  assert.match(characterBasicInfoPanelTemplate, /@click="canEdit && !tagCreating && emit\('toggle-tag', tagName\)"/);
  assert.match(characterBasicInfoPanelTemplate, /<span v-if="canEdit && !tagCreating" class="tag-remove">/);
  assert.match(
    characterBasicInfoPanelTemplate,
    /class="tag-search-input"[\s\S]*aria-label="搜索或创建角色标签"[\s\S]*:disabled="tagCreating"[\s\S]*:aria-busy="tagCreating"/
  );
  assert.match(
    characterBasicInfoPanelTemplate,
    /class="ghost-button tag-create-btn"[\s\S]*:disabled="tagCreating"[\s\S]*:aria-busy="tagCreating"[\s\S]*{{ tagCreating \? '创建中\.\.\.' : '创建' }}/
  );
  assert.match(
    characterBasicInfoPanelTemplate,
    /class="tag-option"[\s\S]*:disabled="tagCreating"[\s\S]*@click="emit\('toggle-tag', tag\.name\)"/
  );
});

test('CharacterFormView validates image uploads before invalidating upload tokens', () => {
  assert.match(characterFormScript, /import \{ useCharacterImageUploads \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterImageUploads';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*backgroundUploading,[\s\S]*cancelCharacterImageUploads,[\s\S]*clearAdvancedBackground,[\s\S]*clearAvatar,[\s\S]*handleAdvancedBackground,[\s\S]*handleAvatar[\s\S]*\} = useCharacterImageUploads\(\{[\s\S]*canEdit,[\s\S]*form,[\s\S]*isDisposed: \(\) => characterFormDisposed,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(characterFormScript, /cancelCharacterImageUploads\(\);/);

  const avatarStart = characterImageUploadsSource.indexOf('async function handleAvatar(event) {');
  const avatarEnd = characterImageUploadsSource.indexOf('\n  function isCurrentAvatarUpload', avatarStart);
  const avatarHandler = characterImageUploadsSource.slice(avatarStart, avatarEnd);
  const backgroundStart = characterImageUploadsSource.indexOf('async function handleAdvancedBackground(event, field) {');
  const backgroundEnd = characterImageUploadsSource.indexOf('\n  function clearAdvancedBackground', backgroundStart);
  const backgroundHandler = characterImageUploadsSource.slice(backgroundStart, backgroundEnd);

  assert.match(
    avatarHandler,
    /if \(!file\) \{\s*return;\s*\}[\s\S]*if \(!\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes\(file\.type\)\) \{[\s\S]*return;\s*\}[\s\S]*if \(file\.size > 2 \* 1024 \* 1024\) \{[\s\S]*return;\s*\}\s*const uploadToken = \+\+avatarUploadToken;\s*try \{/
  );
  assert.doesNotMatch(
    avatarHandler,
    /const uploadToken = \+\+avatarUploadToken;\s*if \(!file\)/
  );
  assert.match(
    avatarHandler,
    /const validatedResult = await validateImageDataUrl\([\s\S]*头像图片数据无效[\s\S]*form\.avatarUrl = validatedResult;/
  );
  assert.match(
    characterImageUploadsSource,
    /function clearAvatar\(\) \{[\s\S]*avatarUploadToken \+= 1;[\s\S]*form\.avatarUrl = '';[\s\S]*\}/
  );

  assert.match(
    backgroundHandler,
    /if \(!file\) \{\s*return;\s*\}[\s\S]*if \(!\['image\/png', 'image\/jpeg', 'image\/webp', 'image\/gif'\]\.includes\(file\.type\)\) \{[\s\S]*return;\s*\}[\s\S]*if \(file\.size > 4 \* 1024 \* 1024\) \{[\s\S]*return;\s*\}\s*backgroundUploading\[field\] = true;\s*const uploadToken = nextBackgroundUploadToken\(field\);\s*try \{/
  );
  assert.doesNotMatch(
    backgroundHandler,
    /const uploadToken = nextBackgroundUploadToken\(field\);\s*if \(!file\)/
  );
  assert.doesNotMatch(
    backgroundHandler,
    /if \(!file\) \{\s*backgroundUploading\[field\] = false;/
  );
  assert.doesNotMatch(characterFormScript, /async function handleAvatar/);
  assert.doesNotMatch(characterFormScript, /async function handleAdvancedBackground/);
});

test('CharacterFormView preserves unchanged option-list references during loads', () => {
  assert.match(
    characterFormOptionsSource,
    /const \[nextWorldBooks, nextTags\] = await Promise\.all\(\[fetchWorldBooks\(\), fetchTags\(\)\]\);[\s\S]*setWorldBooksIfChanged\(nextWorldBooks\);[\s\S]*setAvailableTagsIfChanged\(nextTags\);/
  );
  assert.match(
    characterFormScript,
    /setSelectedWorldBookIdsFromBooksIfChanged\(linkedBooks\);/
  );
  assert.match(
    characterFormOptionsSource,
    /const tag = await createTag\(\{ name \}\);[\s\S]*if \(!isCurrentTagCreate\(createToken, name\)\) return;[\s\S]*appendAvailableTagIfMissing\(tag\);/
  );
  assert.match(
    characterFormOptionsSource,
    /function appendAvailableTagIfMissing\(tag\) \{[\s\S]*if \(!tag\?\.name\) \{[\s\S]*return false;[\s\S]*const currentTags = Array\.isArray\(availableTags\.value\) \? availableTags\.value : \[\];[\s\S]*const nextTags = \[\];[\s\S]*let tagExists = false;[\s\S]*for \(const currentTag of currentTags\) \{[\s\S]*currentTag\?\.name === tag\?\.name[\s\S]*tagExists = true;[\s\S]*nextTags\.push\(currentTag\);[\s\S]*if \(tagExists\) \{[\s\S]*return false;[\s\S]*nextTags\.push\(tag\);[\s\S]*return setAvailableTagsIfChanged\(nextTags\);[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.some\(/);
  assert.doesNotMatch(characterFormScript, /setAvailableTagsIfChanged\(\[\.\.\.availableTags\.value, tag\]\);/);
  assert.match(
    characterFormOptionsSource,
    /function setWorldBooksIfChanged\(nextBooks\) \{[\s\S]*sameListItems\(worldBooks\.value, normalizedBooks, sameWorldBookOption\)[\s\S]*worldBooks\.value = normalizedBooks;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function setAvailableTagsIfChanged\(nextTags\) \{[\s\S]*sameListItems\(availableTags\.value, normalizedTags, sameTagOption\)[\s\S]*availableTags\.value = normalizedTags;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function normalizeWorldBookIds\(nextIds\) \{[\s\S]*const normalizedIds = \[\];[\s\S]*for \(const id of Array\.isArray\(nextIds\) \? nextIds : \[\]\) \{[\s\S]*normalizedIds\.push\(String\(id \|\| ''\)\);[\s\S]*return normalizedIds;[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function setSelectedWorldBookIdsFromBooksIfChanged\(nextBooks\) \{[\s\S]*const nextIds = \[\];[\s\S]*for \(const book of Array\.isArray\(nextBooks\) \? nextBooks : \[\]\) \{[\s\S]*nextIds\.push\(book\?\.id\);[\s\S]*return setSelectedWorldBookIdsIfChanged\(nextIds\);[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function setSelectedWorldBookIdsIfChanged\(nextIds\) \{[\s\S]*const normalizedIds = normalizeWorldBookIds\(nextIds\);[\s\S]*sameListItems\(selectedWorldBookIds\.value, normalizedIds, Object\.is\)[\s\S]*selectedWorldBookIds\.value = normalizedIds;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    listReferencesSource,
    /function sameListItems\(currentItems, nextItems, sameItem = Object\.is\) \{[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*sameItem\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function toggleWorldBook\(bookId\) \{[\s\S]*const normalizedId = String\(bookId \|\| ''\);[\s\S]*if \(!normalizedId\) \{[\s\S]*return;[\s\S]*\}[\s\S]*const currentIds = selectedWorldBookIds\.value;[\s\S]*const nextIds = \[\];[\s\S]*let removedSelectedId = false;[\s\S]*for \(const id of currentIds\) \{[\s\S]*if \(id === normalizedId\) \{[\s\S]*removedSelectedId = true;[\s\S]*continue;[\s\S]*\}[\s\S]*nextIds\.push\(id\);[\s\S]*if \(!removedSelectedId\) \{[\s\S]*nextIds\.push\(normalizedId\);[\s\S]*\}[\s\S]*setSelectedWorldBookIdsIfChanged\(nextIds\);[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function sameWorldBookOption\(current = \{\}, next = \{\}\) \{[\s\S]*String\(current\?\.id \|\| ''\) === String\(next\?\.id \|\| ''\)[\s\S]*Number\(current\?\.entryCount \|\| 0\) === Number\(next\?\.entryCount \|\| 0\);[\s\S]*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function sameTagOption\(current = \{\}, next = \{\}\) \{[\s\S]*String\(current\?\.name \|\| ''\) === String\(next\?\.name \|\| ''\)[\s\S]*Number\(current\?\.usageCount \|\| 0\) === Number\(next\?\.usageCount \|\| 0\);[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /function setWorldBooksIfChanged/);
  assert.doesNotMatch(characterFormScript, /function setAvailableTagsIfChanged/);
  assert.doesNotMatch(characterFormScript, /function toggleWorldBook/);
  assert.doesNotMatch(characterFormScript, /worldBooks\.value\s*=\s*nextWorldBooks/);
  assert.doesNotMatch(characterFormScript, /availableTags\.value\s*=\s*nextTags/);
  assert.doesNotMatch(characterFormScript, /selectedWorldBookIds\.value\s*=\s*linkedBooks\.map/);
  assert.doesNotMatch(characterFormScript, /linkedBooks\.map\(\(book\) => book\.id\)/);
  assert.doesNotMatch(characterFormScript, /currentLinked\.map\(\(book\) => book\.id\)/);
  assert.doesNotMatch(characterFormScript, /currentIds\.filter\(\(id\) => id !== normalizedId\)/);
  assert.doesNotMatch(characterFormScript, /selectedWorldBookIds\.value\.(?:push|splice)\(/);
});

test('CharacterFormView uses a searchable paged dialog for world book linking', () => {
  assert.match(characterFormScript, /import \{ useCharacterWorldBookDialog \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterWorldBookDialog';/);
  assert.match(characterWorldBookSelectionSource, /const showWorldBookDialog = ref\(false\);/);
  assert.match(characterWorldBookSelectionSource, /const worldBookSearch = ref\(''\);/);
  assert.match(characterWorldBookSelectionSource, /const worldBookSort = ref\('updatedDesc'\);/);
  assert.match(characterWorldBookSelectionSource, /const worldBookPage = ref\(1\);/);
  assert.match(characterWorldBookSelectionSource, /export const WORLD_BOOK_SELECTOR_PAGE_SIZE = 8;/);
  assert.match(characterFormScript, /import CharacterWorldBookDialog from '\.\.\/components\/character\/CharacterWorldBookDialog\.vue';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*clearWorldBookSearch,[\s\S]*closeWorldBookDialog,[\s\S]*filteredWorldBooks,[\s\S]*openWorldBookDialog,[\s\S]*pagedWorldBooks,[\s\S]*selectedWorldBookPreview,[\s\S]*setWorldBookPage,[\s\S]*showWorldBookDialog,[\s\S]*worldBookPage,[\s\S]*worldBookSort[\s\S]*\} = useCharacterWorldBookDialog\(\{[\s\S]*worldBooks,[\s\S]*selectedWorldBookIds[\s\S]*\}\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /const selectedWorldBooks = computed\(\(\) => getSelectedWorldBooks\(worldBooks\?\.value, selectedWorldBookIds\?\.value\)\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /const filteredWorldBooks = computed\(\(\) => filterAndSortWorldBooks\(worldBooks\?\.value, worldBookSearch\.value, worldBookSort\.value\)\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /const pagedWorldBooks = computed\(\(\) => getWorldBookPageItems\(filteredWorldBooks\.value, worldBookPage\.value, WORLD_BOOK_SELECTOR_PAGE_SIZE\)\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /watch\(\[worldBookSearch, worldBookSort\], \(\) => \{\s*setWorldBookPage\(1\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /function filterAndSortWorldBooks\(books, rawSearch, sortKey\) \{[\s\S]*haystack\.includes\(search\)[\s\S]*return sortWorldBooks\(matches, sortKey\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /function sortWorldBooks\(books, sortKey\) \{[\s\S]*sortKey === 'nameAsc'[\s\S]*sortKey === 'entryCountDesc'[\s\S]*getWorldBookSortTime\(next\) - getWorldBookSortTime\(current\)/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /function getWorldBookPageItems\(books, page, pageSize\) \{[\s\S]*return currentBooks\.slice\(start, start \+ safePageSize\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /function openWorldBookDialog\(\) \{[\s\S]*showWorldBookDialog\.value = true;[\s\S]*setWorldBookPage\(worldBookPage\.value\);/
  );
  assert.match(
    characterWorldBookSelectionSource,
    /function setWorldBookPage\(page\) \{[\s\S]*clampWorldBookPage\(page, worldBookPageCount\.value\)[\s\S]*worldBookPage\.value = nextPage;/
  );
  assert.doesNotMatch(characterFormScript, /function getSelectedWorldBooks/);
  assert.doesNotMatch(characterFormScript, /function filterAndSortWorldBooks/);
  assert.doesNotMatch(characterFormScript, /function sortWorldBooks/);
  assert.doesNotMatch(characterFormScript, /function getWorldBookPageItems/);
  assert.doesNotMatch(characterFormScript, /function openWorldBookDialog/);
  assert.doesNotMatch(characterFormScript, /function setWorldBookPage/);

  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:selected-world-book-ids="editor\.selectedWorldBookIds"[\s\S]*:selected-world-book-preview="editor\.selectedWorldBookPreview"[\s\S]*@open-world-book-dialog="editor\.openWorldBookDialog"[\s\S]*@toggle-world-book="editor\.toggleWorldBook"/);
  assert.match(characterBasicInfoPanelTemplate, /class="field full-span world-book-field"/);
  assert.match(characterBasicInfoPanelTemplate, /class="world-book-picker-button"[\s\S]*@click="emit\('open-world-book-dialog'\)"/);
  assert.match(characterBasicInfoPanelTemplate, /class="world-book-selected-preview"/);
  assert.match(characterFormTemplate, /<CharacterWorldBookDialog[\s\S]*v-if="editor\.showWorldBookDialog"[\s\S]*v-model:search="editor\.worldBookSearch"[\s\S]*v-model:sort="editor\.worldBookSort"/);
  assert.match(characterFormTemplate, /:paged-world-books="editor\.pagedWorldBooks"[\s\S]*:filtered-world-books="editor\.filteredWorldBooks"[\s\S]*:selected-world-book-ids="editor\.selectedWorldBookIds"/);
  assert.match(characterFormTemplate, /@clear-search="editor\.clearWorldBookSearch"[\s\S]*@close="editor\.closeWorldBookDialog"[\s\S]*@page="editor\.setWorldBookPage"[\s\S]*@toggle="editor\.toggleWorldBook"/);
  assert.doesNotMatch(characterFormTemplate, /class="world-book-dialog-overlay"/);
  assert.doesNotMatch(characterFormTemplate, /class="world-book-selector"/);

  assert.match(characterWorldBookDialogScript, /const WORLD_BOOK_SORT_OPTIONS = \[[\s\S]*updatedDesc[\s\S]*nameAsc[\s\S]*entryCountDesc[\s\S]*\];/);
  assert.match(characterWorldBookDialogScript, /function isWorldBookSelected\(bookId\) \{[\s\S]*for \(const id of props\.selectedWorldBookIds\) \{[\s\S]*if \(id === bookId\)/);
  assert.match(characterWorldBookDialogTemplate, /class="world-book-dialog-overlay"[\s\S]*@click\.self="emit\('close'\)"/);
  assert.match(characterWorldBookDialogTemplate, /class="world-book-dialog form-panel"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(characterWorldBookDialogTemplate, /v-model="searchModel"[\s\S]*type="search"/);
  assert.match(characterWorldBookDialogTemplate, /v-model="sortModel"[\s\S]*v-for="option in WORLD_BOOK_SORT_OPTIONS"/);
  assert.match(characterWorldBookDialogTemplate, /v-for="book in pagedWorldBooks"/);
  assert.match(characterWorldBookDialogTemplate, /@change="emit\('toggle', book\.id\)"/);
  assert.match(characterWorldBookDialogTemplate, /@click="emit\('page', worldBookPage - 1\)"/);
  assert.match(characterWorldBookDialogTemplate, /@click="emit\('page', worldBookPage \+ 1\)"/);

  assert.match(stylesSource, /\.world-book-picker\s*\{[\s\S]*border:\s*1px solid var\(--line\);[\s\S]*background:\s*color-mix\(in srgb, var\(--surface\) 78%, transparent\);/);
  assert.match(stylesSource, /\.world-book-dialog-tools\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 1fr\) minmax\(160px, 220px\) auto;/);
  assert.match(stylesSource, /\.world-book-dialog-list\s*\{[\s\S]*align-content:\s*start;[\s\S]*overflow:\s*auto;/);
  assert.match(stylesSource, /\.world-book-dialog-option\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto;[\s\S]*align-items:\s*start;/);
  assert.match(
    stylesSource,
    /@media \(max-width: 760px\) \{[\s\S]*\.world-book-dialog-option\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\);[\s\S]*grid-template-areas:[\s\S]*"check main"[\s\S]*"check meta";/
  );
  assert.match(stylesSource, /\.world-book-dialog-option-main\s*\{[\s\S]*grid-area:\s*main;/);
  assert.match(stylesSource, /\.world-book-dialog-meta\s*\{[\s\S]*grid-area:\s*meta;/);
});

test('CharacterFormView filters tag search results in one pass', () => {
  assert.match(
    characterFormScript,
    /tags: form\.selectedTags\.length \? form\.selectedTags : parseTagsTextForPayload\(form\.tagsText\)/
  );
  assert.match(
    characterFormPayloadSource,
    /export function parseTagsTextForPayload\(value = ''\) \{[\s\S]*const tags = \[\];[\s\S]*const source = String\(value \|\| ''\);[\s\S]*for \(let index = 0; index <= source\.length; index \+= 1\) \{[\s\S]*source\[index\] !== ','[\s\S]*const tag = source\.slice\(start, index\)\.trim\(\);[\s\S]*tags\.push\(tag\);[\s\S]*return tags;[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /function parseTagsTextForPayload/);
  assert.doesNotMatch(characterFormScript, /form\.tagsText\.split\(','\)\.map/);

  assert.match(
    characterFormOptionsSource,
    /const filteredTags = computed\(\(\) => filterTagsBySearch\(availableTags\.value, tagSearch\.value\)\);/
  );
  assert.match(
    characterFormOptionsSource,
    /const canCreateSearchedTag = computed\(\(\) => canCreateTagFromSearch\(availableTags\.value, tagSearch\.value\)\);/
  );
  assert.match(
    characterFormOptionsSource,
    /function filterTagsBySearch\(tags, rawSearch\) \{\s*const currentTags = Array\.isArray\(tags\) \? tags : \[\];\s*const search = String\(rawSearch \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*if \(!search\) \{\s*return currentTags;\s*\}[\s\S]*const matches = \[\];\s*for \(const tag of currentTags\) \{[\s\S]*matches\.push\(tag\);[\s\S]*\}\s*return matches;\s*\}/
  );
  assert.match(
    characterFormOptionsSource,
    /function canCreateTagFromSearch\(tags, rawSearch\) \{\s*const name = String\(rawSearch \|\| ''\)\.trim\(\);[\s\S]*if \(!name\) \{[\s\S]*return false;[\s\S]*for \(const tag of Array\.isArray\(tags\) \? tags : \[\]\) \{[\s\S]*if \(tag\?\.name === name\) \{[\s\S]*return false;[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:can-create-searched-tag="editor\.canCreateSearchedTag"/);
  assert.match(characterBasicInfoPanelTemplate, /v-if="canCreateSearchedTag"[\s\S]*class="ghost-button tag-create-btn"/);
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.filter\(/);
  assert.doesNotMatch(characterFormScript, /function filterTagsBySearch/);
  assert.doesNotMatch(characterFormScript, /function canCreateTagFromSearch/);
  assert.doesNotMatch(characterFormTemplate, /availableTags\.some\(/);
});

test('CharacterFormView counts status blueprint variable stats in one pass', () => {
  assert.match(characterFormScript, /import \{[\s\S]*hasStatusBarBlueprintContent,[\s\S]*normalizeStatusBarBlueprintForPayload,[\s\S]*useCharacterStatusBlueprint[\s\S]*\} from '\.{1,2}\/(?:composables\/character\/)?useCharacterStatusBlueprint';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*addStatusBlueprintVariable,[\s\S]*applyStatusBlueprintSampleTemplate,[\s\S]*clearStatusBlueprintTemplate,[\s\S]*refreshStatusBlueprintVariables,[\s\S]*removeStatusBlueprintVariable,[\s\S]*setColorValueFromEvent,[\s\S]*setStatusBlueprintVariableModeFromEvent,[\s\S]*setStatusBlueprintVariableValueFromEvent,[\s\S]*statusBarBlueprintPreview,[\s\S]*statusBarBlueprintPreviewConfig,[\s\S]*statusBarBlueprintTemplateStats,[\s\S]*statusBlueprintEditorRows[\s\S]*\} = useCharacterStatusBlueprint\(\{[\s\S]*canEdit,[\s\S]*form,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(
    characterStatusBlueprintSource,
    /const variableStats = countStatusBlueprintVariableStats\(normalized\.variables, template\);[\s\S]*inferred: variableStats\.inferred,[\s\S]*text: Math\.max\(0, normalized\.variables\.length - variableStats\.meter\),[\s\S]*meter: variableStats\.meter,/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function collectInferredStatusVariableKeys\(template = ''\) \{\s*const inferredKeys = new Set\(\);\s*for \(const variable of inferStatusVariablesFromTemplate\(template, \[\]\)\) \{\s*inferredKeys\.add\(normalizeStatusVariableKey\(variable\.name\)\);\s*\}\s*return inferredKeys;\s*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function countStatusBlueprintVariableStats\(variables = \[\], template = ''\) \{\s*const inferredKeys = collectInferredStatusVariableKeys\(template\);\s*const stats = \{ inferred: 0, meter: 0 \};\s*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*stats\.inferred \+= 1;[\s\S]*stats\.meter \+= 1;[\s\S]*\}\s*return stats;\s*\}/
  );
  assert.doesNotMatch(
    characterStatusBlueprintSource,
    /inferStatusVariablesFromTemplate\(template, \[\]\)\.map\(\(variable\) => normalizeStatusVariableKey\(variable\.name\)\)/
  );
  assert.doesNotMatch(characterStatusBlueprintSource, /normalized\.variables\.filter\(/);
});

test('CharacterFormView normalizes status blueprint variables with direct loops', () => {
  const normalizeStart = characterStatusBlueprintSource.indexOf('function normalizeStatusBarBlueprintForPayload(input = {}) {');
  const normalizeEnd = characterStatusBlueprintSource.indexOf('\nfunction normalizeStatusVariableForPayload', normalizeStart);
  const sameStart = characterStatusBlueprintSource.indexOf('function sameStatusVariableList(left = [], right = []) {');
  const sameEnd = characterStatusBlueprintSource.indexOf('\nfunction normalizeHtmlText', sameStart);
  assert.notEqual(normalizeStart, -1);
  assert.notEqual(normalizeEnd, -1);
  assert.notEqual(sameStart, -1);
  assert.notEqual(sameEnd, -1);
  const normalizeSnippet = characterStatusBlueprintSource.slice(normalizeStart, normalizeEnd);
  const sameSnippet = characterStatusBlueprintSource.slice(sameStart, sameEnd);

  assert.match(
    characterStatusBlueprintSource,
    /function syncStatusBlueprintVariablesFromTemplate\(\{ notifyUser = false \} = \{\}\) \{[\s\S]*const normalized = normalizeStatusBarBlueprintForPayload\(blueprint\);[\s\S]*const changed = !sameStatusVariableList\(blueprint\.variables, normalized\.variables\);[\s\S]*if \(changed\) \{[\s\S]*blueprint\.variables = cloneStatusVariableList\(normalized\.variables\);[\s\S]*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function normalizeStatusBarBlueprintForPayload\(input = \{\}\) \{[\s\S]*const variables = normalizeStatusVariableListForPayload\(source\.variables, template\);[\s\S]*variables: inferStatusVariablesFromTemplate\(template, variables\),/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function inferStatusVariablesFromTemplate\(template, variables = \[\]\) \{[\s\S]*const inferred = dedupeStatusVariables\(variables, template\);[\s\S]*const seen = collectStatusVariableKeys\(inferred\);/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function collectStatusVariableKeys\(variables = \[\]\) \{\s*const keys = new Set\(\);\s*for \(const item of Array\.isArray\(variables\) \? variables : \[\]\) \{\s*keys\.add\(normalizeStatusVariableKey\(item\?\.name\)\);\s*\}\s*return keys;\s*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function normalizeStatusVariableListForPayload\(variables = \[\], template = ''\) \{[\s\S]*const normalizedVariables = \[\];[\s\S]*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*const normalized = normalizeStatusVariableForPayload\(variable, template\);[\s\S]*normalizedVariables\.push\(normalized\);[\s\S]*return normalizedVariables;[\s\S]*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function sameStatusVariableList\(left = \[\], right = \[\]\) \{[\s\S]*const currentList = Array\.isArray\(left\) \? left : \[\];[\s\S]*const nextList = Array\.isArray\(right\) \? right : \[\];[\s\S]*for \(let index = 0; index < currentList\.length; index \+= 1\) \{[\s\S]*!sameStatusVariableForPayload\(currentList\[index\], nextList\[index\]\)[\s\S]*return true;[\s\S]*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function sameStatusVariableForPayload\(current, next\) \{[\s\S]*const currentVariable = normalizeStatusVariableForPayload\(current\);[\s\S]*const nextVariable = normalizeStatusVariableForPayload\(next\);[\s\S]*Object\.is\(currentVariable\.value, nextVariable\.value\)[\s\S]*String\(currentVariable\.color \|\| ''\) === String\(nextVariable\.color \|\| ''\);[\s\S]*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function cloneStatusVariableList\(variables = \[\]\) \{[\s\S]*const clonedVariables = \[\];[\s\S]*for \(const variable of Array\.isArray\(variables\) \? variables : \[\]\) \{[\s\S]*clonedVariables\.push\(\{ \.\.\.variable \}\);[\s\S]*return clonedVariables;[\s\S]*\}/
  );
  assert.doesNotMatch(normalizeSnippet, /\.map\(\(variable\) => normalizeStatusVariableForPayload/);
  assert.doesNotMatch(normalizeSnippet, /\.filter\(/);
  assert.doesNotMatch(sameSnippet, /\.every\(/);
  assert.doesNotMatch(sameSnippet, /JSON\.stringify/);
  assert.doesNotMatch(characterStatusBlueprintSource, /new Set\(inferred\.map/);
  assert.doesNotMatch(characterStatusBlueprintSource, /normalized\.variables\.map\(\(variable\) => \(\{ \.\.\.variable \}\)\)/);
  assert.doesNotMatch(characterFormScript, /function normalizeStatusBarBlueprintForPayload/);
});

test('CharacterFormView scans status blueprint variables directly by key', () => {
  assert.match(
    characterStatusBlueprintSource,
    /function findStatusBlueprintVariable\(name = ''\) \{\s*const key = normalizeStatusVariableKey\(name\);\s*if \(!key\) \{\s*return null;\s*\}[\s\S]*const variables = Array\.isArray\(blueprint\.variables\) \? blueprint\.variables : \[\];\s*for \(const variable of variables\) \{[\s\S]*if \(normalizeStatusVariableKey\(variable\?\.name\) === key\) \{[\s\S]*return variable;[\s\S]*\}\s*\}\s*return null;\s*\}/
  );
  assert.doesNotMatch(
    characterStatusBlueprintSource,
    /variables\.find\(\(variable\) => normalizeStatusVariableKey\(variable\?\.name\) === key\)/
  );
});

test('CharacterFormView reads status template references from the shared renderer', () => {
  const usageStart = characterStatusBlueprintSource.indexOf('function getStatusVariableTemplateUsage(template = \'\', name = \'\') {');
  const usageEnd = characterStatusBlueprintSource.indexOf('\nfunction isStatusMeterPlaceholderProperty', usageStart);
  const inferStart = characterStatusBlueprintSource.indexOf('function inferStatusVariablesFromTemplate(template, variables = []) {');
  const inferEnd = characterStatusBlueprintSource.indexOf('\nfunction collectStatusVariableKeys', inferStart);
  assert.notEqual(usageStart, -1);
  assert.notEqual(usageEnd, -1);
  assert.notEqual(inferStart, -1);
  assert.notEqual(inferEnd, -1);
  const usageSnippet = characterStatusBlueprintSource.slice(usageStart, usageEnd);
  const inferSnippet = characterStatusBlueprintSource.slice(inferStart, inferEnd);

  assert.match(
    characterStatusBlueprintSource,
    /import \{ collectStatusTemplateReferences \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/statusTemplateRenderer\.js';/
  );
  assert.match(usageSnippet, /for \(const reference of collectStatusTemplateReferences\(stripStatusBarTemplateCode\(template\)\)\) \{/);
  assert.match(usageSnippet, /normalizeStatusVariableKey\(reference\.rawName\) !== target/);
  assert.match(inferSnippet, /const markup = stripStatusBarTemplateCode\(template\);/);
  assert.match(inferSnippet, /for \(const reference of collectStatusTemplateReferences\(markup\)\) \{\s*const name = normalizeTemplateVariableName\(reference\.rawName\);/);
  assert.doesNotMatch(characterStatusBlueprintSource, /token\.split\('\.'\)/);
  assert.doesNotMatch(characterStatusBlueprintSource, /propertyParts/);
});

test('CharacterFormView builds status blueprint editor rows without intermediate mapping arrays', () => {
  assert.match(
    characterStatusBlueprintSource,
    /import \{[\s\S]*parseStatusTemplateToken[\s\S]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/statusTemplateTokens\.js';/
  );
  const extractPartsStart = characterStatusBlueprintSource.indexOf('function extractCompositePlaceholderParts(value = \'\', label = \'\') {');
  const extractPartsEnd = characterStatusBlueprintSource.indexOf('\nfunction isCompositeStatusPlaceholderValue', extractPartsStart);
  assert.notEqual(extractPartsStart, -1);
  assert.notEqual(extractPartsEnd, -1);
  const extractPartsSnippet = characterStatusBlueprintSource.slice(extractPartsStart, extractPartsEnd);
  assert.match(extractPartsSnippet, /const parsed = parseStatusTemplateToken\(token\);/);
  assert.match(extractPartsSnippet, /const rawProperty = parsed\.rawProperty\.trim\(\) \|\| 'value';/);
  assert.match(extractPartsSnippet, /const name = normalizeTemplateVariableName\(parsed\.rawName\.trim\(\)\);/);
  // Editor rows carry the resolved variable type so each row shows only the
  // fields that type actually has.
  assert.match(
    characterStatusBlueprintSource,
    /const type = resolveStatusBlueprintVariableType\(variable, template\);[\s\S]*isNumeric: type === 'meter' \|\| type === 'number',/
  );
  assert.doesNotMatch(extractPartsSnippet, /token\.split\('\.'\)\.map/);

  assert.match(
    characterStatusBlueprintSource,
    /const statusBlueprintEditorRows = computed\(\(\) => \{[\s\S]*const rows = \[\];\s*for \(let index = 0; index < compositeRows\.length; index \+= 1\) \{[\s\S]*let compositePartKey = '';[\s\S]*for \(let partIndex = 0; partIndex < row\.parts\.length; partIndex \+= 1\) \{[\s\S]*compositePartKey \+= `\$\{partIndex > 0 \? '\|' : ''\}\$\{part\?\.name \?\? ''\}`;[\s\S]*key: `composite:\$\{index\}:\$\{row\.label\}:\$\{compositePartKey\}`,[\s\S]*for \(let index = 0; index < variables\.length; index \+= 1\) \{[\s\S]*const variable = variables\[index\];[\s\S]*continue;[\s\S]*key: `variable:\$\{index\}:\$\{key\}`,/
  );
  assert.doesNotMatch(characterStatusBlueprintSource, /compositeRows\.map\(/);
  assert.doesNotMatch(characterStatusBlueprintSource, /row\.parts\.map\(/);
  assert.doesNotMatch(characterStatusBlueprintSource, /variables\.forEach\(/);
});

test('CharacterFormView status blueprint input handlers tolerate missing event targets', () => {
  assert.match(
    characterStatusBlueprintEditorScript,
    /const emit = defineEmits\(\[[\s\S]*'set-composite-value'[\s\S]*\]\);/
  );
  assert.match(
    characterStatusBlueprintEditorScript,
    /const emit = defineEmits\(\[[\s\S]*'set-variable-mode'[\s\S]*\]\);/
  );
  assert.match(
    characterStatusBlueprintEditorScript,
    /const emit = defineEmits\(\[[\s\S]*'set-color'[\s\S]*\]\);/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function readEventTargetValue\(event\) {\s*const target = event\?\.target;\s*return target && target\.value !== undefined \? target\.value : undefined;\s*}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function setStatusBlueprintVariableValueFromEvent\(name, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setStatusBlueprintVariableValue\(name, value\);\s*}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function setStatusBlueprintVariableModeFromEvent\(variable, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setStatusBlueprintVariableMode\(variable, value\);\s*}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function setColorValueFromEvent\(target, key, event\) {\s*const value = readEventTargetValue\(event\);\s*if \(value === undefined\) {\s*return;\s*}\s*setColorValue\(target, key, value\);\s*}/
  );
  assert.match(characterFormTemplate, /@set-composite-value="editor\.setStatusBlueprintVariableValueFromEvent"/);
  assert.match(characterFormTemplate, /@set-variable-mode="editor\.setStatusBlueprintVariableModeFromEvent"/);
  assert.match(characterFormTemplate, /@set-color="editor\.setColorValueFromEvent"/);
  assert.match(characterStatusBlueprintEditorTemplate, /@input="emit\('set-composite-value', part\.name, \$event\)"/);
  assert.match(characterStatusBlueprintEditorTemplate, /@change="emit\('set-variable-mode', row\.variable, \$event\)"/);
  assert.match(characterStatusBlueprintEditorTemplate, /@input="emit\('set-color', row\.variable, 'color', \$event\)"/);
  assert.doesNotMatch(characterFormTemplate, /\$event\.target\.value/);
  assert.doesNotMatch(characterStatusBlueprintEditorTemplate, /\$event\.target\.value/);
  assert.doesNotMatch(characterFormScript, /function readEventTargetValue/);
});

test('CharacterFormView normalizes accessory skill payloads with a direct defaults loop', () => {
  assert.match(
    characterFormScript,
    /import \{[\s\S]*emptyCharacter,[\s\S]*hasNonDefaultAccessorySkills,[\s\S]*normalizeAccessorySkillsForPayload,[\s\S]*normalizeAdvancedSettingsForForm,[\s\S]*normalizeCharacterDraftPayload,[\s\S]*normalizeForForm,[\s\S]*parseTagsTextForPayload[\s\S]*\} from '\.{1,2}\/(?:composables\/character\/)?useCharacterFormPayload';/
  );
  assert.doesNotMatch(characterFormScript, /applyLocalRules/);
  assert.doesNotMatch(characterFormScript, /defaultRenderPlugin/);
  assert.doesNotMatch(characterFormScript, /function normalizeAccessorySkillsForPayload/);
  assert.doesNotMatch(characterFormScript, /function hasNonDefaultAccessorySkills/);

  const start = characterFormPayloadSource.indexOf('export function normalizeAccessorySkillsForPayload(input = {}) {');
  const end = characterFormPayloadSource.indexOf('\nexport function normalizeAdvancedSettingsForForm', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = characterFormPayloadSource.slice(start, end);

  assert.match(snippet, /const normalized = \{\};/);
  assert.match(snippet, /for \(const key in defaults\)/);
  assert.match(snippet, /normalized\[key\] = \{/);
  assert.match(snippet, /enabled: normalizeSkillEnabled\(source\.enabled, defaults\[key\]\.enabled\)/);
  assert.match(snippet, /modelOverride: String\(source\.modelOverride \|\| source\.model_override \|\| ''\)\.trim\(\)\.slice\(0, 100\)/);
  assert.match(snippet, /providerProfileId: String\(source\.providerProfileId \|\| source\.provider_profile_id \|\| ''\)\.trim\(\)\.slice\(0, 160\)/);
  assert.match(snippet, /tools: normalizeAccessorySkillTools\(source\.tools\)/);
  assert.match(characterFormPayloadSource, /memoryAgent: \{ \.\.\.createDefaultAccessorySkill\('auto'\), memoryPolicy: normalizeMemoryPolicy\(\), embedding: normalizeMemoryEmbedding\(\) \}/);
  assert.match(snippet, /normalized\[key\]\.memoryPolicy = normalizeMemoryPolicy\(source\.memoryPolicy\)/);
  assert.match(snippet, /normalized\[key\]\.embedding = normalizeMemoryEmbedding\(source\.embedding\)/);
  assert.match(snippet, /return normalized;/);
  assert.doesNotMatch(snippet, /Object\.fromEntries/);
  assert.doesNotMatch(snippet, /Object\.keys\(defaults\)\.map/);

  const nonDefaultStart = characterFormPayloadSource.indexOf('export function hasNonDefaultAccessorySkills(skills = {}) {');
  const nonDefaultEnd = characterFormPayloadSource.indexOf('\nexport function normalizeSkillEnabled', nonDefaultStart);
  assert.notEqual(nonDefaultStart, -1);
  assert.notEqual(nonDefaultEnd, -1);
  const nonDefaultSnippet = characterFormPayloadSource.slice(nonDefaultStart, nonDefaultEnd);
  assert.match(nonDefaultSnippet, /const defaults = createDefaultAccessorySkills\(\);/);
  assert.match(nonDefaultSnippet, /for \(const key in defaults\)/);
  assert.match(nonDefaultSnippet, /Object\.prototype\.hasOwnProperty\.call\(defaults, key\)/);
  assert.match(nonDefaultSnippet, /normalizeSkillEnabled\(current\.enabled, fallback\.enabled\) !== fallback\.enabled/);
  assert.match(nonDefaultSnippet, /return true;/);
  assert.match(nonDefaultSnippet, /return false;/);
  assert.doesNotMatch(nonDefaultSnippet, /Object\.keys\(defaults\)\.some/);
});

test('CharacterFormView scans AI draft seed fields without key-array callbacks', () => {
  assert.match(
    characterAiGenerationSource,
    /const AI_DRAFT_SEED_FIELDS = \['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'\];/
  );
  assert.match(
    characterAiGenerationSource,
    /function hasDraftSeed\(\) \{\s*const payload = getCurrentPayload\(\);[\s\S]*if \(hasDraftSeedText\(payload\)\) \{[\s\S]*return true;[\s\S]*return \(Array\.isArray\(payload\.tags\) && payload\.tags\.length > 0\)[\s\S]*\|\| \(Array\.isArray\(payload\.regexRules\) && payload\.regexRules\.length > 0\);[\s\S]*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /function hasDraftSeedText\(payload = \{\}\) \{\s*for \(const key of AI_DRAFT_SEED_FIELDS\) \{[\s\S]*if \(String\(payload\[key\] \|\| ''\)\.trim\(\)\) \{[\s\S]*return true;[\s\S]*return false;[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /AI_DRAFT_SEED_FIELDS/);
  assert.doesNotMatch(characterFormScript, /function hasDraftSeed\(/);
  assert.doesNotMatch(characterFormScript, /\['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'\]\s*\.\s*some/);
  assert.doesNotMatch(characterAiGenerationSource, /\['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage'\]\s*\.\s*some/);
  assert.doesNotMatch(characterAiGenerationSource, /Object\.keys\(payload\)\.some/);
});

test('CharacterFormView builds render plugin previews with direct loops', () => {
  assert.match(
    characterFormScript,
    /import \{ useCharacterRenderPlugins \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterRenderPlugins';/
  );
  assert.match(
    characterFormScript,
    /const \{[\s\S]*addRenderPlugin,[\s\S]*enabledRenderPlugins,[\s\S]*removeRenderPlugin,[\s\S]*renderPluginPreviewText[\s\S]*\} = useCharacterRenderPlugins\(\{ canEdit, form \}\);/
  );
  assert.doesNotMatch(characterFormScript, /function collectEnabledRenderPlugins/);
  assert.doesNotMatch(characterFormScript, /function buildRenderPluginPreviewText/);
  assert.doesNotMatch(characterFormScript, /function addRenderPlugin/);
  assert.doesNotMatch(characterFormScript, /function removeRenderPlugin/);

  const start = characterRenderPluginsSource.indexOf('export function useCharacterRenderPlugins');
  const end = characterRenderPluginsSource.length;
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const snippet = characterRenderPluginsSource.slice(start, end);

  assert.match(characterRenderPluginsSource, /import \{ computed \} from 'vue';/);
  assert.match(characterRenderPluginsSource, /import \{ defaultRenderPlugin \} from '\.\/useCharacterFormPayload';/);
  assert.match(snippet, /const enabledRenderPlugins = computed\(\(\) => collectEnabledRenderPlugins\(form\.renderPlugins\)\);/);
  assert.match(
    snippet,
    /const renderPluginPreviewText = computed\(\(\) => buildRenderPluginPreviewText\(\s*form\.background,\s*form\.worldview,\s*form\.persona,\s*form\.openingMessage\s*\)\);/
  );
  assert.match(snippet, /function addRenderPlugin\(preset = false\) \{[\s\S]*if \(!canEdit\.value\) \{[\s\S]*return;[\s\S]*const plugin = defaultRenderPlugin\(\);[\s\S]*form\.renderPlugins\.push\(\{[\s\S]*label: preset \? '档案标题折叠' : `渲染插件 \$\{form\.renderPlugins\.length \+ 1\}`,[\s\S]*pattern: preset \? plugin\.pattern : ''[\s\S]*\}\);[\s\S]*\}/);
  assert.match(snippet, /function removeRenderPlugin\(index\) \{[\s\S]*if \(!canEdit\.value\) \{[\s\S]*return;[\s\S]*form\.renderPlugins\.splice\(index, 1\);[\s\S]*\}/);
  assert.match(
    snippet,
    /export function collectEnabledRenderPlugins\(plugins = \[\]\) \{\s*const currentPlugins = Array\.isArray\(plugins\) \? plugins : \[\];\s*const enabledPlugins = \[\];\s*for \(const plugin of currentPlugins\) \{[\s\S]*enabledPlugins\.push\(plugin\);[\s\S]*return enabledPlugins;\s*\}/
  );
  assert.match(
    snippet,
    /export function buildRenderPluginPreviewText\(\) \{\s*let previewText = '';[\s\S]*for \(let index = 0; index < arguments\.length; index \+= 1\) \{[\s\S]*const value = String\(arguments\[index\] \|\| ''\)\.trim\(\);[\s\S]*previewText = previewText \? `\$\{previewText\}\\n\\n\$\{value\}` : value;[\s\S]*return previewText;\s*\}/
  );
  assert.doesNotMatch(snippet, /form\.renderPlugins\.filter/);
  assert.doesNotMatch(snippet, /\.map\(/);
  assert.doesNotMatch(snippet, /\.filter\(/);
  assert.doesNotMatch(snippet, /\.join\(/);
});

test('CharacterFormView applies local regex preview rules with a direct loop', () => {
  assert.match(characterFormScript, /import \{ useCharacterRegexRules \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterRegexRules';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*addRule,[\s\S]*regexPreview,[\s\S]*removeRule[\s\S]*\} = useCharacterRegexRules\(\{ canEdit, form, previewInput \}\);/
  );
  assert.doesNotMatch(characterFormScript, /function addRule\(/);
  assert.doesNotMatch(characterFormScript, /function removeRule\(/);
  assert.doesNotMatch(characterFormScript, /function applyLocalRules\(text, rules, phase\)/);
  assert.match(characterRegexRulesSource, /import \{ computed \} from 'vue';/);
  assert.match(characterRegexRulesSource, /import \{ applyLocalRules \} from '\.\/useCharacterFormPayload';/);
  assert.match(characterRegexRulesSource, /const regexPreview = computed\(\(\) => \{[\s\S]*if \(!previewInput\.value\.trim\(\)\) \{[\s\S]*return '';[\s\S]*return applyLocalRules\(previewInput\.value, form\.regexRules, 'input'\);[\s\S]*\}\);/);
  assert.match(characterRegexRulesSource, /function addRule\(\) \{[\s\S]*if \(!canEdit\.value\) \{[\s\S]*return;[\s\S]*form\.regexRules\.push\(\{[\s\S]*label: `规则 \$\{form\.regexRules\.length \+ 1\}`,[\s\S]*groupName: '全局'[\s\S]*\}\);[\s\S]*\}/);
  assert.match(characterRegexRulesSource, /function removeRule\(index\) \{[\s\S]*if \(!canEdit\.value\) \{[\s\S]*return;[\s\S]*form\.regexRules\.splice\(index, 1\);[\s\S]*\}/);

  const start = characterFormPayloadSource.indexOf('export function applyLocalRules(text, rules, phase) {');
  assert.notEqual(start, -1);
  const snippet = characterFormPayloadSource.slice(start);

  assert.match(snippet, /const currentRules = Array\.isArray\(rules\) \? rules : \[\];/);
  assert.match(snippet, /let value = text;/);
  assert.match(snippet, /for \(const rule of currentRules\) \{/);
  assert.match(snippet, /if \(!rule\.enabled \|\| !rule\.pattern \|\| !\(rule\.scope === phase \|\| rule\.scope === 'both'\)\) \{\s*continue;\s*\}/);
  assert.match(snippet, /value = value\.replace\(new RegExp\(rule\.pattern, rule\.flags \|\| 'g'\), rule\.replacement \|\| ''\);/);
  assert.match(snippet, /catch \{\s*continue;\s*\}/);
  assert.match(snippet, /return value;/);
  assert.doesNotMatch(snippet, /rules\.reduce/);
});

test('CharacterFormView normalizes advanced effects and tag names with direct loops', () => {
  assert.match(
    characterStatusBlueprintSource,
    /if \(Array\.isArray\(parsed\.effects\)\) \{\s*cfg\.effects = collectAllowedStatusEffects\(parsed\.effects\);\s*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function collectAllowedStatusEffects\(effects = \[\]\) \{\s*const currentEffects = Array\.isArray\(effects\) \? effects : \[\];\s*const allowedEffects = \[\];\s*for \(const effect of currentEffects\) \{\s*if \(STATUS_BAR_EFFECTS\.includes\(effect\)\) \{\s*allowedEffects\.push\(effect\);\s*\}\s*\}\s*return allowedEffects;\s*\}/
  );
  assert.match(
    characterFormPayloadSource,
    /selectedTags: collectCharacterTagNames\(character\.characterTags\),/
  );
  assert.match(
    characterFormPayloadSource,
    /export function collectCharacterTagNames\(tags = \[\]\) \{\s*const currentTags = Array\.isArray\(tags\) \? tags : \[\];\s*const tagNames = \[\];\s*for \(const tag of currentTags\) \{\s*tagNames\.push\(tag\.name\);\s*\}\s*return tagNames;\s*\}/
  );
  assert.doesNotMatch(characterStatusBlueprintSource, /parsed\.effects\.filter/);
  assert.doesNotMatch(characterStatusBlueprintSource, /\['glow', 'striped', 'pulse'\]\.includes/);
  assert.doesNotMatch(characterFormScript, /\(character\.characterTags \|\| \[\]\)\.map/);
});

test('CharacterFormView preserves unchanged AI process panel references', () => {
  assert.match(characterAiProcessPanelScript, /import \{ countOwnObjectKeys \} from '\.\.\/\.\.\/utils\/objectKeys';/);
  assert.match(characterAiGenerationSource, /import \{ samePlainValue \} from '\.\.\/\.\.\/utils\/plainValues';/);
  assert.match(characterFormScript, /import \{ useCharacterAiGeneration \} from '\.{1,2}\/(?:composables\/character\/)?useCharacterAiGeneration';/);
  assert.match(
    characterAiProcessPanelScript,
    /function toolResultLabel\(result = \{\}\) \{[\s\S]*result\?\.applied && typeof result\.applied === 'object'[\s\S]*countOwnObjectKeys\(result\.applied\)[\s\S]*\}/
  );
  assert.doesNotMatch(characterFormScript, /function countOwnObjectKeys\(value\)/);
  assert.doesNotMatch(characterFormScript, /Object\.keys\(result\.applied\)\.length/);
  assert.match(
    characterAiGenerationSource,
    /function setAiToolCallsIfChanged\(nextToolCalls\) \{\s*return setAiPlainListIfChanged\(aiToolCalls, nextToolCalls\);\s*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /function setAiProcessIfChanged\(nextProcess\) \{\s*return setAiPlainListIfChanged\(aiProcess, nextProcess\);\s*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /function setAiModSuggestionsIfChanged\(nextSuggestions\) \{\s*return setAiPlainListIfChanged\(aiModSuggestions, nextSuggestions\);\s*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /function setAiPlainListIfChanged\(listRef, nextItems\) \{[\s\S]*sameListItems\(listRef\.value, normalizedItems, samePlainValue\)[\s\S]*listRef\.value = normalizedItems;[\s\S]*return true;[\s\S]*\}/
  );
  assert.doesNotMatch(
    characterFormScript,
    /function samePlainValue\(/
  );
  assert.doesNotMatch(characterFormScript, /Object\.keys\(current\)/);
  assert.doesNotMatch(characterFormScript, /currentList\.every\(/);
  assert.doesNotMatch(characterFormScript, /current\.every\(/);
  assert.doesNotMatch(characterFormScript, /currentKeys\.every\(/);
  assert.match(
    characterAiGenerationSource,
    /function updateAiProcessStep\(round = 1, updateStep\) \{[\s\S]*const currentProcess = Array\.isArray\(aiProcess\.value\) \? aiProcess\.value : \[\];[\s\S]*let stepIndex = -1;[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) \{[\s\S]*currentProcess\[index\]\?\.round === round[\s\S]*break;[\s\S]*const nextProcess = \[\];[\s\S]*for \(let index = 0; index < currentProcess\.length; index \+= 1\) \{[\s\S]*nextProcess\.push\(index === stepIndex \? nextStep : currentProcess\[index\]\);[\s\S]*if \(stepIndex < 0\) \{[\s\S]*nextProcess\.push\(nextStep\);[\s\S]*setAiProcessIfChanged\(nextProcess\);[\s\S]*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /function appendAiToolCall\(log\) \{[\s\S]*const currentToolCalls = Array\.isArray\(aiToolCalls\.value\) \? aiToolCalls\.value : \[\];[\s\S]*const nextToolCalls = \[\];[\s\S]*for \(const toolCall of currentToolCalls\) \{[\s\S]*nextToolCalls\.push\(toolCall\);[\s\S]*nextToolCalls\.push\(log\);[\s\S]*setAiToolCallsIfChanged\(nextToolCalls\);[\s\S]*\}/
  );
  assert.match(
    characterAiGenerationSource,
    /import \{ appendAiToolList, cloneAiToolList \} from '\.\.\/\.\.\/utils\/aiToolLists';/
  );
  assert.doesNotMatch(characterAiGenerationSource, /function cloneAiToolList\(/);
  assert.doesNotMatch(characterAiGenerationSource, /function appendAiToolList\(/);
  assert.doesNotMatch(characterAiGenerationSource, /currentProcess\.findIndex\(/);
  assert.doesNotMatch(characterAiGenerationSource, /currentProcess\.map\(\(item, index\) => \(index === stepIndex \? nextStep : item\)\)/);
  assert.doesNotMatch(characterAiGenerationSource, /\[\.\.\.currentProcess, nextStep\]/);
  assert.doesNotMatch(characterAiGenerationSource, /setAiToolCallsIfChanged\(\[\.\.\.currentToolCalls, log\]\);/);
  assert.doesNotMatch(characterAiGenerationSource, /Array\.isArray\(currentStep\.tools\) \? \[\.\.\.currentStep\.tools\] : \[\]/);
  assert.doesNotMatch(characterAiGenerationSource, /Array\.isArray\(step\.tools\) \? \[\.\.\.step\.tools\] : \[\]/);
  assert.doesNotMatch(characterAiGenerationSource, /\[\.\.\.\(Array\.isArray\(target\.tools\) \? target\.tools : \[\]\), log\]/);
  assert.match(
    characterAiGenerationSource,
    /async function runCharacterAi\([^\n]*\) \{[\s\S]*if \(!resume\) \{[\s\S]*setAiToolCallsIfChanged\(\[\]\);[\s\S]*setAiProcessIfChanged\([\s\S]*state: 'running'[\s\S]*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  // Tool calls and process rounds are applied before the draft is written back,
  // and mod suggestions follow once the character has been applied.
  assert.match(
    characterAiGenerationSource,
    /setAiToolCallsIfChanged\(mergeUniqueToolCallLists\(aiToolCalls\.value, result\.toolCalls\)\);[\s\S]*result\.streamRecovered[\s\S]*mergeProcessLists\(baseProcess, result\.process, resultRoundOffset\)[\s\S]*setAiModSuggestionsIfChanged\(result\.character\?\.modSuggestions\);/
  );
  assert.match(
    characterAiGenerationSource,
    /async function completeAdvancedSettingsWithAi\(\) \{[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '等待模型响应\.\.\.', content: '', tools: \[\] \}\]\);[\s\S]*setAiToolCallsIfChanged\(\[\]\);/
  );
  assert.match(
    characterAiGenerationSource,
    /notify\?\.success\?\.\(`已创建 \$\{suggestions\.length\} 个 Mod`\);\s*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  assert.match(readVueBlocks('frontend/src/views/CharacterAssistantView.vue').template, /<CharacterAiModSuggestions[\s\S]*@create="editor\.createSuggestedMods"/);
  assert.match(characterAiModSuggestionsScript, /import \{ ListChecks, Plus \} from '@lucide\/vue';/);
  assert.match(characterAiModSuggestionsScript, /const emit = defineEmits\(\['create'\]\);/);
  assert.match(characterAiModSuggestionsTemplate, /class="ai-mod-suggestions" aria-label="AI Mod 建议"/);
  assert.match(characterAiModSuggestionsTemplate, /class="ai-mod-head"[\s\S]*Mod 建议[\s\S]*\{\{ suggestions\.length \}\} 项/);
  assert.match(characterAiModSuggestionsTemplate, /v-for="\([\s\S]*mod, index[\s\S]*\) in suggestions"/);
  assert.match(characterAiModSuggestionsTemplate, /:disabled="creating"[\s\S]*@click="emit\('create'\)"/);
  assert.match(characterAiModSuggestionsTemplate, /\{\{ creating \? '创建中\.\.\.' : '创建这些 Mod' \}\}/);
  assert.match(
    characterAiGenerationSource,
    /function aiStreamHandlers\(\{[\s\S]*isCurrent = \(\) => !isDisposed\(\)[\s\S]*roundOffset = 0[\s\S]*step: \(step = \{\}\) => \{[\s\S]*updateAiProcessStep\(round, \(target\) => \(\{[\s\S]*tools: target\.tools\?\.length \? target\.tools : cloneAiToolList\(step\.tools\)[\s\S]*tool: \(call = \{\}\) => \{[\s\S]*tools: appendAiToolList\(target\.tools, log\)[\s\S]*appendAiToolCall\(log\);/
  );
  assert.match(characterAiProcessPanelTemplate, /class="ai-workflow-current" role="status" aria-live="polite"/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-workflow-tool-item"[\s\S]*<strong>参数<\/strong>[\s\S]*<strong>结果<\/strong>/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-workflow-tool-batch"[\s\S]*v-for="\(call, callIndex\) in entry\.tools"[\s\S]*class="ai-workflow-tool-item"/);
  assert.doesNotMatch(characterAiProcessPanelTemplate, /class="ai-workflow-tool-item" open/);
  assert.match(characterAiGenerationSource, /aiLastError\.value = err\?\.message \|\| 'AI 生成失败';/);
  assert.doesNotMatch(characterAiGenerationSource, /aiToolCalls\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /aiProcess\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /aiModSuggestions\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /(?:aiToolCalls|aiProcess)\.value\.(?:push|splice|unshift|shift|pop)\(/);
  assert.doesNotMatch(characterAiGenerationSource, /target\.tools\.push\(/);
  assert.doesNotMatch(characterAiGenerationSource, /function ensureAiProcessStep/);
  assert.doesNotMatch(characterFormScript, /function aiStreamHandlers/);
  assert.doesNotMatch(characterFormScript, /function setAiToolCallsIfChanged/);
});

test('CharacterFormView uses section navigation and a full creation form', () => {
  assert.match(characterFormScript, /useCharacterSections\(\{[\s\S]*sections: formSections,[\s\S]*isSectionVisible: \(section\) => isCharacterSectionVisibleInCurrentMode\(section\.id\)/);
  assert.match(characterSectionsSource, /const activeSection = ref\(sections\[0\]\?\.id \|\| 'basic'\);/);
  assert.match(characterSectionsSource, /const visibleSections = computed\(getVisibleSections\);/);
  assert.match(characterSectionsSource, /function setActiveSection\(sectionId\) \{[\s\S]*if \(!hasSection\(sectionId\)\)[\s\S]*activeSection\.value = sectionId;/);
  assert.match(characterSectionsSource, /function goToPreviousSection\(\)/);
  assert.match(characterSectionsSource, /function goToNextSection\(\)/);
  assert.doesNotMatch(characterSectionsSource, /scrollIntoView|sectionNavRef|syncActiveSectionFromScroll|addEventListener\('scroll'/);
  assert.match(characterEditorDesktopTemplate, /class="character-studio-nav"[\s\S]*editor\.sectionGroups[\s\S]*editor\.activeSection[\s\S]*@click="editor\.setActiveSection\(section\.id\)"/);
  assert.match(characterEditorDesktopTemplate, /editor\.isCharacterCreationFullForm[\s\S]*v-for="section in editor\.visibleSections"/);
  assert.match(characterEditorDesktopTemplate, /<CharacterSectionOutlet v-else-if="editor\.activeSection"[\s\S]*:section-id="editor\.activeSection"/);
  assert.match(characterEditorMobileTemplate, /class="character-mobile-section-item"[\s\S]*@click="enterSection\(section\.id\)"/);
  assert.match(stylesSource, /\.character-studio-nav\s*\{[\s\S]*position:\s*sticky;[\s\S]*max-height:/);
  assert.match(stylesSource, /\.character-mobile-sheet-head\s*\{[\s\S]*position:\s*sticky;/);
});

test('CharacterFormView uses a responsive workbench, live summary, validation, and modal status preview', () => {
  assert.match(characterFormScript, /const showStatusPreviewDialog = ref\(false\);/);
  assert.match(characterFormScript, /function updateCharacterFormField\(key, value\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(form, key\)[\s\S]*form\[key\] = value;/);
  assert.match(characterFormTemplate, /<CharacterEditorMobile v-if="isPhone" \/>[\s\S]*<CharacterEditorDesktop v-else \/>/);
  assert.match(characterEditorDesktopTemplate, /class="character-studio"[\s\S]*class="character-studio-main"[\s\S]*class="character-studio-card"[\s\S]*editor\.completedCount/);
  assert.match(characterEditorMobileTemplate, /class="character-mobile"[\s\S]*class="character-mobile-hub"[\s\S]*class="character-mobile-sheet"[\s\S]*class="character-mobile-actionbar"/);
  assert.match(characterSectionOutletTemplate, /<CharacterBasicInfoPanel[\s\S]*:form="editor\.form"[\s\S]*@update-field="editor\.updateCharacterFormField"/);
  assert.match(characterSectionOutletTemplate, /<CharacterSettingsPanel[\s\S]*:form="editor\.form"[\s\S]*@update-field="editor\.updateCharacterFormField"/);
  assert.match(characterSectionOutletTemplate, /<CharacterStatusBarPanel[\s\S]*@preview-status="editor\.showStatusPreviewDialog = true"/);
  assert.match(characterFormTemplate, /<CharacterStatusPreviewDialog[\s\S]*v-if="editor\.showStatusPreviewDialog"[\s\S]*:status-bar="editor\.statusBarBlueprintPreview"[\s\S]*:template-config="editor\.statusBarBlueprintPreviewConfig"/);
  assert.match(characterStatusPreviewDialogTemplate, /<dialog[\s\S]*class="status-preview-dialog form-panel"[\s\S]*aria-modal="true"/);
  assert.match(stylesSource, /\.character-studio\s*\{[\s\S]*grid-template-columns:/);
  assert.match(stylesSource, /\.character-studio-main\s*\{[\s\S]*grid-template-columns:/);
  assert.match(stylesSource, /\.character-mobile-actionbar\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:/);
  assert.match(stylesSource, /\.status-preview-dialog\s*\{[\s\S]*width:\s*min\(720px, calc\(100vw - 32px\)\)/);
});

test('Character assistant settings keep world book controls in the separate workspace', () => {
  assert.match(characterAiDraftPanelTemplate, /<WorldBookTargetPicker/);
  assert.match(characterAiDraftPanelTemplate, /<CharacterAiDraftInputs/);
  assert.doesNotMatch(characterSectionOutletTemplate, /ai-workbench-results|ai-workbench-config/);
});

test('Character assistant transcript is contained by its dedicated responsive layout', () => {
  const assistantStyles = readRepoText('frontend/src/styles/character-assistant.css');
  assert.match(assistantStyles, /\.assistant-transcript/);
  assert.match(assistantStyles, /overflow-y: auto/);
  assert.match(assistantStyles, /@media/);
});

test('Character assistant composer delegates send and stop through one control', () => {
  assert.match(characterAiDraftActionsTemplate, /@click="emit\('complete'\)"/);
  assert.match(characterAiDraftActionsTemplate, /@click="emit\('stop'\)"/);
  assert.match(characterAiDraftInputsTemplate, /update:streamingEnabled/);
  assert.match(characterAiDraftInputsTemplate, /set-option/);
});

test('Character assistant preserves runtime preferences and resumable checkpoints', () => {
  assert.match(assistantRuntimePreferencesSource, /persistRef\(requestedThinkingLevel/);
  assert.match(characterAiGenerationSource, /checkpoint: \(checkpoint = \{\}\) =>/);
  assert.match(characterAiGenerationSource, /async function resumeCharacterAi\(\)/);
  assert.match(characterAiGenerationSource, /function exportAiSessionState\(\)/);
  assert.match(characterAiGenerationSource, /function selectAiSession\(session\)/);
  assert.match(characterAiGenerationSource, /assistantSessionId: aiSessionId\.value, conversationMode: true/);
  assert.match(characterEditorSource, /assistantSessionId: aiSessionId\.value/);
});

test('Character assistant retains the provider streaming preference', () => {
  assert.match(assistantRuntimePreferencesSource, /persistRef\(assistantStreamingEnabled/);
  assert.match(characterAiDraftInputsTemplate, /update:streamingEnabled/);
  assert.match(characterAiGenerationSource, /providerStreaming: Boolean\(assistantStreamingEnabled\?\.value\)/);
});
