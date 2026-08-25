<script setup>
import { ListChecks, Settings } from '@lucide/vue';

defineProps({
  active: { type: Boolean, default: false },
  currentStep: { type: Object, required: true },
  progressText: { type: String, default: '' },
  stepId: { type: String, default: '' },
  steps: { type: Array, default: () => [] }
});

const emit = defineEmits(['set-mode', 'set-step']);
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
        v-for="(step, index) in steps"
        :key="step.id"
        class="character-wizard-step"
        :class="{ active: stepId === step.id }"
        type="button"
        role="tab"
        :aria-selected="stepId === step.id"
        :tabindex="stepId === step.id ? 0 : -1"
        @click="emit('set-step', step.id)"
      >
        <span class="character-wizard-step-index">{{ index + 1 }}</span>
        <strong>{{ step.label }}</strong>
      </button>
    </div>
  </section>
</template>
