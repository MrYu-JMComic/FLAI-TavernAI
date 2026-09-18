<script setup>
import { computed } from 'vue';
import { Play, RefreshCw, Save, Square, Trash2, WandSparkles } from '@lucide/vue';

const props = defineProps({
  disabled: { type: Boolean, default: false },
  hasCheckpoint: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  status: { type: String, default: 'idle' }
});

const emit = defineEmits(['complete', 'discard', 'resume', 'retry', 'save', 'stop']);

const canResume = computed(() => props.hasCheckpoint && ['paused', 'failed'].includes(props.status));
const shouldRetry = computed(() => props.status === 'failed' && !props.hasCheckpoint);
const showSecondary = computed(() => props.hasCheckpoint && !props.loading);
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
      <WandSparkles v-else :size="17" />
      <span>{{ canResume ? '继续完成' : shouldRetry ? '重试任务' : status === 'completed' ? '再次完善' : '开始完善' }}</span>
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
