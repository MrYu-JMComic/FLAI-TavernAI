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
import WorldBookChanges from '../worldbook/WorldBookChanges.vue';
import WorldBookTargetPicker from '../worldbook/WorldBookTargetPicker.vue';
import AiPlanReview from '../AiPlanReview.vue';
import { CHARACTER_AI_SECTION_LABELS } from '../../utils/aiSectionLabels.js';

const props = defineProps({
  assistantModel: { type: String, default: '' },
  checkpointUpdatedAt: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  hasCheckpoint: { type: Boolean, default: false },
  lastError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  options: { type: Object, required: true },
  plan: { type: Object, default: null },
  planExtraRequirement: { type: String, default: '' },
  planMode: { type: Boolean, default: false },
  planPhase: { type: String, default: 'idle' },
  planStepStatus: { type: Function, default: () => '' },
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
  worldBooks: { type: Array, default: () => [] },
  worldBookChanges: { type: Array, default: () => [] },
  worldBookSelectedIds: { type: Array, default: () => [] },
  worldBookAutomatic: { type: Boolean, default: false },
  worldBookSourceLabel: { type: String, default: '' },
  worldBookApplying: { type: Boolean, default: false }
});

const emit = defineEmits([
  'complete',
  'apply-world-books',
  'reload-world-book',
  'discard-world-book',
  'new-world-book',
  'update:worldBookSelectedIds',
  'update:worldBookAutomatic',
  'create-suggested-mods',
  'discard-plan',
  'discard-session',
  'execute-plan',
  'replan',
  'resume',
  'retry',
  'save-checkpoint',
  'set-option',
  'stop',
  'toggle-plan-step',
  'update-plan-step',
  'update:assistantModel',
  'update:planExtraRequirement',
  'update:planMode',
  'update:requirement',
  'update:streamingEnabled',
  'update:thinkingLevel',
  'update:useCurrentDraft'
]);

const hasPlan = computed(() => Boolean(props.plan?.steps?.length));

const hasOutput = computed(() => (
  props.loading
  || props.status !== 'idle'
  || props.process.length > 0
  || props.toolCalls.length > 0
  || props.suggestions.length > 0
  || props.worldBookChanges.length > 0
  || hasPlan.value
  || props.warnings.length > 0
));

const statusText = computed(() => {
  return ({
    running: '运行中',
    review: '待审批',
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
  if (props.planMode) parts.push('Plan 模式');
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
          :plan-mode="planMode"
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
          @update:plan-mode="emit('update:planMode', $event)"
          @update:streaming-enabled="emit('update:streamingEnabled', $event)"
          @update:thinking-level="emit('update:thinkingLevel', $event)"
          @update:use-current-draft="emit('update:useCurrentDraft', $event)"
          @set-option="(key, enabled) => emit('set-option', key, enabled)"
        />
        <WorldBookTargetPicker
          v-if="options.worldBook"
          :books="worldBooks"
          :selected-ids="worldBookSelectedIds"
          :automatic="worldBookAutomatic"
          :source-label="worldBookSourceLabel"
          :busy="disabled"
          @update:selected-ids="emit('update:worldBookSelectedIds', $event)"
          @update:automatic="emit('update:worldBookAutomatic', $event)"
          @new-book="emit('new-world-book')"
        />
        <p v-if="options.worldBook" class="ai-worldbook-context-note">本次用书独立于角色关联；新书可加入关联列表，保存角色后生效。</p>
        <CharacterAiDraftActions
          :disabled="disabled"
          :has-checkpoint="hasCheckpoint"
          :loading="loading"
          :plan-mode="planMode"
          :plan-phase="planPhase"
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

        <AiPlanReview
          v-if="hasPlan"
          :busy="loading"
          :disabled="disabled && !loading"
          :extra-requirement="planExtraRequirement"
          :phase="planPhase"
          :plan="plan"
          :section-labels="CHARACTER_AI_SECTION_LABELS"
          :step-status="planStepStatus"
          @discard="emit('discard-plan')"
          @execute="emit('execute-plan')"
          @replan="emit('replan')"
          @toggle-step="(id, selected) => emit('toggle-plan-step', id, selected)"
          @update-step="(id, patch) => emit('update-plan-step', id, patch)"
          @update:extra-requirement="emit('update:planExtraRequirement', $event)"
        />

        <CharacterAiProcessPanel
          v-if="hasOutput"
          :loading="loading"
          :process="process"
          :reasoning="reasoning"
          :status="status"
          :status-message="statusMessage"
          :tool-calls="toolCalls"
        />

        <WorldBookChanges
          v-if="worldBookChanges.length"
          :changes="worldBookChanges"
          :busy="disabled || worldBookApplying || options.worldBook === false"
          character-context
          @apply="emit('apply-world-books', $event)"
          @reload="emit('reload-world-book', $event)"
          @discard="emit('discard-world-book', $event)"
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
