<script setup>
import { computed } from 'vue';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock3,
  LoaderCircle,
  PauseCircle,
  Sparkles,
  TriangleAlert
} from '@lucide/vue';
import CharacterAiDraftActions from './CharacterAiDraftActions.vue';
import CharacterAiDraftInputs from './CharacterAiDraftInputs.vue';
import CharacterAiModSuggestions from './CharacterAiModSuggestions.vue';
import CharacterAiProcessPanel from './CharacterAiProcessPanel.vue';
import CharacterAiWorldBookDraft from './CharacterAiWorldBookDraft.vue';

const props = defineProps({
  assistantModel: { type: String, default: '' },
  checkpointUpdatedAt: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  hasCheckpoint: { type: Boolean, default: false },
  lastError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  requirement: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  statusMessage: { type: String, default: '' },
  suggestedModsCreating: { type: Boolean, default: false },
  suggestions: { type: Array, default: () => [] },
  streamingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  thinkingSupported: { type: Boolean, default: false },
  toolCalls: { type: Array, default: () => [] },
  useCurrentDraft: { type: Boolean, default: true },
  warnings: { type: Array, default: () => [] },
  worldBookDraft: { type: Object, default: null },
  worldBookDraftCreating: { type: Boolean, default: false }
});

const emit = defineEmits([
  'complete',
  'create-world-book',
  'create-suggested-mods',
  'discard-session',
  'resume',
  'retry',
  'save-checkpoint',
  'set-option',
  'stop',
  'update:assistantModel',
  'update:requirement',
  'update:streamingEnabled',
  'update:thinkingLevel',
  'update:useCurrentDraft'
]);

const hasOutput = computed(() => (
  props.loading
  || props.status !== 'idle'
  || props.process.length > 0
  || props.toolCalls.length > 0
  || props.suggestions.length > 0
  || Boolean(props.worldBookDraft)
  || props.warnings.length > 0
));

const statusText = computed(() => {
  return ({
    running: '运行中',
    paused: '已暂停',
    failed: '需处理',
    completed: '已完成'
  })[props.status] || '待开始';
});

