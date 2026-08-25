<script setup>
import { computed, ref } from 'vue';
import { AlertCircle, CheckCircle2, LoaderCircle, Sparkles, Square } from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const manager = useCastManagerContext();
const requirementRef = ref(null);
const phases = Object.freeze(['context', 'generating', 'validating', 'applying', 'done']);
const phaseLabels = Object.freeze({
  context: '准备资料',
  generating: '生成计划',
  validating: '校验计划',
  applying: '应用变更',
  done: '完成',
  cancelled: '已取消',
  error: '失败',
  idle: '等待开始',
});
const currentPhaseIndex = computed(() => phases.indexOf(manager.organizer.phase));

function start() {
  if (manager.hasUnsavedChanges.value) return;
  manager.runOrganization({
    scope: manager.organizer.scope,
    requirement: manager.organizer.requirement,
  });
}

function focusRequirement() {
  requirementRef.value?.focus({ preventScroll: true });
}

defineExpose({ focusRequirement });
</script>

<template>
  <footer class="cast-organizer-bar">
    <div class="cast-organizer-heading">
      <Sparkles :size="18" aria-hidden="true" />
      <div>
        <strong>AI 整理</strong>
        <span aria-live="polite">{{ phaseLabels[manager.organizer.phase] }}</span>
      </div>
    </div>
    <div class="cast-segmented cast-organizer-scope" aria-label="整理范围">
      <button type="button" :aria-pressed="manager.organizer.scope === 'member'" :disabled="manager.organizer.running" @click="manager.organizer.scope = 'member'">
        当前人物
      </button>
      <button type="button" :aria-pressed="manager.organizer.scope === 'conversation'" :disabled="manager.organizer.running" @click="manager.organizer.scope = 'conversation'">
        全部人物
      </button>
    </div>
    <label class="cast-organizer-requirement">
      <span class="sr-only">整理要求</span>
      <input
        ref="requirementRef"
        v-model="manager.organizer.requirement"
        type="text"
        maxlength="2000"
        placeholder="整理要求（可选）"
        :disabled="manager.organizer.running"
        @keydown.enter.prevent="start"
      />
    </label>
    <button v-if="manager.organizer.running" type="button" class="cast-button danger" @click="manager.cancelOrganization">
      <Square :size="15" aria-hidden="true" />
      取消
    </button>
    <button v-else type="button" class="cast-button primary" :disabled="manager.hasUnsavedChanges.value" @click="start">
      <Sparkles :size="16" aria-hidden="true" />
      开始整理
    </button>

    <div v-if="manager.organizer.running || manager.organizer.phase !== 'idle'" class="cast-organizer-progress" aria-live="polite">
      <ol v-if="manager.organizer.running">
        <li v-for="(phase, index) in phases" :key="phase" :class="{ active: phase === manager.organizer.phase, complete: currentPhaseIndex > index }">
          <CheckCircle2 v-if="currentPhaseIndex > index" :size="14" aria-hidden="true" />
          <LoaderCircle v-else-if="phase === manager.organizer.phase" :size="14" class="cast-spin" aria-hidden="true" />
          <span v-else aria-hidden="true"></span>
          {{ phaseLabels[phase] }}
        </li>
      </ol>
      <p v-if="manager.organizer.error" class="error" role="alert"><AlertCircle :size="15" aria-hidden="true" />{{ manager.organizer.error }}</p>
      <p v-else-if="manager.organizer.summary"><CheckCircle2 :size="15" aria-hidden="true" />{{ manager.organizer.summary }}<span v-if="manager.organizer.applied"> · {{ manager.organizer.applied }} 项变更</span></p>
    </div>
  </footer>
</template>
