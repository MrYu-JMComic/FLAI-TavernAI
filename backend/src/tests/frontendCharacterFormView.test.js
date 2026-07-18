import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readFrontendStyles, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: characterFormScript,
  template: characterFormTemplate
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
const {
  script: characterAdvancedSettingsPanelScript,
  template: characterAdvancedSettingsPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterAdvancedSettingsPanel.vue');
const {
  script: characterBasicInfoPanelScript,
  template: characterBasicInfoPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterBasicInfoPanel.vue');
const {
  script: characterCreationWizardPanelScript,
  template: characterCreationWizardPanelTemplate
} = readVueBlocks('frontend/src/components/character/CharacterCreationWizardPanel.vue');
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
const characterSectionNavigationSource = readRepoText('frontend/src/composables/character/useCharacterSectionNavigation.js');
const characterWorldBookSelectionSource = readRepoText('frontend/src/composables/character/useCharacterWorldBookDialog.js');
const listReferencesSource = readRepoText('frontend/src/utils/listReferences.js');
const stylesSource = readFrontendStyles();

test('CharacterFormView locks AI actions behind one shared busy state', () => {
  assert.match(characterFormScript, /import \{ useCharacterAiGeneration \} from '\.\.\/composables\/character\/useCharacterAiGeneration';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*aiLoading,[\s\S]*aiRequirement,[\s\S]*aiToolCalls,[\s\S]*aiProcess,[\s\S]*aiReasoning,[\s\S]*aiModSuggestions,[\s\S]*suggestedModsCreating,[\s\S]*advancedAiLoading,[\s\S]*advancedAiRequirement,[\s\S]*characterAiActionBusy,[\s\S]*cancelCharacterAiGeneration,[\s\S]*completeAdvancedSettingsWithAi,[\s\S]*completeWithAi,[\s\S]*createSuggestedMods,[\s\S]*setAiOptionValue,[\s\S]*stopAdvancedAi,[\s\S]*stopCharacterAi[\s\S]*\} = useCharacterAiGeneration\(\{[\s\S]*canEdit,[\s\S]*saving,[\s\S]*form,[\s\S]*aiOptions,[\s\S]*aiUseCurrentDraft,[\s\S]*assistantModel,[\s\S]*buildPayload: toPayload,[\s\S]*applyAdvancedSettingsDraft,[\s\S]*isDisposed: \(\) => characterFormDisposed,[\s\S]*notify[\s\S]*\}\);/
  );
  assert.match(
    characterAiGenerationSource,
    /const characterAiActionBusy = computed\(\(\) => \([\s\S]*aiLoading\.value[\s\S]*advancedAiLoading\.value[\s\S]*Boolean\(saving\?\.value\)[\s\S]*!canEdit\?\.value[\s\S]*\)\);/
  );
  assert.match(
    characterAiGenerationSource,
    /async function completeWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );
  assert.match(
    characterAiGenerationSource,
    /async function completeAdvancedSettingsWithAi\(\)\s*{\s*if \(characterAiActionBusy\.value\) return;/
  );
  assert.doesNotMatch(characterFormScript, /async function completeWithAi\(\)/);
  assert.doesNotMatch(characterFormScript, /async function completeAdvancedSettingsWithAi\(\)/);

  assert.ok(
    countMatches(characterFormTemplate, /:disabled="characterAiActionBusy"/g)
      + countMatches(characterAdvancedSettingsPanelTemplate, /:disabled="characterAiActionBusy"/g) >= 2
  );
  assert.ok(countMatches(characterAiDraftPanelTemplate, /:disabled="disabled"/g) >= 2);
  assert.match(characterAiGenerationSource, /function setAiOptionValue\(key, enabled\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(aiOptions, key\)[\s\S]*aiOptions\[key\] = Boolean\(enabled\);[\s\S]*\}/);
  assert.doesNotMatch(characterFormScript, /function setAiOptionValue\(key, enabled\)/);
  assert.match(characterFormScript, /import CharacterAiDraftPanel from '\.\.\/components\/character\/CharacterAiDraftPanel\.vue';/);
  assert.match(characterFormScript, /import \{ useCharacterAiPreferences \} from '\.\.\/composables\/character\/useCharacterAiPreferences';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*aiUseCurrentDraft,[\s\S]*assistantModel,[\s\S]*assistantModelOptions,[\s\S]*providerModelOptionsFor[\s\S]*\} = useCharacterAiPreferences\(computed\(\(\) => props\.provider\)\);/
  );
  assert.doesNotMatch(characterFormScript, /ASSISTANT_MODEL_STORAGE_KEY/);
  assert.doesNotMatch(characterFormScript, /function loadAssistantModel/);
  assert.match(characterAiPreferencesSource, /const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';/);
  assert.match(characterAiPreferencesSource, /const ASSISTANT_USE_CURRENT_STORAGE_KEY = 'flai-assistant-use-current-draft';/);
  assert.match(characterAiPreferencesSource, /const \{ providerModelOptionsFor \} = useProviderModels\(providerRef\);/);
  assert.match(characterAiPreferencesSource, /const assistantModelOptions = computed\(\(\) => providerModelOptionsFor\(assistantModel\.value, '使用全局模型'\)\);/);
  assert.match(characterAiPreferencesSource, /watch\(assistantModel, \(value\) => \{[\s\S]*localStorage\.setItem\(ASSISTANT_MODEL_STORAGE_KEY, String\(value \|\| ''\)\.trim\(\)\);/);
  assert.match(characterAiPreferencesSource, /watch\(aiUseCurrentDraft, \(value\) => \{[\s\S]*localStorage\.setItem\(ASSISTANT_USE_CURRENT_STORAGE_KEY, value \? 'true' : 'false'\);/);
  assert.doesNotMatch(characterFormScript, /useCharacterAiPanelLayout/);
  assert.match(characterFormTemplate, /<CharacterAiDraftPanel[\s\S]*v-model:requirement="aiRequirement"[\s\S]*v-model:assistant-model="assistantModel"[\s\S]*v-model:use-current-draft="aiUseCurrentDraft"[\s\S]*:disabled="characterAiActionBusy"[\s\S]*:loading="aiLoading"[\s\S]*:model-options="assistantModelOptions"[\s\S]*:options="aiOptions"[\s\S]*@complete="completeWithAi"[\s\S]*@set-option="setAiOptionValue"[\s\S]*@stop="stopCharacterAi"/);
  assert.doesNotMatch(characterFormTemplate, /aiPanel(?:Dragging|Pos|Ref|Size)|drag-start|resize-start|reset-panel/);
  assert.match(characterAiDraftPanelScript, /const hasOutput = computed\(\(\) => \([\s\S]*props\.process\.length > 0[\s\S]*props\.toolCalls\.length > 0[\s\S]*props\.suggestions\.length > 0[\s\S]*\)\);/);
  assert.match(characterAiDraftPanelTemplate, /class="form-panel ai-draft-panel"[\s\S]*:aria-busy="loading"[\s\S]*aria-labelledby="character-ai-workbench-title"/);
  assert.match(characterAiDraftPanelTemplate, /class="ai-workbench-header"[\s\S]*class="ai-workbench-status"[\s\S]*class="ai-workbench-grid" :class="\{ 'has-output': hasOutput \}"/);
  assert.match(characterAiDraftPanelTemplate, /<CharacterAiDraftInputs[\s\S]*:requirement="requirement"[\s\S]*:assistant-model="assistantModel"[\s\S]*:use-current-draft="useCurrentDraft"[\s\S]*:disabled="disabled"[\s\S]*:model-options="modelOptions"[\s\S]*:options="options"[\s\S]*@set-option="\(/);
  assert.match(characterAiDraftInputsScript, /const emit = defineEmits\(\[[\s\S]*'set-option'[\s\S]*'update:assistantModel'[\s\S]*'update:requirement'[\s\S]*'update:useCurrentDraft'[\s\S]*\]\);/);
  assert.match(characterAiDraftInputsScript, /const AI_OPTION_LABELS = \{[\s\S]*profile: '基础资料'[\s\S]*modSuggestions: 'Mod 建议'[\s\S]*\};/);
  assert.match(characterAiDraftInputsScript, /const selectedOptionCount = computed\(\(\) => Object\.values\(props\.options\)\.filter\(Boolean\)\.length\);/);
  assert.match(characterAiDraftInputsScript, /function setAllOptions\(enabled\) \{[\s\S]*for \(const key of Object\.keys\(props\.options\)\)[\s\S]*emit\('set-option', key, enabled\);/);
  assert.match(characterAiDraftInputsTemplate, /:value="requirement"[\s\S]*@input="emit\('update:requirement', readInputValue\(\$event\)\)"/);
  assert.match(characterAiDraftInputsTemplate, /:value="assistantModel"[\s\S]*@change="emit\('update:assistantModel', readInputValue\(\$event\)\)"[\s\S]*v-for="model in modelOptions"/);
  assert.match(characterAiDraftInputsTemplate, /:checked="useCurrentDraft"[\s\S]*@change="emit\('update:useCurrentDraft', readInputChecked\(\$event\)\)"/);
  assert.match(characterAiDraftInputsTemplate, /class="ai-scope-disclosure"[\s\S]*selectedOptionCount[\s\S]*setAllOptions\(true\)[\s\S]*setAllOptions\(false\)[\s\S]*class="ai-scope-grid"[\s\S]*v-for="\(enabled, key\) in options"/);
  assert.match(characterAiDraftPanelTemplate, /<CharacterAiDraftActions[\s\S]*:disabled="disabled"[\s\S]*:loading="loading"[\s\S]*@complete="emit\('complete'\)"[\s\S]*@stop="emit\('stop'\)"/);
  assert.match(characterAiDraftPanelTemplate, /<aside v-if="hasOutput" class="ai-workbench-results"[\s\S]*<CharacterAiModSuggestions[\s\S]*<CharacterAiProcessPanel/);
  assert.match(characterAiProcessPanelScript, /const latestSummary = computed\(\(\) => \{[\s\S]*props\.process\.length - 1[\s\S]*step\?\.content \|\| step\?\.reasoning/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-process-summary"[\s\S]*class="ai-process-disclosure"[\s\S]*class="ai-process-detail-scroll"/);
  assert.doesNotMatch(characterAiProcessPanelTemplate, /class="ai-(?:process-step|tool-detail)" open/);
  assert.match(characterAiDraftActionsScript, /import \{ WandSparkles \} from '@lucide\/vue';/);
  assert.match(characterAiDraftActionsScript, /const emit = defineEmits\(\['complete', 'stop'\]\);/);
  assert.match(characterAiDraftActionsTemplate, /class="primary-button ai-draft-button"[\s\S]*:disabled="disabled"[\s\S]*:aria-busy="loading"[\s\S]*emit\('complete'\)/);
  assert.match(characterAiDraftActionsTemplate, /v-if="loading"[\s\S]*emit\('stop'\)/);
  assert.match(characterAdvancedSettingsPanelTemplate, /class="ghost-button"\s+type="button"\s+:disabled="characterAiActionBusy"\s+:aria-busy="advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="aiLoading \|\| advancedAiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /class="primary-button ai-draft-button" type="button" :disabled="aiLoading"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="advancedAiLoading \|\| !canEdit"/);
});

test('CharacterFormView footer actions share one busy state', () => {
  assert.match(characterFormScript, /import \{ exportEnvelope \} from '\.\.\/api\/envelopes\.js';/);
  assert.match(characterFormScript, /import \{ downloadJsonFile, todayStamp \} from '\.\.\/utils\/downloadJson\.js';/);
  assert.doesNotMatch(characterFormScript, /exportCharacter/);
  assert.match(
    characterFormScript,
    /const characterFooterActionBusy = computed\(\(\) => saving\.value \|\| deleting\.value \|\| exporting\.value\);/
  );
  assert.match(
    characterFormScript,
    /async function submit\(\)\s*{\s*if \(characterFormDisposed \|\| characterFooterActionBusy\.value \|\| !canEdit\.value\)/
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

  assert.equal(countMatches(characterFormTemplate, /:disabled="characterFooterActionBusy"/g), 3);
  assert.match(characterFormTemplate, /class="danger-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="deleting"/);
  assert.match(characterFormTemplate, /class="ghost-button" type="button" :disabled="characterFooterActionBusy" :aria-busy="exporting"/);
  assert.match(characterFormTemplate, /class="primary-button" type="submit" :disabled="characterFooterActionBusy" :aria-busy="saving"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="deleting"/);
  assert.doesNotMatch(characterFormTemplate, /:disabled="exporting"/);
  assert.doesNotMatch(characterFormTemplate, /type="submit" :disabled="saving"/);
});

test('CharacterFormView autosaves editable local drafts through one scoped path', () => {
  assert.match(characterFormScript, /import \{ useCharacterFormDraft \} from '\.\.\/composables\/character\/useCharacterFormDraft';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*characterDraftStatus,[\s\S]*characterDraftStatusText,[\s\S]*clearCurrentCharacterDraft,[\s\S]*discardCharacterDraft,[\s\S]*establishCharacterDraftBaseline,[\s\S]*flushCharacterDraftBeforeDispose,[\s\S]*initializeCharacterDraftState,[\s\S]*pendingCharacterDraft,[\s\S]*restoreCharacterDraft,[\s\S]*scheduleCharacterDraftSave,[\s\S]*startCharacterDraftInterval[\s\S]*\} = useCharacterFormDraft\(\{[\s\S]*isEditing,[\s\S]*editingCharacterId,[\s\S]*canEdit,[\s\S]*isDisposed: \(\) => characterFormDisposed,[\s\S]*buildPayload: toPayload,[\s\S]*getSelectedWorldBookIds: \(\) => selectedWorldBookIds\.value,[\s\S]*normalizePayload: normalizeCharacterDraftPayload,[\s\S]*normalizeWorldBookIds,[\s\S]*applyPayload: applyCharacterDraftPayload,[\s\S]*setSelectedWorldBookIds: setSelectedWorldBookIdsIfChanged[\s\S]*\}\);/
  );
  assert.doesNotMatch(characterFormScript, /const CHARACTER_FORM_DRAFT_STORAGE_PREFIX = 'flai-character-form-draft';/);
  assert.doesNotMatch(characterFormScript, /function getCharacterDraftStorageKey/);
  assert.match(characterFormDraftSource, /const pendingCharacterDraft = ref\(null\);/);
  assert.match(characterFormDraftSource, /const characterDraftStatus = ref\('idle'\);/);
  assert.match(characterFormDraftSource, /const CHARACTER_FORM_DRAFT_STORAGE_PREFIX = 'flai-character-form-draft';/);
  assert.match(characterFormDraftSource, /const CHARACTER_FORM_DRAFT_AUTOSAVE_MS = 30000;/);
  assert.match(characterFormDraftSource, /const CHARACTER_FORM_DRAFT_DEBOUNCE_MS = 1200;/);
  assert.match(characterFormDraftSource, /const CHARACTER_FORM_DRAFT_MAX_CHARS = 200000;/);

  assert.match(
    characterFormScript,
    /watch\(\s*\(\) => \(\{[\s\S]*payload: toPayload\(\),[\s\S]*selectedWorldBookIds: \[\.\.\.selectedWorldBookIds\.value\][\s\S]*scheduleCharacterDraftSave\(\);[\s\S]*\{ deep: true \}/
  );
  assert.match(
    characterFormDraftSource,
    /function getCharacterDraftStorageKey\(\) \{[\s\S]*`\$\{CHARACTER_FORM_DRAFT_STORAGE_PREFIX\}:edit:\$\{characterId\}`[\s\S]*`\$\{CHARACTER_FORM_DRAFT_STORAGE_PREFIX\}:new`/
  );
  assert.match(
    characterFormDraftSource,
    /function canPersistCharacterDraft\(\) \{[\s\S]*!isDisposed\(\)[\s\S]*!characterDraftHydrating[\s\S]*Boolean\(canEdit\?\.value\)[\s\S]*!pendingCharacterDraft\.value[\s\S]*Boolean\(characterDraftBaselineSerialized\)[\s\S]*Boolean\(getCharacterDraftStorageKey\(\)\);/
  );
  assert.match(
    characterFormDraftSource,
    /function saveCharacterDraftNow\(\) \{[\s\S]*if \(!serialized \|\| serialized === characterDraftBaselineSerialized\) \{[\s\S]*removeCharacterDraftFromStorage\(\);[\s\S]*raw\.length > CHARACTER_FORM_DRAFT_MAX_CHARS[\s\S]*localStorage\.setItem\(getCharacterDraftStorageKey\(\), raw\);/
  );
  assert.equal(countMatches(characterFormDraftSource, /localStorage\.setItem\(getCharacterDraftStorageKey\(\), raw\);/g), 1);
  assert.match(
    characterFormDraftSource,
    /function scheduleCharacterDraftSave\(\) \{[\s\S]*characterDraftSaveTimer = setTimeout\(\(\) => \{[\s\S]*saveCharacterDraftNow\(\);[\s\S]*CHARACTER_FORM_DRAFT_DEBOUNCE_MS/
  );
  assert.match(
    characterFormDraftSource,
    /function startCharacterDraftInterval\(\) \{[\s\S]*characterDraftInterval = setInterval\(saveCharacterDraftNow, CHARACTER_FORM_DRAFT_AUTOSAVE_MS\);/
  );
  assert.match(
    characterFormScript,
    /onMounted\(async \(\) => \{[\s\S]*startCharacterDraftInterval\(\);[\s\S]*initializeCharacterDraftState\(\);[\s\S]*await optionsLoad;/
  );
  assert.match(
    characterFormScript,
    /Object\.assign\(form, normalizeForForm\(character\)\);[\s\S]*setSelectedWorldBookIdsFromBooksIfChanged\(linkedBooks\);[\s\S]*initializeCharacterDraftState\(\);/
  );
  assert.match(
    characterFormScript,
    /await syncCharacterWorldBooks\(saved\.id, \{ editing, selectedIds: worldBookIds \}\);[\s\S]*establishCharacterDraftBaseline\(\);[\s\S]*clearCurrentCharacterDraft\(\);[\s\S]*notify\.success/
  );
  assert.match(
    characterFormScript,
    /onBeforeUnmount\(\(\) => \{\s*flushCharacterDraftBeforeDispose\(\);\s*characterFormDisposed = true;/
  );
});

test('CharacterFormView exposes compact draft recovery controls', () => {
  assert.match(
    characterFormTemplate,
    /class="character-draft-note"[\s\S]*:class="\{ pending: pendingCharacterDraft, warning: characterDraftStatus === 'too-large' \|\| characterDraftStatus === 'error' \}"[\s\S]*aria-live="polite"/
  );
  assert.match(characterFormTemplate, /@click="restoreCharacterDraft"/);
  assert.match(characterFormTemplate, /@click="discardCharacterDraft"/);
  assert.match(
    characterFormDraftSource,
    /function restoreCharacterDraft\(\) \{[\s\S]*applyPayload\(draft\.payload\);[\s\S]*setSelectedWorldBookIds\(draft\.selectedWorldBookIds\);[\s\S]*pendingCharacterDraft\.value = null;[\s\S]*characterDraftStatus\.value = 'restored';[\s\S]*scheduleCharacterDraftSave\(\);/
  );
  assert.match(
    characterFormDraftSource,
    /function discardCharacterDraft\(\) \{[\s\S]*clearCurrentCharacterDraft\(\);[\s\S]*scheduleCharacterDraftSave\(\);/
  );
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
  assert.match(characterFormScript, /import \{ computed, onBeforeUnmount, onMounted, reactive, ref, watch \} from 'vue';/);
  assert.match(characterSectionNavigationSource, /import \{ computed, nextTick, onBeforeUnmount, onMounted, ref, watch \} from 'vue';/);
  assert.match(characterFormScript, /import \{ useCharacterCreationWizard \} from '\.\.\/composables\/character\/useCharacterCreationWizard';/);
  assert.match(characterCreationWizardSource, /const characterCreationMode = ref\('wizard'\);/);
  assert.match(characterCreationWizardSource, /const characterWizardStepId = ref\('basic'\);/);
  assert.match(
    characterCreationWizardSource,
    /export const CHARACTER_CREATION_WIZARD_STEPS = \[[\s\S]*id: 'basic'[\s\S]*sections: \['basic'\][\s\S]*id: 'settings'[\s\S]*sections: \['settings', 'ai'\][\s\S]*id: 'advanced'[\s\S]*sections: \['advanced-settings', 'status-blueprint', 'accessories', 'render-plugins', 'regex'\]/
  );
  assert.match(
    characterCreationWizardSource,
    /const isCharacterCreationWizardAvailable = computed\(\(\) => !isEditing\?\.value && canEdit\?\.value\);/
  );
  assert.match(
    characterFormScript,
    /function isSectionVisible\(section\) \{\s*return isCharacterSectionVisibleInCurrentMode\(section\.id\)[\s\S]*typeof section\.visible !== 'function' \|\| section\.visible\(\)/
  );
  assert.match(
    characterCreationWizardSource,
    /function isCharacterSectionVisibleInCurrentMode\(sectionId\) \{[\s\S]*if \(!isCharacterCreationWizardActive\.value\) \{[\s\S]*return true;[\s\S]*for \(const currentSectionId of step\.sections\) \{[\s\S]*currentSectionId === sectionId/
  );
  assert.match(
    characterCreationWizardSource,
    /function skipCharacterWizardStep\(\) \{[\s\S]*if \(nextIndex >= CHARACTER_CREATION_WIZARD_STEPS\.length\) \{[\s\S]*setCharacterCreationMode\('full'\);/
  );
  assert.match(
    characterCreationWizardSource,
    /function setCharacterWizardStep\(stepId, \{ scroll = false \} = \{\}\) \{[\s\S]*const firstSectionId = getCharacterWizardStepFirstSectionId\(stepId\);[\s\S]*scheduleSectionNavSync\(\);[\s\S]*if \(scroll\) \{[\s\S]*scrollToSection\(firstSectionId, \{ defer: true \}\);/
  );
  assert.match(
    characterSectionNavigationSource,
    /function scrollToSection\(id, \{ defer = false \} = \{\}\) \{[\s\S]*if \(defer\) \{[\s\S]*nextTick\(\(\) => scrollToSection\(id\)\);[\s\S]*return;/
  );
  assert.doesNotMatch(characterFormScript, /function scrollToCharacterWizardStep/);
  assert.doesNotMatch(characterFormScript, /function getCharacterWizardStepIndex/);
  assert.doesNotMatch(characterFormScript, /function getCurrentCharacterWizardStep/);
  assert.doesNotMatch(characterFormScript, /function setCharacterWizardStep/);
  assert.doesNotMatch(characterFormScript, /function skipCharacterWizardStep/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*CHARACTER_CREATION_WIZARD_STEPS,[\s\S]*characterCreationMode,[\s\S]*setCharacterCreationMode,[\s\S]*setCharacterWizardStep,[\s\S]*skipCharacterWizardStep[\s\S]*\} = useCharacterCreationWizard\(\{[\s\S]*isEditing,[\s\S]*canEdit,[\s\S]*setActiveSection: \(sectionId\) => \{[\s\S]*activeSection\.value = sectionId;[\s\S]*setVisibleActiveSection: \(sectionId\) => setActiveCharacterSection\(sectionId\),[\s\S]*scheduleSectionNavSync: \(\) => scheduleCharacterSectionNavSync\(\),[\s\S]*scrollToSection: \(sectionId, options\) => scrollToSection\(sectionId, options\)[\s\S]*\}\);/
  );

  assert.match(characterFormScript, /import CharacterCreationWizardPanel from '\.\.\/components\/character\/CharacterCreationWizardPanel\.vue';/);
  assert.match(
    characterFormTemplate,
    /<CharacterCreationWizardPanel[\s\S]*v-if="!loading && !loadError && isCharacterCreationWizardAvailable"[\s\S]*:active="isCharacterCreationWizardActive"[\s\S]*:current-step="currentCharacterWizardStep"[\s\S]*:progress-text="characterWizardProgressText"[\s\S]*:step-id="characterWizardStepId"[\s\S]*:step-index="characterWizardStepIndex"[\s\S]*:steps="CHARACTER_CREATION_WIZARD_STEPS"[\s\S]*@next="goToNextCharacterWizardStep"[\s\S]*@previous="goToPreviousCharacterWizardStep"[\s\S]*@set-mode="setCharacterCreationMode"[\s\S]*@set-step="setCharacterWizardStep"[\s\S]*@skip="skipCharacterWizardStep"/
  );
  assert.doesNotMatch(characterFormTemplate, /class="character-wizard-panel"/);
  assert.doesNotMatch(characterFormTemplate, /role="tablist" aria-label="角色创建向导步骤"/);
  assert.match(characterCreationWizardPanelScript, /import \{ ChevronLeft, ChevronRight, ListChecks, Settings \} from '@lucide\/vue';/);
  assert.match(characterCreationWizardPanelScript, /defineProps\(\{[\s\S]*active:[\s\S]*currentStep:[\s\S]*progressText:[\s\S]*stepId:[\s\S]*stepIndex:[\s\S]*steps:/);
  assert.match(characterCreationWizardPanelScript, /const emit = defineEmits\(\[[\s\S]*'next'[\s\S]*'previous'[\s\S]*'set-mode'[\s\S]*'set-step'[\s\S]*'skip'[\s\S]*\]\);/);
  assert.match(characterCreationWizardPanelTemplate, /class="character-wizard-panel"/);
  assert.match(characterCreationWizardPanelTemplate, /role="group" aria-label="角色创建模式"/);
  assert.match(characterCreationWizardPanelTemplate, /role="tablist" aria-label="角色创建向导步骤"/);
  assert.match(characterCreationWizardPanelTemplate, /v-for="step in steps"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('set-mode', 'full'\)"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('skip'\)"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('previous'\)"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('next'\)"/);
  assert.match(characterCreationWizardPanelTemplate, /@click="emit\('set-step', step\.id, \{ scroll: true \}\)"/);
  assert.match(characterFormScript, /import CharacterBasicInfoPanel from '\.\.\/components\/character\/CharacterBasicInfoPanel\.vue';/);
  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('basic'\)"[\s\S]*:form="form"[\s\S]*@update-field="updateCharacterFormField"/);
  assert.match(characterBasicInfoPanelTemplate, /<section id="section-basic" class="form-panel form-section-group character-basic-panel">/);
  assert.match(characterFormTemplate, /<CharacterSettingsPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('settings'\)"[\s\S]*:form="form"[\s\S]*@insert-user-variable="insertUserVariable"[\s\S]*@update-field="updateCharacterFormField"/);
  assert.match(characterSettingsPanelTemplate, /<section id="section-settings" class="form-panel form-section-group character-settings-panel">/);
  assert.match(characterFormTemplate, /v-if="canEdit && isCharacterSectionVisibleInCurrentMode\('ai'\)"/);
  assert.match(characterFormTemplate, /<CharacterAdvancedSettingsPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('advanced-settings'\)"[\s\S]*v-model:advanced-ai-requirement="advancedAiRequirement"[\s\S]*v-model:ai-use-current-draft="aiUseCurrentDraft"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /<section id="section-advanced-settings" class="form-panel advanced-settings-panel">/);
  assert.match(characterFormTemplate, /<CharacterRenderPluginPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('render-plugins'\)"[\s\S]*:render-plugins="form\.renderPlugins"[\s\S]*@add-plugin="addRenderPlugin\(true\)"[\s\S]*@remove-plugin="removeRenderPlugin"/);
  assert.match(characterRenderPluginPanelTemplate, /<section id="section-render-plugins" class="form-panel render-plugin-panel">/);
  assert.match(characterFormTemplate, /<CharacterRegexPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('regex'\)"[\s\S]*v-model:preview-input="previewInput"[\s\S]*:rules="form\.regexRules"[\s\S]*@add-rule="addRule"[\s\S]*@remove-rule="removeRule"/);
  assert.match(characterRegexPanelTemplate, /<section id="section-regex" class="form-panel regex-panel">/);

  assert.match(stylesSource, /\.character-wizard-panel\s*\{[\s\S]*display:\s*grid;[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--primary\) 28%, var\(--line\)\);/);
  assert.match(stylesSource, /\.character-wizard-steps\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(stylesSource, /@media \(max-width: 768px\) \{[\s\S]*\.character-wizard-steps\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/);
});

test('CharacterFormView load error state offers creation and navigation exits', () => {
  assert.match(
    characterFormTemplate,
    /<section v-else-if="loadError" class="form-panel empty-state error-state" role="alert">[\s\S]*@click="loadEditingCharacter"[\s\S]*@click="emit\('navigate', 'characterNew'\)"[\s\S]*创建新角色[\s\S]*@click="emit\('navigate', 'home'\)"[\s\S]*返回首页/
  );
});

test('CharacterFormView invalidates route-replacing action tokens before navigation', () => {
  assert.match(
    characterFormScript,
    /function navigateFromCharacterSubmit\(page, params\) \{\s*formSubmitToken \+= 1;\s*emit\('navigate', page, params\);\s*\}/
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
  assert.match(characterFormScript, /import \{ useCharacterFormOptions \} from '\.\.\/composables\/character\/useCharacterFormOptions';/);
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

  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:tag-creating="tagCreating"[\s\S]*@toggle-tag="toggleTagSelection"/);
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
  assert.match(characterFormScript, /import \{ useCharacterImageUploads \} from '\.\.\/composables\/character\/useCharacterImageUploads';/);
  assert.match(
    characterFormScript,
    /const \{[\s\S]*backgroundUploading,[\s\S]*cancelCharacterImageUploads,[\s\S]*clearAdvancedBackground,[\s\S]*handleAdvancedBackground,[\s\S]*handleAvatar[\s\S]*\} = useCharacterImageUploads\(\{[\s\S]*canEdit,[\s\S]*form,[\s\S]*isDisposed: \(\) => characterFormDisposed,[\s\S]*notify[\s\S]*\}\);/
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
  assert.match(characterFormScript, /import \{ useCharacterWorldBookDialog \} from '\.\.\/composables\/character\/useCharacterWorldBookDialog';/);
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

  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:selected-world-book-ids="selectedWorldBookIds"[\s\S]*:selected-world-book-preview="selectedWorldBookPreview"[\s\S]*@open-world-book-dialog="openWorldBookDialog"[\s\S]*@toggle-world-book="toggleWorldBook"/);
  assert.match(characterBasicInfoPanelTemplate, /class="field full-span world-book-field"/);
  assert.match(characterBasicInfoPanelTemplate, /class="world-book-picker-button"[\s\S]*@click="emit\('open-world-book-dialog'\)"/);
  assert.match(characterBasicInfoPanelTemplate, /class="world-book-selected-preview"/);
  assert.match(characterFormTemplate, /<CharacterWorldBookDialog[\s\S]*v-if="showWorldBookDialog"[\s\S]*v-model:search="worldBookSearch"[\s\S]*v-model:sort="worldBookSort"/);
  assert.match(characterFormTemplate, /:paged-world-books="pagedWorldBooks"[\s\S]*:filtered-world-books="filteredWorldBooks"[\s\S]*:selected-world-book-ids="selectedWorldBookIds"/);
  assert.match(characterFormTemplate, /@clear-search="clearWorldBookSearch"[\s\S]*@close="closeWorldBookDialog"[\s\S]*@page="setWorldBookPage"[\s\S]*@toggle="toggleWorldBook"/);
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
  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*:can-create-searched-tag="canCreateSearchedTag"/);
  assert.match(characterBasicInfoPanelTemplate, /v-if="canCreateSearchedTag"[\s\S]*class="ghost-button tag-create-btn"/);
  assert.doesNotMatch(characterFormScript, /availableTags\.value\.filter\(/);
  assert.doesNotMatch(characterFormScript, /function filterTagsBySearch/);
  assert.doesNotMatch(characterFormScript, /function canCreateTagFromSearch/);
  assert.doesNotMatch(characterFormTemplate, /availableTags\.some\(/);
});

test('CharacterFormView counts status blueprint variable stats in one pass', () => {
  assert.match(characterFormScript, /import \{ hasStatusBarBlueprintContent, normalizeStatusBarBlueprintForPayload, useCharacterStatusBlueprint \} from '\.\.\/composables\/character\/useCharacterStatusBlueprint';/);
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

test('CharacterFormView parses status template tokens without split arrays', () => {
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

  assert.match(usageSnippet, /const parsed = parseStatusTemplateToken\(token\);/);
  assert.match(usageSnippet, /normalizeStatusVariableKey\(parsed\.rawName\) !== target/);
  assert.match(usageSnippet, /const property = parsed\.rawProperty\.trim\(\);/);
  assert.match(inferSnippet, /const parsed = parseStatusTemplateToken\(token\);\s*const name = normalizeTemplateVariableName\(parsed\.rawName\);/);
  assert.doesNotMatch(characterStatusBlueprintSource, /token\.split\('\.'\)/);
  assert.doesNotMatch(characterStatusBlueprintSource, /propertyParts/);
});

test('CharacterFormView builds status blueprint editor rows without intermediate mapping arrays', () => {
  assert.match(
    characterStatusBlueprintSource,
    /import \{ parseStatusTemplateToken \} from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/statusTemplateTokens\.js';/
  );
  const extractPartsStart = characterStatusBlueprintSource.indexOf('function extractCompositePlaceholderParts(value = \'\', label = \'\') {');
  const extractPartsEnd = characterStatusBlueprintSource.indexOf('\nfunction isMeterTemplateProperty', extractPartsStart);
  assert.notEqual(extractPartsStart, -1);
  assert.notEqual(extractPartsEnd, -1);
  const extractPartsSnippet = characterStatusBlueprintSource.slice(extractPartsStart, extractPartsEnd);
  assert.match(extractPartsSnippet, /const parsed = parseStatusTemplateToken\(token\);/);
  assert.match(extractPartsSnippet, /const rawProperty = parsed\.rawProperty\.trim\(\) \|\| 'value';/);
  assert.match(extractPartsSnippet, /const name = normalizeTemplateVariableName\(parsed\.rawName\.trim\(\)\);/);
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
  assert.match(characterFormTemplate, /@set-composite-value="setStatusBlueprintVariableValueFromEvent"/);
  assert.match(characterFormTemplate, /@set-variable-mode="setStatusBlueprintVariableModeFromEvent"/);
  assert.match(characterFormTemplate, /@set-color="setColorValueFromEvent"/);
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
    /import \{[\s\S]*emptyCharacter,[\s\S]*hasNonDefaultAccessorySkills,[\s\S]*normalizeAccessorySkillsForPayload,[\s\S]*normalizeAdvancedSettingsForForm,[\s\S]*normalizeCharacterDraftPayload,[\s\S]*normalizeForForm,[\s\S]*parseTagsTextForPayload[\s\S]*\} from '\.\.\/composables\/character\/useCharacterFormPayload';/
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
  assert.match(snippet, /modelOverride: String\(source\.modelOverride \|\| source\.model_override \|\| ''\)\.trim\(\)/);
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
    /import \{ useCharacterRenderPlugins \} from '\.\.\/composables\/character\/useCharacterRenderPlugins';/
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
  assert.match(characterFormScript, /import \{ useCharacterRegexRules \} from '\.\.\/composables\/character\/useCharacterRegexRules';/);
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
    /function collectAllowedStatusEffects\(effects = \[\]\) \{\s*const currentEffects = Array\.isArray\(effects\) \? effects : \[\];\s*const allowedEffects = \[\];\s*for \(const effect of currentEffects\) \{\s*if \(isAllowedStatusEffect\(effect\)\) \{\s*allowedEffects\.push\(effect\);\s*\}\s*\}\s*return allowedEffects;\s*\}/
  );
  assert.match(
    characterStatusBlueprintSource,
    /function isAllowedStatusEffect\(effect\) \{\s*return effect === 'glow' \|\| effect === 'striped' \|\| effect === 'pulse';\s*\}/
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
  assert.match(characterFormScript, /import \{ useCharacterAiGeneration \} from '\.\.\/composables\/character\/useCharacterAiGeneration';/);
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
    /async function completeWithAi\(\) \{[\s\S]*setAiToolCallsIfChanged\(\[\]\);[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '等待模型响应\.\.\.', content: '', tools: \[\] \}\]\);[\s\S]*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  assert.match(
    characterAiGenerationSource,
    /setAiModSuggestionsIfChanged\(result\.character\?\.modSuggestions\);[\s\S]*setAiToolCallsIfChanged\(result\.toolCalls\);[\s\S]*setAiProcessIfChanged\(result\.process\);/
  );
  assert.match(
    characterAiGenerationSource,
    /async function completeAdvancedSettingsWithAi\(\) \{[\s\S]*setAiProcessIfChanged\(\[\{ round: 1, reasoning: '等待模型响应\.\.\.', content: '', tools: \[\] \}\]\);[\s\S]*setAiToolCallsIfChanged\(\[\]\);/
  );
  assert.match(
    characterAiGenerationSource,
    /notify\?\.success\?\.\(`已创建 \$\{suggestions\.length\} 个 Mod`\);\s*setAiModSuggestionsIfChanged\(\[\]\);/
  );
  assert.match(characterFormTemplate, /<CharacterAiDraftPanel[\s\S]*:suggested-mods-creating="suggestedModsCreating"[\s\S]*:suggestions="aiModSuggestions"[\s\S]*@create-suggested-mods="createSuggestedMods"/);
  assert.match(characterAiDraftPanelTemplate, /<CharacterAiModSuggestions[\s\S]*v-if="suggestions\.length"[\s\S]*:suggestions="suggestions"[\s\S]*:creating="suggestedModsCreating"[\s\S]*@create="emit\('create-suggested-mods'\)"/);
  assert.match(characterAiModSuggestionsScript, /import \{ ListChecks, Plus \} from '@lucide\/vue';/);
  assert.match(characterAiModSuggestionsScript, /const emit = defineEmits\(\['create'\]\);/);
  assert.match(characterAiModSuggestionsTemplate, /class="ai-mod-suggestions"/);
  assert.match(characterAiModSuggestionsTemplate, /AI Mod 建议 \{\{ suggestions\.length \}\}/);
  assert.match(characterAiModSuggestionsTemplate, /v-for="\([\s\S]*mod, index[\s\S]*\) in suggestions"/);
  assert.match(characterAiModSuggestionsTemplate, /:disabled="creating"[\s\S]*@click="emit\('create'\)"/);
  assert.match(characterAiModSuggestionsTemplate, /\{\{ creating \? '创建中\.\.\.' : '创建这些 Mod' \}\}/);
  assert.match(
    characterAiGenerationSource,
    /function aiStreamHandlers\(isCurrent = \(\) => !isDisposed\(\)\) \{[\s\S]*step: \(step = \{\}\) => \{[\s\S]*updateAiProcessStep\(step\.round \|\| 1, \(target\) => \(\{[\s\S]*tools: target\.tools\?\.length \? target\.tools : cloneAiToolList\(step\.tools\)[\s\S]*tool: \(call = \{\}\) => \{[\s\S]*updateAiProcessStep\(call\.round \|\| 1, \(target\) => \(\{[\s\S]*tools: appendAiToolList\(target\.tools, log\)[\s\S]*appendAiToolCall\(log\);/
  );
  assert.match(characterFormTemplate, /<CharacterAiDraftPanel[\s\S]*:process="aiProcess"[\s\S]*:reasoning="aiReasoning"[\s\S]*:tool-calls="aiToolCalls"/);
  assert.match(characterAiDraftPanelTemplate, /<CharacterAiProcessPanel[\s\S]*v-if="process\.length \|\| toolCalls\.length"[\s\S]*:process="process"[\s\S]*:reasoning="reasoning"[\s\S]*:tool-calls="toolCalls"/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-process-text empty">等待模型返回本轮流程\.\.\.<\/p>/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-tool-detail"[\s\S]*<strong>参数<\/strong>[\s\S]*<strong>结果<\/strong>/);
  assert.match(characterAiProcessPanelTemplate, /class="ai-tool-detail-list standalone"[\s\S]*v-for="\(call, index\) in toolCalls"[\s\S]*class="ai-tool-detail"/);
  assert.doesNotMatch(characterAiProcessPanelTemplate, /class="ai-tool-detail" open/);
  assert.ok(countMatches(characterAiGenerationSource, /setAiProcessIfChanged\(\[\{ round: 1, reasoning: err\?\.message \|\| '[^']+', content: '', tools: \[\] \}\]\);/g) >= 2);
  assert.doesNotMatch(characterAiGenerationSource, /aiToolCalls\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /aiProcess\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /aiModSuggestions\.value\s*=(?!=)/);
  assert.doesNotMatch(characterAiGenerationSource, /(?:aiToolCalls|aiProcess)\.value\.(?:push|splice|unshift|shift|pop)\(/);
  assert.doesNotMatch(characterAiGenerationSource, /target\.tools\.push\(/);
  assert.doesNotMatch(characterAiGenerationSource, /function ensureAiProcessStep/);
  assert.doesNotMatch(characterFormScript, /function aiStreamHandlers/);
  assert.doesNotMatch(characterFormScript, /function setAiToolCallsIfChanged/);
});

test('CharacterFormView uses granular sticky section navigation', () => {
  assert.match(characterFormScript, /import \{ useCharacterSectionNavigation \} from '\.\.\/composables\/character\/useCharacterSectionNavigation';/);
  assert.match(characterSectionNavigationSource, /const sectionNavRef = ref\(null\);/);
  assert.match(characterSectionNavigationSource, /let sectionNavRafId = null;/);
  assert.match(
    characterFormScript,
    /const formSections = \[[\s\S]*id: 'basic'[\s\S]*id: 'settings'[\s\S]*id: 'ai'[\s\S]*id: 'status-blueprint'[\s\S]*id: 'render-plugins'[\s\S]*id: 'regex'[\s\S]*\];/
  );
  assert.match(
    characterFormScript,
    /const \{[\s\S]*activeSection,[\s\S]*cancelCharacterSectionNavSync,[\s\S]*scheduleCharacterSectionNavSync,[\s\S]*scrollToSection,[\s\S]*sectionNavRef,[\s\S]*setActiveCharacterSection,[\s\S]*visibleFormSections[\s\S]*\} = useCharacterSectionNavigation\(\{[\s\S]*sections: formSections,[\s\S]*isSectionVisible[\s\S]*\}\);/
  );
  assert.match(characterSectionNavigationSource, /const visibleFormSections = computed\(getVisibleFormSections\);/);
  assert.match(
    characterSectionNavigationSource,
    /function getVisibleFormSections\(\) \{[\s\S]*const nextSections = \[\];[\s\S]*for \(const section of sections\) \{[\s\S]*if \(isSectionVisible\(section\)\) \{[\s\S]*nextSections\.push\(section\);[\s\S]*return nextSections;/
  );
  assert.match(
    characterSectionNavigationSource,
    /function hasVisibleFormSection\(sectionId, nextSections = visibleFormSections\.value\) \{[\s\S]*for \(const section of nextSections\) \{[\s\S]*if \(section\.id === sectionId\) \{[\s\S]*return true;[\s\S]*return false;/
  );
  assert.doesNotMatch(characterFormScript, /let characterScrollListenerTarget = null;/);
  assert.doesNotMatch(characterFormScript, /function getVisibleFormSections/);
  assert.doesNotMatch(characterFormScript, /function hasVisibleFormSection/);
  assert.doesNotMatch(characterFormScript, /function getCharacterScrollContainer/);
  assert.doesNotMatch(characterFormScript, /function getCharacterSectionTarget/);
  assert.doesNotMatch(characterFormScript, /function syncActiveSectionFromScroll/);
  assert.doesNotMatch(characterFormScript, /getCharacterScrollContainer|useCharacterAiPanelLayout/);
  assert.match(
    characterSectionNavigationSource,
    /function getCharacterScrollContainer\(\) \{[\s\S]*sectionNavRef\.value\?\.closest\?\.\('\.page-shell'\)[\s\S]*document\.querySelector\('\.page-shell'\);[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function getCharacterScrollTop\(\) \{[\s\S]*const scroller = getCharacterScrollContainer\(\);[\s\S]*return scroller \? scroller\.scrollTop : window\.scrollY \|\| 0;[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function scrollCharacterPageTo\(top\) \{[\s\S]*const roundedTop = Math\.max\(0, Math\.round\(top\)\);[\s\S]*scroller\.scrollTo\(\{ top: roundedTop, behavior: 'smooth' \}\);[\s\S]*window\.scrollTo\(\{ top: roundedTop, behavior: 'smooth' \}\);[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function getCharacterScrollState\(\) \{[\s\S]*clientHeight: scroller\.clientHeight,[\s\S]*scrollHeight: scroller\.scrollHeight[\s\S]*document\.documentElement\?\.scrollHeight[\s\S]*window\.innerHeight[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function syncCharacterScrollListener\(\) \{[\s\S]*characterScrollListenerTarget\.removeEventListener\('scroll', onCharacterScroll\);[\s\S]*characterScrollListenerTarget = nextTarget;[\s\S]*characterScrollListenerTarget\.addEventListener\('scroll', onCharacterScroll, \{ passive: true \}\);[\s\S]*\}/
  );
  assert.match(
    characterFormScript,
    /onBeforeUnmount\(\(\) => \{[\s\S]*cancelCharacterSectionNavSync\(\);[\s\S]*\}\);/
  );
  assert.match(
    characterSectionNavigationSource,
    /function disposeCharacterSectionNavigation\(\) \{[\s\S]*cancelCharacterSectionNavSync\(\);[\s\S]*stopCharacterScrollListener\(\);[\s\S]*window\.removeEventListener\('resize', onWindowResize\);[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function scrollToSection\(id, \{ defer = false \} = \{\}\) \{[\s\S]*getCharacterSectionTarget\(id\)[\s\S]*const top = scrollTarget\.getBoundingClientRect\(\)\.top \+ getCharacterScrollTop\(\) - getCharacterSectionActivationOffset\(\);[\s\S]*scrollCharacterPageTo\(top\);/
  );
  assert.match(
    characterCreationWizardSource,
    /setCharacterWizardStep\(stepId, \{ scroll = false \} = \{\}\) \{[\s\S]*scrollToSection\(firstSectionId, \{ defer: true \}\);/
  );
  assert.match(
    characterSectionNavigationSource,
    /function getTopbarBottom\(\) \{[\s\S]*document\.querySelector\('\.topbar'\)\?\.getBoundingClientRect\(\)\.bottom;/
  );
  assert.match(
    characterSectionNavigationSource,
    /function syncCharacterSectionNavMetrics\(\) \{[\s\S]*nav\.style\.setProperty\('--character-section-nav-top', `\$\{getTopbarBottom\(\)\}px`\);/
  );
  assert.match(
    characterSectionNavigationSource,
    /function syncActiveSectionFromScroll\(\) \{[\s\S]*getCharacterSectionActivationOffset\(\)[\s\S]*setActiveCharacterSection\(nextSectionId\);/
  );
  assert.match(
    characterSectionNavigationSource,
    /function getCharacterSectionActivationOffset\(\) \{[\s\S]*const navBottom = sectionNavRef\.value\?\.getBoundingClientRect\(\)\.bottom;[\s\S]*if \(Number\.isFinite\(navBottom\)\) \{[\s\S]*return Math\.max\(0, Math\.ceil\(navBottom\)\) \+ 14;[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function syncActiveSectionFromScroll\(\) \{[\s\S]*for \(const section of visibleFormSections\.value\) \{[\s\S]*const target = getCharacterSectionTarget\(section\.id\);[\s\S]*lastSectionId = section\.id;[\s\S]*const scrollState = getCharacterScrollState\(\);[\s\S]*if \(lastSectionId && scrollState\.clientHeight \+ scrollState\.scrollTop >= scrollState\.scrollHeight - 2\) \{[\s\S]*nextSectionId = lastSectionId;/
  );
  assert.doesNotMatch(characterFormScript, /window\.addEventListener\('scroll', onWindowScroll/);
  assert.doesNotMatch(characterFormScript, /window\.removeEventListener\('scroll', onWindowScroll\)/);
  assert.doesNotMatch(characterSectionNavigationSource, /visibleFormSections\.value\s*\.\s*map/);
  assert.doesNotMatch(characterSectionNavigationSource, /visibleFormSections\.value[\s\S]{0,120}\.filter/);
  assert.doesNotMatch(characterSectionNavigationSource, /sections\.filter\(isSectionVisible\)/);
  assert.doesNotMatch(characterSectionNavigationSource, /visibleFormSections\.value\s*\.\s*some/);
  assert.doesNotMatch(characterSectionNavigationSource, /sections\.some\(\(section\) => section\.id === activeSection\.value\)/);
  assert.match(
    characterSectionNavigationSource,
    /tab\.scrollIntoView\(\{ behavior: 'auto', block: 'nearest', inline: 'center' \}\);/
  );

  assert.match(characterFormTemplate, /ref="sectionNavRef" class="form-section-nav character-section-nav"/);
  assert.match(characterFormTemplate, /v-for="section in visibleFormSections"/);
  assert.match(characterFormTemplate, /:data-section-id="section\.id"/);
  assert.match(characterFormTemplate, /:aria-current="activeSection === section\.id \? 'true' : undefined"/);
  assert.match(characterFormTemplate, /<CharacterAiDraftPanel[\s\S]*id="section-ai"/);
  assert.match(characterFormTemplate, /id="section-images" class="form-panel character-image-section"/);
  assert.match(characterFormScript, /import CharacterTalentPanel from '\.\.\/components\/character\/CharacterTalentPanel\.vue';/);
  assert.doesNotMatch(characterFormScript, /const showTalentDialog = ref\(false\);/);
  assert.match(characterFormTemplate, /<CharacterTalentPanel[\s\S]*v-if="isEditing && editingCharacterId && isCharacterSectionVisibleInCurrentMode\('talents'\)"[\s\S]*:character-id="editingCharacterId"[\s\S]*:character-name="form\.name"[\s\S]*:can-edit="canEdit"/);
  assert.match(characterTalentPanelScript, /import \{ Dice6 \} from '@lucide\/vue';/);
  assert.match(characterTalentPanelScript, /import TalentRollDialog from '\.\.\/TalentRollDialog\.vue';/);
  assert.match(characterTalentPanelScript, /const showTalentDialog = ref\(false\);/);
  assert.match(characterTalentPanelTemplate, /id="section-talents" class="form-panel talent-panel"/);
  assert.match(characterTalentPanelTemplate, /class="ghost-button" type="button" @click="showTalentDialog = true"[\s\S]*<Dice6 :size="17" \/>/);
  assert.match(characterTalentPanelTemplate, /<TalentRollDialog[\s\S]*v-if="showTalentDialog"[\s\S]*:character-id="characterId"[\s\S]*:character-name="characterName"[\s\S]*:can-edit="canEdit"[\s\S]*@close="showTalentDialog = false"/);
  assert.match(characterFormTemplate, /<CharacterAdvancedSettingsPanel[\s\S]*:advanced-settings="form\.authorAdvancedSettings"[\s\S]*:status-bar-blueprint-template-stats="statusBarBlueprintTemplateStats"[\s\S]*:status-blueprint-editor-rows="statusBlueprintEditorRows"/);
  assert.match(characterAdvancedSettingsPanelScript, /import \{ Settings, Upload, WandSparkles \} from '@lucide\/vue';/);
  assert.match(characterAdvancedSettingsPanelScript, /import CharacterStatusBlueprintEditor from '\.\/CharacterStatusBlueprintEditor\.vue';/);
  assert.match(characterAdvancedSettingsPanelTemplate, /<section id="section-advanced-settings" class="form-panel advanced-settings-panel">/);
  assert.match(characterAdvancedSettingsPanelScript, /function readInputValue\(event\) \{[\s\S]*event\?\.target\?\.value[\s\S]*typeof value === 'string' \? value : ''/);
  assert.match(characterAdvancedSettingsPanelScript, /function readInputChecked\(event\) \{[\s\S]*Boolean\(event\?\.target\?\.checked\)/);
  assert.match(characterAdvancedSettingsPanelTemplate, /:value="advancedAiRequirement"[\s\S]*@input="emit\('update:advancedAiRequirement', readInputValue\(\$event\)\)"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /:checked="aiUseCurrentDraft"[\s\S]*@change="emit\('update:aiUseCurrentDraft', readInputChecked\(\$event\)\)"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /@click="emit\('complete-ai'\)"[\s\S]*<WandSparkles :size="17" \/>/);
  assert.match(characterAdvancedSettingsPanelTemplate, /v-model="advancedSettings\.desktopBackgroundUrl"[\s\S]*@change="emit\('background-change', \$event, 'desktopBackgroundUrl'\)"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /v-model="advancedSettings\.customCssEnabled"[\s\S]*type="checkbox"[\s\S]*启用角色自定义 CSS/);
  assert.match(characterAdvancedSettingsPanelTemplate, /v-model="advancedSettings\.customCssRiskAccepted"[\s\S]*type="checkbox"[\s\S]*确认风险并允许角色 CSS 生效/);
  assert.match(characterAdvancedSettingsPanelTemplate, /v-model="advancedSettings\.customJsEnabled"[\s\S]*type="checkbox"[\s\S]*启用角色自定义 JS/);
  assert.match(characterAdvancedSettingsPanelTemplate, /v-model="advancedSettings\.customJsRiskAccepted"[\s\S]*type="checkbox"[\s\S]*确认风险并允许角色 JS 执行/);
  assert.match(characterFormScript, /customCssEnabled: form\.authorAdvancedSettings\.customCssEnabled/);
  assert.match(characterFormScript, /customCssRiskAccepted: form\.authorAdvancedSettings\.customCssRiskAccepted/);
  assert.match(characterFormScript, /customJsEnabled: form\.authorAdvancedSettings\.customJsEnabled/);
  assert.match(characterFormScript, /customJsRiskAccepted: form\.authorAdvancedSettings\.customJsRiskAccepted/);
  assert.match(characterFormScript, /'customCssEnabled'[\s\S]*'customJsEnabled'/);
  assert.match(characterFormScript, /\['customCssRiskAccepted', 'customJsRiskAccepted'\]/);
  assert.match(characterAdvancedSettingsPanelTemplate, /<CharacterStatusBlueprintEditor[\s\S]*:blueprint="advancedSettings\.statusBarBlueprint"[\s\S]*:rows="statusBlueprintEditorRows"[\s\S]*:stats="statusBarBlueprintTemplateStats"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /@set-color="\(\.\.\.args\) => emit\('set-color', \.\.\.args\)"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /@set-composite-value="\(\.\.\.args\) => emit\('set-composite-value', \.\.\.args\)"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /@set-variable-mode="\(\.\.\.args\) => emit\('set-variable-mode', \.\.\.args\)"/);
  assert.match(characterStatusBlueprintEditorTemplate, /id="section-status-blueprint" class="accessory-defaults-panel status-blueprint-panel"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /id="section-accessories" class="accessory-defaults-panel"/);
  assert.match(characterFormTemplate, /<CharacterRenderPluginPanel[\s\S]*:enabled-render-plugins="enabledRenderPlugins"[\s\S]*:preview-text="renderPluginPreviewText"[\s\S]*:render-plugins="form\.renderPlugins"/);
  assert.match(characterRenderPluginPanelScript, /import \{ Plus, Trash2 \} from '@lucide\/vue';/);
  assert.match(characterRenderPluginPanelScript, /import MarkdownContent from '\.\.\/MarkdownContent\.vue';/);
  assert.match(characterRenderPluginPanelTemplate, /<section id="section-render-plugins" class="form-panel render-plugin-panel">/);
  assert.match(characterRenderPluginPanelTemplate, /v-for="\(plugin, index\) in renderPlugins"[\s\S]*v-model="plugin\.label"[\s\S]*v-model="plugin\.pattern"[\s\S]*v-model="plugin\.titleTemplate"[\s\S]*v-model="plugin\.flags"/);
  assert.match(characterRenderPluginPanelTemplate, /@click="emit\('remove-plugin', index\)"[\s\S]*<Trash2 :size="17" \/>/);
  assert.match(characterRenderPluginPanelTemplate, /<MarkdownContent[\s\S]*v-if="previewText"[\s\S]*:text="previewText"[\s\S]*:render-plugins="enabledRenderPlugins"/);
  assert.match(characterFormTemplate, /<CharacterRegexPanel[\s\S]*:regex-preview="regexPreview"[\s\S]*:rules="form\.regexRules"/);
  assert.match(characterRegexPanelScript, /import \{ computed \} from 'vue';/);
  assert.match(characterRegexPanelScript, /import \{ Plus, Trash2 \} from '@lucide\/vue';/);
  assert.match(characterRegexPanelScript, /const previewInputModel = computed\(\{[\s\S]*get: \(\) => props\.previewInput,[\s\S]*set: \(value\) => emit\('update:previewInput', value\)[\s\S]*\}\);/);
  assert.match(characterRegexPanelTemplate, /<section id="section-regex" class="form-panel regex-panel">/);
  assert.match(characterRegexPanelTemplate, /v-for="\(rule, index\) in rules"[\s\S]*v-model="rule\.label"[\s\S]*v-model="rule\.pattern"[\s\S]*v-model="rule\.replacement"[\s\S]*v-model="rule\.flags"[\s\S]*v-model="rule\.scope"[\s\S]*v-model="rule\.groupName"[\s\S]*v-model\.number="rule\.priority"/);
  assert.match(characterRegexPanelTemplate, /@click="emit\('remove-rule', index\)"[\s\S]*<Trash2 :size="17" \/>/);
  assert.match(characterRegexPanelTemplate, /<input v-model="previewInputModel" placeholder="输入一段文本测试正则替换效果" \/>[\s\S]*<p v-if="previewInput\.trim\(\)">\{\{ regexPreview \}\}<\/p>/);

  assert.match(
    stylesSource,
    /\.character-section-nav\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*calc\(var\(--character-section-nav-top, 78px\) \+ env\(safe-area-inset-top, 0px\)\);[\s\S]*backdrop-filter:\s*blur\(16px\);/
  );
  assert.match(
    stylesSource,
    /\.workspace-layout-shell \.character-section-nav,\s*\.workspace-layout-shell \.settings-section-nav\s*\{[\s\S]*top:\s*calc\(-1 \* var\(--workspace-page-padding-top, 28px\)\);[\s\S]*\}/
  );
  assert.match(stylesSource, /\.character-section-nav::-webkit-scrollbar\s*\{[^}]*height:\s*8px;/);
  assert.match(stylesSource, /\.character-section-nav \.form-section-tab::after\s*\{[\s\S]*transform:\s*scaleX\(0\.36\);/);
  assert.match(stylesSource, /\.character-section-nav \.form-section-tab\.active::after\s*\{[^}]*transform:\s*scaleX\(1\);/);
  assert.match(stylesSource, /#section-basic,[\s\S]*#section-status-blueprint,[\s\S]*#section-regex\s*\{[^}]*scroll-margin-top:\s*150px;/);
  assert.match(stylesSource, /@keyframes character-nav-settle/);
});

test('CharacterFormView uses a flowing card layout and modal status preview', () => {
  assert.match(characterFormScript, /const showStatusPreviewDialog = ref\(false\);/);
  assert.match(
    characterFormScript,
    /function updateCharacterFormField\(key, value\) \{[\s\S]*Object\.prototype\.hasOwnProperty\.call\(form, key\)[\s\S]*form\[key\] = value;[\s\S]*\}/
  );
  assert.match(
    characterSectionNavigationSource,
    /function getCharacterSectionTarget\(id\) \{[\s\S]*return el\.getClientRects\(\)\.length[\s\S]*el\.querySelector\('\.form-panel, \.form-section-group, \[id\^="section-"\]'\) \|\| el;/
  );
  assert.doesNotMatch(characterFormScript, /function getCharacterSectionTarget/);

  assert.match(characterFormTemplate, /<div class="character-main-sections">/);
  assert.match(characterFormTemplate, /<CharacterBasicInfoPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('basic'\)"[\s\S]*@avatar-change="handleAvatar"[\s\S]*@update-field="updateCharacterFormField"/);
  assert.match(characterBasicInfoPanelScript, /import \{ ListChecks, Plus, RotateCcw, Upload, X \} from '@lucide\/vue';/);
  assert.match(characterBasicInfoPanelScript, /const emit = defineEmits\(\[[\s\S]*'avatar-change'[\s\S]*'update-field'[\s\S]*'update:tagSearch'[\s\S]*\]\);/);
  assert.match(characterBasicInfoPanelTemplate, /<section id="section-basic" class="form-panel form-section-group character-basic-panel">/);
  assert.match(characterFormTemplate, /<CharacterSettingsPanel[\s\S]*v-if="isCharacterSectionVisibleInCurrentMode\('settings'\)"[\s\S]*@insert-user-variable="insertUserVariable"[\s\S]*@update-field="updateCharacterFormField"/);
  assert.match(characterSettingsPanelScript, /import VariableEditor from '\.\.\/VariableEditor\.vue';/);
  assert.match(characterSettingsPanelScript, /const SETTINGS_FIELDS = \[[\s\S]*key: 'background'[\s\S]*key: 'worldview'[\s\S]*key: 'persona'[\s\S]*key: 'openingMessage'/);
  assert.match(characterSettingsPanelTemplate, /<section id="section-settings" class="form-panel form-section-group character-settings-panel">/);
  assert.match(characterSettingsPanelTemplate, /v-for="field in SETTINGS_FIELDS"[\s\S]*@click="emit\('insert-user-variable', field\.key\)"[\s\S]*<VariableEditor[\s\S]*:model-value="form\[field\.key\]"[\s\S]*@update:model-value="emit\('update-field', field\.key, \$event\)"/);
  assert.match(characterFormTemplate, /<div id="section-advanced" class="form-section-group-advanced">/);
  assert.match(characterFormTemplate, /<CharacterAdvancedSettingsPanel[\s\S]*@preview-status="showStatusPreviewDialog = true"/);
  assert.match(characterAdvancedSettingsPanelTemplate, /<CharacterStatusBlueprintEditor[\s\S]*@preview="emit\('preview-status'\)"/);
  assert.match(characterStatusBlueprintEditorTemplate, /class="status-blueprint-heading-actions"[\s\S]*emit\('preview'\)[\s\S]*<Eye :size="16" \/>/);
  assert.doesNotMatch(characterFormTemplate, /<div class="status-blueprint-preview">/);
  assert.match(characterFormTemplate, /<CharacterStatusPreviewDialog[\s\S]*v-if="showStatusPreviewDialog"[\s\S]*:status-bar="statusBarBlueprintPreview"[\s\S]*:template-config="statusBarBlueprintPreviewConfig"[\s\S]*@close="showStatusPreviewDialog = false"/);
  assert.match(characterStatusPreviewDialogScript, /import \{ X \} from '@lucide\/vue';/);
  assert.match(characterStatusPreviewDialogScript, /import StatusBar from '\.\.\/StatusBar\.vue';/);
  assert.match(characterStatusPreviewDialogScript, /const emit = defineEmits\(\['close'\]\);/);
  assert.match(characterStatusPreviewDialogTemplate, /class="status-preview-overlay" @click\.self="emit\('close'\)"/);
  assert.match(characterStatusPreviewDialogTemplate, /class="status-preview-dialog form-panel"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(characterStatusPreviewDialogTemplate, /aria-label="关闭效果预览"[\s\S]*emit\('close'\)[\s\S]*<X :size="18" \/>/);
  assert.match(characterStatusPreviewDialogTemplate, /<StatusBar[\s\S]*v-if="statusBar"[\s\S]*:template-config="templateConfig"/);

  assert.match(stylesSource, /\.editor-layout\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*flex-start;/);
  assert.match(stylesSource, /\.character-main-sections,\s*\.editor-side,\s*\.form-section-group-advanced\s*\{[^}]*display:\s*contents;/);
  assert.match(stylesSource, /\.editor-layout \.character-settings-panel,[\s\S]*\.editor-layout \.advanced-settings-panel\s*\{[^}]*flex-basis:\s*640px;/);
  assert.match(stylesSource, /\.status-preview-overlay\s*\{[^}]*position:\s*fixed;[^}]*place-items:\s*center;/);
  assert.match(stylesSource, /\.status-preview-dialog\s*\{[^}]*width:\s*min\(720px, calc\(100vw - 32px\)\);[^}]*max-height:/);
  assert.doesNotMatch(stylesSource, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(300px,\s*430px\)/);
});

test('CharacterFormView uses an inline AI workbench without covering the form', () => {
  assert.doesNotMatch(characterFormScript, /useCharacterAiPanelLayout|aiPanelDragging|aiPanelSize|aiPanelPos/);
  assert.doesNotMatch(characterAiDraftPanelScript, /dragging|panelPosition|panelSize|defineExpose/);
  assert.doesNotMatch(characterAiDraftPanelTemplate, /pointerdown|resize-handle|reset-panel|--ai-panel/);
  assert.match(characterAiDraftPanelTemplate, /class="ai-workbench-config"[\s\S]*class="ai-workbench-results"/);
  assert.match(characterAiDraftPanelTemplate, /class="ai-workbench-status" :class="\{ loading \}" aria-live="polite"/);

  assert.match(
    stylesSource,
    /\.ai-draft-panel\s*\{[^}]*position:\s*relative;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*padding:\s*0;/
  );
  assert.doesNotMatch(stylesSource, /\.ai-draft-panel\s*\{[^}]*position:\s*fixed;/);
  assert.doesNotMatch(stylesSource, /\.ai-draft-panel\s*\{[^}]*resize:\s*both;/);
  assert.match(stylesSource, /\.editor-layout \.ai-draft-panel\s*\{[^}]*flex:\s*1 1 100%;[^}]*min-width:\s*0;/);
  assert.match(stylesSource, /\.ai-workbench-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(stylesSource, /@media \(min-width: 980px\) \{[\s\S]*\.ai-workbench-grid\.has-output\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.08fr\) minmax\(360px, 0\.92fr\);/);
  assert.match(stylesSource, /\.ai-workbench-results\s*\{[^}]*border-left:\s*1px solid/);
  assert.match(stylesSource, /\.ai-draft-panel \.field textarea\s*\{[^}]*height:\s*132px;[^}]*max-height:\s*280px;[^}]*resize:\s*vertical;/);
  assert.doesNotMatch(stylesSource, /padding-right:\s*min\(444px, 42vw\)/);
});

test('CharacterFormView keeps mobile AI assistant output inside the viewport', () => {
  assert.match(
    stylesSource,
    /\.ai-draft-panel\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/
  );
  assert.match(
    stylesSource,
    /\.ai-process-panel\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/
  );
  assert.match(
    stylesSource,
    /\.ai-process-detail-scroll\s*\{[^}]*display:\s*grid;[^}]*max-height:\s*min\(420px, 48dvh\);[^}]*overflow:\s*auto;/
  );
  assert.match(
    stylesSource,
    /\.ai-process-summary\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*-webkit-line-clamp:\s*3;/
  );
  assert.match(
    stylesSource,
    /\.ai-scope-disclosure\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 900px\) \{[\s\S]*\.ai-workbench-results\s*\{[^}]*border-top:\s*1px solid[^}]*border-left:\s*0;/
  );
  assert.match(
    stylesSource,
    /\.ai-config-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/
  );
  assert.match(
    stylesSource,
    /\.character-editor-workbench \.editor-side \.form-actions\s*\{[^}]*position:\s*static;[^}]*bottom:\s*auto;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/
  );
  assert.match(stylesSource, /\.ai-tool-detail pre\s*\{[^}]*max-height:\s*220px;[^}]*overflow:\s*auto;/);
});
