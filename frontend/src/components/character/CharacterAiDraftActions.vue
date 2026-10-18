<script setup>
import { computed } from 'vue';
import { ClipboardList, Play, RefreshCw, Save, Square, Trash2, WandSparkles } from '@lucide/vue';

const props = defineProps({
  disabled: { type: Boolean, default: false },
  hasCheckpoint: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  planMode: { type: Boolean, default: false },
  planPhase: { type: String, default: 'idle' },
  status: { type: String, default: 'idle' }
});

const emit = defineEmits(['complete', 'discard', 'resume', 'retry', 'save', 'stop']);

const canResume = computed(() => props.hasCheckpoint && ['paused', 'failed'].includes(props.status));
const shouldRetry = computed(() => props.status === 'failed' && !props.hasCheckpoint);
const showSecondary = computed(() => props.hasCheckpoint && !props.loading);
// With plan mode on, the primary button starts a planning run; approving and
// running the plan happens in the plan review card instead.
const planFirst = computed(() => props.planMode && props.planPhase !== 'review' && !canResume.value && !shouldRetry.value);

const primaryLabel = computed(() => {
  if (canResume.value) return '继续完成';
  if (shouldRetry.value) return '重试任务';
  if (planFirst.value) return '生成计划';
  return props.status === 'completed' ? '再次完善' : '开始完善';
});
</script>

<template>
  <div class="ai-action-row">
    <button
      v-if="!loading"
      class="primary-button ai-draft-button"
      type="button"
      :disabled="disabled"
      @click="canResume ? emit('resume') : shouldRetry ? emit('retry') : emit('complete')"
    >
      <Play v-if="canResume" :size="17" />
      <RefreshCw v-else-if="shouldRetry" :size="17" />
      <ClipboardList v-else-if="planFirst" :size="17" />
      <WandSparkles v-else :size="17" />
      <span>{{ primaryLabel }}</span>
    </button>
    <button v-else class="primary-button ai-draft-button" type="button" @click="emit('stop')">
      <Square :size="16" />
      <span>暂停并保留</span>
    </button>

    <!-- Checkpoint-only controls live on their own line so the primary call to
         action keeps full width at every breakpoint. Both are labelled, so a
         single remaining control still reads as an action rather than a stray
         icon. -->
    <div v-if="showSecondary" class="ai-action-secondary">
      <button
        v-if="status !== 'completed'"
        class="ghost-button ai-secondary-action"
        type="button"
        title="将当前阶段结果写入角色草稿"
        @click="emit('save')"
      >
        <Save :size="16" />
        <span>保存阶段结果</span>
      </button>
      <button
        class="ghost-button ai-secondary-action ai-discard-action"
        type="button"
        title="清除本次 AI 运行记录"
        @click="emit('discard')"
      >
        <Trash2 :size="16" />
        <span>清除运行记录</span>
      </button>
    </div>
  </div>
</template>
