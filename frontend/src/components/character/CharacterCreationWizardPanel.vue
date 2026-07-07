<script setup>
import { ChevronLeft, ChevronRight, ListChecks, Settings } from '@lucide/vue';

defineProps({
  active: { type: Boolean, default: false },
  currentStep: { type: Object, required: true },
  progressText: { type: String, default: '' },
  stepId: { type: String, default: '' },
  stepIndex: { type: Number, default: 0 },
  steps: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'next',
  'previous',
  'set-mode',
  'set-step',
  'skip'
]);
</script>

<template>
  <section
    class="character-wizard-panel"
    :class="{ 'is-full': !active }"
    aria-live="polite"
  >
    <div class="character-wizard-head">
      <div>
        <strong>{{ active ? `${progressText}：${currentStep.label}` : '完整表单模式' }}</strong>
        <span>{{ active ? currentStep.description : '显示全部创建字段，适合熟悉完整角色配置的编辑流程。' }}</span>
      </div>
      <div class="character-wizard-mode" role="group" aria-label="角色创建模式">
        <button
          class="ghost-button"
          type="button"
          :class="{ active }"
          @click="emit('set-mode', 'wizard')"
        >
          <ListChecks :size="17" />
          <span>向导</span>
        </button>
        <button
          class="ghost-button"
          type="button"
          :class="{ active: !active }"
          @click="emit('set-mode', 'full')"
        >
          <Settings :size="17" />
          <span>完整表单</span>
        </button>
      </div>
    </div>
    <div v-if="active" class="character-wizard-steps" role="tablist" aria-label="角色创建向导步骤">
      <button
        v-for="step in steps"
        :key="step.id"
        class="character-wizard-step"
        :class="{ active: stepId === step.id }"
        type="button"
        role="tab"
        :aria-selected="stepId === step.id"
        :tabindex="stepId === step.id ? 0 : -1"
        @click="emit('set-step', step.id, { scroll: true })"
      >
        <strong>{{ step.label }}</strong>
        <span>{{ step.description }}</span>
      </button>
    </div>
    <div v-if="active" class="character-wizard-actions">
      <button
        class="ghost-button"
        type="button"
        :disabled="stepIndex === 0"
        @click="emit('previous')"
      >
        <ChevronLeft :size="17" />
        <span>上一步</span>
      </button>
      <button class="ghost-button" type="button" @click="emit('skip')">
        <span>跳过本步</span>
      </button>
      <button
        v-if="stepIndex < steps.length - 1"
        class="primary-button"
        type="button"
        @click="emit('next')"
      >
        <span>下一步</span>
        <ChevronRight :size="17" />
      </button>
    </div>
  </section>
</template>
