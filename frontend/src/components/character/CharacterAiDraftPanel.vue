<script setup>
import { ref } from 'vue';
import { RotateCcw, Sparkles } from '@lucide/vue';
import CharacterAiDraftActions from './CharacterAiDraftActions.vue';
import CharacterAiDraftInputs from './CharacterAiDraftInputs.vue';
import CharacterAiModSuggestions from './CharacterAiModSuggestions.vue';
import CharacterAiProcessPanel from './CharacterAiProcessPanel.vue';

defineProps({
  assistantModel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  dragging: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
  panelPosition: { type: Object, required: true },
  panelSize: { type: Object, required: true },
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  requirement: { type: String, default: '' },
  suggestedModsCreating: { type: Boolean, default: false },
  suggestions: { type: Array, default: () => [] },
  toolCalls: { type: Array, default: () => [] },
  useCurrentDraft: { type: Boolean, default: true }
});

const emit = defineEmits([
  'complete',
  'create-suggested-mods',
  'drag-start',
  'reset-panel',
  'resize-start',
  'set-option',
  'stop',
  'update:assistantModel',
  'update:requirement',
  'update:useCurrentDraft'
]);

const panelElement = ref(null);

function getPanelElement() {
  return panelElement.value;
}

defineExpose({ getPanelElement });
</script>

<template>
  <section
    ref="panelElement"
    class="form-panel ai-draft-panel"
    :class="{ 'ai-panel-dragging': dragging }"
    :style="{
      '--ai-panel-x': panelPosition.x + 'px',
      '--ai-panel-y': panelPosition.y + 'px',
      '--ai-panel-w': panelSize.w + 'px',
      '--ai-panel-h': panelSize.h + 'px'
    }"
  >
    <div class="inline-heading ai-panel-heading" @pointerdown="emit('drag-start', $event)">
      <div>
        <h2>AI 完善设定</h2>
        <p>按你的要求自动补全角色字段和正则规则。</p>
      </div>
      <div class="ai-panel-heading-actions">
        <button
          class="ai-panel-reset"
          type="button"
          title="重置位置"
          aria-label="重置 AI 完善面板位置"
          @pointerdown.stop
          @click.stop="emit('reset-panel')"
        >
          <RotateCcw :size="14" />
        </button>
        <Sparkles :size="20" />
      </div>
    </div>
    <CharacterAiDraftInputs
      :requirement="requirement"
      :assistant-model="assistantModel"
      :use-current-draft="useCurrentDraft"
      :disabled="disabled"
      :model-options="modelOptions"
      :options="options"
      @update:requirement="emit('update:requirement', $event)"
      @update:assistant-model="emit('update:assistantModel', $event)"
      @update:use-current-draft="emit('update:useCurrentDraft', $event)"
      @set-option="(key, enabled) => emit('set-option', key, enabled)"
    />
    <CharacterAiDraftActions
      :disabled="disabled"
      :loading="loading"
      @complete="emit('complete')"
      @stop="emit('stop')"
    />
    <CharacterAiModSuggestions
      v-if="suggestions.length"
      :suggestions="suggestions"
      :creating="suggestedModsCreating"
      @create="emit('create-suggested-mods')"
    />
    <CharacterAiProcessPanel
      v-if="process.length || toolCalls.length"
      :process="process"
      :reasoning="reasoning"
      :tool-calls="toolCalls"
    />
    <span class="ai-panel-resize-handle" aria-hidden="true" @pointerdown.stop="emit('resize-start', $event)"></span>
  </section>
</template>
