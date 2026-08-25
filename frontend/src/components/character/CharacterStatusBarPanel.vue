<script setup>
import CharacterStatusBlueprintEditor from './CharacterStatusBlueprintEditor.vue';

defineProps({
  advancedSettings: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  statusBarBlueprintTemplateStats: { type: Object, required: true },
  statusBlueprintEditorRows: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'add-status-variable',
  'clear-status-template',
  'preview-status',
  'remove-status-variable',
  'sample-status-template',
  'set-color',
  'set-composite-value',
  'set-variable-mode',
  'sync-status-template'
]);
</script>

<template>
  <section id="section-status-blueprint" class="form-panel character-panel">
    <header class="character-panel-head">
      <div>
        <h2>状态栏</h2>
        <p>定义提示词、变量和初始模板，新会话会以此作为状态栏起点。</p>
      </div>
    </header>

    <div class="character-panel-body">
      <label class="field">
        <span>状态栏提示词</span>
        <textarea
          v-model="advancedSettings.statusBarPrompt"
          rows="4"
          placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
          :disabled="!canEdit"
        />
      </label>
      <CharacterStatusBlueprintEditor
        :blueprint="advancedSettings.statusBarBlueprint"
        :can-edit="canEdit"
        :rows="statusBlueprintEditorRows"
        :stats="statusBarBlueprintTemplateStats"
        @add-variable="emit('add-status-variable')"
        @clear-template="emit('clear-status-template')"
        @preview="emit('preview-status')"
        @remove-variable="emit('remove-status-variable', $event)"
        @sample-template="emit('sample-status-template')"
        @set-color="(...args) => emit('set-color', ...args)"
        @set-composite-value="(...args) => emit('set-composite-value', ...args)"
        @set-variable-mode="(...args) => emit('set-variable-mode', ...args)"
        @sync-template="emit('sync-status-template')"
      />
    </div>
  </section>
</template>