const checkpointTimeText = computed(() => {
  if (!props.checkpointUpdatedAt) return '';
  const date = new Date(props.checkpointUpdatedAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
});

// The header carries the run's headline settings so the reader never has to
// scroll the config column just to confirm what is about to run.
const headerMeta = computed(() => {
  const model = props.modelOptions.find((item) => (item?.id || '') === (props.assistantModel || ''));
  const parts = [model?.label || model?.id || props.assistantModel || '全局模型'];
  if (props.thinkingSupported) {
    const thinking = props.thinkingOptions.find((item) => item?.value === props.thinkingLevel);
    if (thinking?.label) parts.push(`思考 ${thinking.label}`);
  }
  const keys = Object.keys(props.options || {});
  parts.push(`范围 ${keys.filter((key) => props.options[key]).length}/${keys.length}`);
  return parts.join(' · ');
});
</script>

<template>
  <section
    class="form-panel ai-draft-panel"
    :class="`is-${status}`"
    :aria-busy="loading"
    aria-labelledby="character-ai-workbench-title"
  >
    <header class="ai-workbench-header">
      <span class="ai-workbench-icon" aria-hidden="true">
        <Sparkles :size="18" />
      </span>
      <div class="ai-workbench-title">
        <h2 id="character-ai-workbench-title">AI 完善助手</h2>
        <p>{{ headerMeta }}</p>
      </div>
      <span class="ai-workbench-status" :class="status" aria-live="polite">
        <LoaderCircle v-if="status === 'running'" :size="14" />
        <CheckCircle2 v-else-if="status === 'completed'" :size="14" />
        <PauseCircle v-else-if="status === 'paused'" :size="14" />
        <AlertCircle v-else-if="status === 'failed'" :size="14" />
        <Circle v-else :size="14" />
        {{ statusText }}
      </span>
    </header>

    <div class="ai-workbench-grid" :class="{ 'has-output': hasOutput }">
      <section class="ai-workbench-config" aria-label="AI 完善任务配置">
        <div class="ai-workbench-section-heading">
          <span>1</span>
          <div class="ai-heading-text">
            <strong>任务配置</strong>
            <small>明确目标与允许修改的范围</small>
          </div>
        </div>
        <CharacterAiDraftInputs
          :requirement="requirement"
          :assistant-model="assistantModel"
          :streaming-enabled="streamingEnabled"
          :thinking-level="thinkingLevel"
          :thinking-options="thinkingOptions"
          :thinking-supported="thinkingSupported"
          :use-current-draft="useCurrentDraft"
          :disabled="disabled"
          :model-options="modelOptions"
          :options="options"
          @update:requirement="emit('update:requirement', $event)"
          @update:assistant-model="emit('update:assistantModel', $event)"
          @update:streaming-enabled="emit('update:streamingEnabled', $event)"
          @update:thinking-level="emit('update:thinkingLevel', $event)"
          @update:use-current-draft="emit('update:useCurrentDraft', $event)"
          @set-option="(key, enabled) => emit('set-option', key, enabled)"
        />
        <CharacterAiDraftActions
          :disabled="disabled"
          :has-checkpoint="hasCheckpoint"
          :loading="loading"
          :status="status"
          @complete="emit('complete')"
          @discard="emit('discard-session')"
          @resume="emit('resume')"
          @retry="emit('retry')"
          @save="emit('save-checkpoint')"
          @stop="emit('stop')"
        />
      </section>

      <aside class="ai-workbench-results" :class="{ empty: !hasOutput }" aria-live="polite">
        <!-- Static subtitle on purpose: the live status message belongs to the
             process panel, and repeating it here is what made the old monitor
             read the same sentence three times in a row. -->
        <div class="ai-workbench-section-heading ai-monitor-heading">
          <span>2</span>
          <div class="ai-heading-text">
            <strong>实时运行台</strong>
            <small>模型思考、工具调用与阶段结果</small>
          </div>
          <div class="ai-monitor-counters" aria-label="运行统计">
            <span>{{ process.length }} 轮</span>
            <span>{{ toolCalls.length }} 调用</span>
          </div>
        </div>

        <div v-if="lastError" class="ai-run-alert" role="alert">
          <AlertCircle :size="16" />
          <span>{{ lastError }}</span>
        </div>

        <div v-if="hasCheckpoint && status !== 'completed'" class="ai-checkpoint-note">
          <Clock3 :size="15" />
          <span>阶段结果已保留，可继续完成或写入草稿</span>
          <small v-if="checkpointTimeText">{{ checkpointTimeText }}</small>
        </div>

        <div v-if="warnings.length" class="ai-run-warnings" role="status" aria-label="完成验收提示">
          <div class="ai-run-warnings-title">
            <TriangleAlert :size="15" />
            <strong>验收提示</strong>
            <span>{{ warnings.length }}</span>
          </div>
          <ul>
            <li v-for="(warning, index) in warnings" :key="`${index}-${warning}`">
              {{ warning }}
            </li>
          </ul>
        </div>

        <div v-if="!hasOutput" class="ai-monitor-empty">
          <span class="ai-monitor-empty-icon" aria-hidden="true"><Sparkles :size="22" /></span>
          <strong>等待任务</strong>
          <span>开始后将实时显示模型思考与工具执行状态</span>
        </div>

        <CharacterAiProcessPanel
          v-else
          :loading="loading"
          :process="process"
          :reasoning="reasoning"
          :status="status"
          :status-message="statusMessage"
          :tool-calls="toolCalls"
        />

        <CharacterAiWorldBookDraft
          v-if="worldBookDraft"
          :draft="worldBookDraft"
          :creating="worldBookDraftCreating"
          :disabled="disabled"
          @create="emit('create-world-book')"
        />

        <CharacterAiModSuggestions
          v-if="suggestions.length"
          :suggestions="suggestions"
          :creating="suggestedModsCreating"
          @create="emit('create-suggested-mods')"
        />
      </aside>
    </div>
  </section>
</template>
