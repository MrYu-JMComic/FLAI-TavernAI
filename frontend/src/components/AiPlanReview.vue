<script setup>
import { computed } from 'vue';
import { CheckCircle2, ClipboardList, LoaderCircle, Play, RefreshCw, TriangleAlert, Trash2 } from '@lucide/vue';
import { aiSectionLabel } from '../utils/aiSectionLabels.js';

const props = defineProps({
  busy: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  extraRequirement: { type: String, default: '' },
  phase: { type: String, default: 'review' },
  plan: { type: Object, default: null },
  sectionLabels: { type: Object, default: () => ({}) },
  stepStatus: { type: Function, default: () => '' }
});

const emit = defineEmits([
  'discard',
  'execute',
  'replan',
  'toggle-step',
  'update-step',
  'update:extraRequirement'
]);

const steps = computed(() => (Array.isArray(props.plan?.steps) ? props.plan.steps : []));
const selectedCount = computed(() => steps.value.filter((step) => step.selected !== false).length);
const executing = computed(() => props.phase === 'executing');
const locked = computed(() => props.disabled || props.busy || executing.value);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readInputChecked(event) {
  return Boolean(event?.target?.checked);
}
</script>

<template>
  <section v-if="steps.length" class="ai-plan-review" :class="{ 'is-executing': executing }" aria-label="AI 计划审批">
    <header class="ai-plan-head">
      <span class="ai-plan-icon" aria-hidden="true"><ClipboardList :size="16" /></span>
      <div class="ai-plan-title">
        <strong>{{ executing ? '按计划执行中' : '计划待审批' }}</strong>
        <small>{{ selectedCount }} / {{ steps.length }} 步将被执行</small>
      </div>
    </header>

    <p v-if="plan.notes" class="ai-plan-notes">{{ plan.notes }}</p>

    <ul v-if="plan.risks?.length" class="ai-plan-risks">
      <li v-for="(risk, index) in plan.risks" :key="`risk-${index}`">
        <TriangleAlert :size="13" aria-hidden="true" />
        <span>{{ risk }}</span>
      </li>
    </ul>

    <ol class="ai-plan-steps">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="ai-plan-step"
        :class="{
          'is-off': step.selected === false,
          'is-done': stepStatus(step.id) === 'completed'
        }"
      >
        <label class="ai-plan-step-head">
          <input
            type="checkbox"
            :checked="step.selected !== false"
            :disabled="locked"
            @change="emit('toggle-step', step.id, readInputChecked($event))"
          />
          <span class="ai-plan-step-index" aria-hidden="true">
            <CheckCircle2 v-if="stepStatus(step.id) === 'completed'" :size="14" />
            <LoaderCircle v-else-if="executing && step.selected !== false" :size="14" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="ai-plan-step-section">{{ aiSectionLabel(sectionLabels, step.section) }}</span>
          <input
            class="ai-plan-step-intent"
            type="text"
            :value="step.intent"
            :disabled="locked"
            aria-label="步骤说明"
            @input="emit('update-step', step.id, { intent: readInputValue($event) })"
          />
        </label>
        <details v-if="step.detail || !locked" class="ai-plan-step-detail">
          <summary>补充说明</summary>
          <textarea
            rows="3"
            :value="step.detail"
            :disabled="locked"
            placeholder="可选：说明取舍、要保留的现有内容或具体写法"
            @input="emit('update-step', step.id, { detail: readInputValue($event) })"
          />
        </details>
      </li>
    </ol>

    <label class="field ai-plan-extra">
      <span>补充要求</span>
      <textarea
        rows="2"
        :value="extraRequirement"
        :disabled="locked"
        placeholder="审批时想额外交代的事，会和原始需求一起传给模型"
        @input="emit('update:extraRequirement', readInputValue($event))"
      />
    </label>

    <div class="ai-plan-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="locked || !selectedCount"
        :aria-busy="executing"
        @click="emit('execute')"
      >
        <Play :size="16" />
        <span>{{ executing ? '执行中...' : '按计划执行' }}</span>
      </button>
      <button class="ghost-button" type="button" :disabled="locked" @click="emit('replan')">
        <RefreshCw :size="15" />
        <span>重新规划</span>
      </button>
      <button class="ghost-button ai-plan-discard" type="button" :disabled="locked" @click="emit('discard')">
        <Trash2 :size="15" />
        <span>放弃</span>
      </button>
    </div>
  </section>
</template>
