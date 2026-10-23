<script setup>
import { ref } from 'vue';
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

const editingSections = [
  { id: 'prompt', label: '状态栏提示词', description: 'AI 更新规则' },
  { id: 'custom', label: '自定义状态栏', description: '初始变量与展示' }
];
const activeSection = ref('prompt');

function navigateSection(event) {
  const currentIndex = editingSections.findIndex((section) => section.id === activeSection.value);
  let nextIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % editingSections.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + editingSections.length - 1) % editingSections.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = editingSections.length - 1;
  else return;
  event.preventDefault();
  activeSection.value = editingSections[nextIndex].id;
  event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
}
</script>

<template>
  <section id="section-status-blueprint" class="form-panel character-panel">
    <header class="character-panel-head">
      <div>
        <h2>状态栏</h2>
        <p>分别编辑 AI 的更新规则与状态栏的初始变量、外观和交互。</p>
      </div>
    </header>

    <div class="character-panel-body">
      <div class="status-editor-tabs" role="tablist" aria-label="状态栏编辑分区" @keydown="navigateSection">
        <button
          v-for="section in editingSections"
          :id="`status-editor-tab-${section.id}`"
          :key="section.id"
          type="button"
          role="tab"
          :aria-selected="activeSection === section.id"
          :aria-controls="`status-editor-section-${section.id}`"
          :tabindex="activeSection === section.id ? 0 : -1"
          @click="activeSection = section.id"
        >
          <strong>{{ section.label }}</strong>
          <small>{{ section.description }}</small>
        </button>
      </div>

      <section
        v-show="activeSection === 'prompt'"
        id="status-editor-section-prompt"
        class="status-editor-section"
        role="tabpanel"
        aria-labelledby="status-editor-tab-prompt"
        tabindex="0"
      >
        <p class="status-editor-section-hint">告诉 AI 在什么情况下更新哪些变量，以及变化的幅度和限制。</p>
        <label class="field">
          <span>状态栏提示词</span>
          <textarea
            v-model="advancedSettings.statusBarPrompt"
            rows="8"
            placeholder="例如：受伤时降低 HP；好感随互动变化，每次最多增减 5；获得金币时更新金币数量。"
            aria-label="状态栏提示词"
            :disabled="!canEdit"
          />
        </label>
      </section>

      <section
        v-show="activeSection === 'custom'"
        id="status-editor-section-custom"
        class="status-editor-section"
        role="tabpanel"
        aria-labelledby="status-editor-tab-custom"
        tabindex="0"
      >
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
      </section>
    </div>
  </section>
</template>

<style scoped>
.status-editor-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.status-editor-tabs button { display: grid; gap: 3px; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.status-editor-tabs button[aria-selected="true"] { border-color: var(--primary); background: var(--primary-soft); }
.status-editor-tabs button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.status-editor-tabs strong { font-size: 0.88rem; }
.status-editor-tabs small { color: var(--muted); font-size: 0.76rem; }
.status-editor-section { display: grid; gap: 12px; min-width: 0; }
.status-editor-section-hint { margin: 0; color: var(--muted); font-size: 0.82rem; line-height: 1.6; }
.status-editor-section :deep(.status-blueprint-panel) { padding-top: 0; border-top: 0; }
</style>
