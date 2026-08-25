<script setup>
import { inject } from 'vue';
import CharacterImagePanel from '../CharacterImagePanel.vue';
import CharacterAccessorySkillsPanel from './CharacterAccessorySkillsPanel.vue';
import CharacterAiDraftPanel from './CharacterAiDraftPanel.vue';
import CharacterAuthorSettingsPanel from './CharacterAuthorSettingsPanel.vue';
import CharacterBasicInfoPanel from './CharacterBasicInfoPanel.vue';
import CharacterCustomCodePanel from './CharacterCustomCodePanel.vue';
import CharacterRegexPanel from './CharacterRegexPanel.vue';
import CharacterRenderPluginPanel from './CharacterRenderPluginPanel.vue';
import CharacterSettingsPanel from './CharacterSettingsPanel.vue';
import CharacterStatusBarPanel from './CharacterStatusBarPanel.vue';
import CharacterTalentPanel from './CharacterTalentPanel.vue';
import { CHARACTER_EDITOR_KEY } from '../../composables/character/useCharacterEditor';

defineProps({
  sectionId: { type: String, required: true }
});

// Single source of truth for section -> panel bindings. Both the desktop and
// the mobile shell render through here so the two can never drift apart.
const editor = inject(CHARACTER_EDITOR_KEY);
</script>

<template>
  <CharacterBasicInfoPanel
    v-if="sectionId === 'basic'"
    v-model:tag-search="editor.tagSearch"
    :can-create-searched-tag="editor.canCreateSearchedTag"
    :can-edit="editor.canEdit"
    :filtered-tags="editor.filteredTags"
    :form="editor.form"
    :hidden-selected-world-book-count="editor.hiddenSelectedWorldBookCount"
    :name-error="editor.nameError"
    :options-load-error="editor.optionsLoadError"
    :options-loading="editor.optionsLoading"
    :selected-world-book-ids="editor.selectedWorldBookIds"
    :selected-world-book-preview="editor.selectedWorldBookPreview"
    :tag-creating="editor.tagCreating"
    :user-variable-value="editor.userVariableValue"
    :world-books="editor.worldBooks"
    @avatar-change="editor.handleAvatar"
    @avatar-clear="editor.clearAvatar"
    @create-tag="editor.createAndSelectTag"
    @name-blur="editor.validateCharacterName()"
    @open-world-book-dialog="editor.openWorldBookDialog"
    @retry-options="editor.loadFormOptions"
    @toggle-tag="editor.toggleTagSelection"
    @toggle-world-book="editor.toggleWorldBook"
    @update-field="editor.updateCharacterFormField"
  />

  <CharacterSettingsPanel
    v-else-if="sectionId === 'settings'"
    :can-edit="editor.canEdit"
    :form="editor.form"
    :user-variable-value="editor.userVariableValue"
    @insert-user-variable="editor.insertUserVariable"
    @update-field="editor.updateCharacterFormField"
  />

  <CharacterAiDraftPanel
    v-else-if="sectionId === 'ai'"
    id="section-ai"
    v-model:requirement="editor.aiRequirement"
    v-model:assistant-model="editor.assistantModel"
    v-model:use-current-draft="editor.aiUseCurrentDraft"
    :disabled="editor.characterAiActionBusy"
    :loading="editor.aiLoading"
    :model-options="editor.assistantModelOptions"
    :options="editor.aiOptions"
    :process="editor.aiProcess"
    :reasoning="editor.aiReasoning"
    :suggested-mods-creating="editor.suggestedModsCreating"
    :suggestions="editor.aiModSuggestions"
    :tool-calls="editor.aiToolCalls"
    @complete="editor.completeWithAi"
    @create-suggested-mods="editor.createSuggestedMods"
    @set-option="editor.setAiOptionValue"
    @stop="editor.stopCharacterAi"
  />

  <section v-else-if="sectionId === 'images'" id="section-images" class="form-panel character-image-section">
    <CharacterImagePanel :character-id="editor.editingCharacterId" :disabled="!editor.canEdit" />
  </section>

  <CharacterTalentPanel
    v-else-if="sectionId === 'talents'"
    :character-id="editor.editingCharacterId"
    :character-name="editor.form.name"
    :can-edit="editor.canEdit"
  />

  <CharacterAuthorSettingsPanel
    v-else-if="sectionId === 'advanced-settings'"
    v-model:advanced-ai-requirement="editor.advancedAiRequirement"
    v-model:ai-use-current-draft="editor.aiUseCurrentDraft"
    :advanced-ai-loading="editor.advancedAiLoading"
    :advanced-settings="editor.form.authorAdvancedSettings"
    :background-uploading="editor.backgroundUploading"
    :can-edit="editor.canEdit"
    :character-ai-action-busy="editor.characterAiActionBusy"
    @background-change="editor.handleAdvancedBackground"
    @clear-background="editor.clearAdvancedBackground"
    @complete-ai="editor.completeAdvancedSettingsWithAi"
    @stop-ai="editor.stopAdvancedAi"
  />

  <CharacterStatusBarPanel
    v-else-if="sectionId === 'status-blueprint'"
    :advanced-settings="editor.form.authorAdvancedSettings"
    :can-edit="editor.canEdit"
    :status-bar-blueprint-template-stats="editor.statusBarBlueprintTemplateStats"
    :status-blueprint-editor-rows="editor.statusBlueprintEditorRows"
    @add-status-variable="editor.addStatusBlueprintVariable"
    @clear-status-template="editor.clearStatusBlueprintTemplate"
    @preview-status="editor.showStatusPreviewDialog = true"
    @remove-status-variable="editor.removeStatusBlueprintVariable"
    @sample-status-template="editor.applyStatusBlueprintSampleTemplate"
    @set-color="editor.setColorValueFromEvent"
    @set-composite-value="editor.setStatusBlueprintVariableValueFromEvent"
    @set-variable-mode="editor.setStatusBlueprintVariableModeFromEvent"
    @sync-status-template="editor.refreshStatusBlueprintVariables"
  />

  <CharacterAccessorySkillsPanel
    v-else-if="sectionId === 'accessories'"
    :accessory-skill-items="editor.accessorySkillItems"
    :advanced-settings="editor.form.authorAdvancedSettings"
    :can-edit="editor.canEdit"
    :model-override-options="editor.modelOverrideOptions"
  />

  <CharacterCustomCodePanel
    v-else-if="sectionId === 'custom-code'"
    :advanced-settings="editor.form.authorAdvancedSettings"
    :can-edit="editor.canEdit"
  />

  <CharacterRenderPluginPanel
    v-else-if="sectionId === 'render-plugins'"
    :can-edit="editor.canEdit"
    :enabled-render-plugins="editor.enabledRenderPlugins"
    :preview-text="editor.renderPluginPreviewText"
    :render-plugins="editor.form.renderPlugins"
    @add-plugin="editor.addRenderPlugin(true)"
    @remove-plugin="editor.removeRenderPlugin"
  />

  <CharacterRegexPanel
    v-else-if="sectionId === 'regex'"
    v-model:preview-input="editor.previewInput"
    :can-edit="editor.canEdit"
    :regex-preview="editor.regexPreview"
    :rules="editor.form.regexRules"
    @add-rule="editor.addRule"
    @remove-rule="editor.removeRule"
  />
</template>
