<script setup>
import { computed } from 'vue';
import { CheckCircle2, Circle, LoaderCircle, Sparkles } from '@lucide/vue';
import CharacterAiDraftActions from './CharacterAiDraftActions.vue';
import CharacterAiDraftInputs from './CharacterAiDraftInputs.vue';
import CharacterAiModSuggestions from './CharacterAiModSuggestions.vue';
import CharacterAiProcessPanel from './CharacterAiProcessPanel.vue';

const props = defineProps({
  assistantModel: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
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
  'set-option',
  'stop',
  'update:assistantModel',
  'update:requirement',
  'update:useCurrentDraft'
]);

const hasOutput = computed(() => (
  props.process.length > 0
  || props.toolCalls.length > 0
  || props.suggestions.length > 0
));

const statusText = computed(() => {
  if (props.loading) return '生成中';
  if (hasOutput.value) return '结果已就绪';
  return '等待开始';
});
</script>

<template>
  <section
    class="form-panel ai-draft-panel"
    :aria-busy="loading"
    aria-labelledby="character-ai-workbench-title"
  >
    <header class="ai-workbench-header">
      <div class="ai-workbench-title">
        <span class="ai-workbench-icon" aria-hidden="true">
          <Sparkles :size="19" />
        </span>
        <div>
          <h2 id="character-ai-workbench-title">AI 完善设定</h2>
          <p>描述目标、选择完善范围，生成结果会直接回填到当前角色。</p>
        </div>
      </div>
      <span class="ai-workbench-status" :class="{ loading }" aria-live="polite">
        <LoaderCircle v-if="loading" :size="15" />
        <CheckCircle2 v-else-if="hasOutput" :size="15" />
        <Circle v-else :size="15" />
        {{ statusText }}
      </span>
    </header>

    <div class="ai-workbench-grid" :class="{ 'has-output': hasOutput }">
      <div class="ai-workbench-config">
        <div class="ai-workbench-section-heading">
          <span>1</span>
          <div>
            <strong>配置完善任务</strong>
            <small>现有内容不会在生成完成前被修改。</small>
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
      </div>

      <aside v-if="hasOutput" class="ai-workbench-results" aria-live="polite">
        <div class="ai-workbench-section-heading">
          <span>2</span>
          <div>
            <strong>生成结果</strong>
            <small>运行记录默认收起，避免长内容撑开页面。</small>
          </div>
        </div>
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
      </aside>
    </div>
  </section>
</template>
