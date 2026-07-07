<script setup>
import { WandSparkles } from '@lucide/vue';

defineProps({
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
});

const emit = defineEmits(['complete', 'stop']);
</script>

<template>
  <div class="ai-action-row">
    <button
      class="primary-button ai-draft-button"
      type="button"
      :disabled="disabled"
      :aria-busy="loading"
      @click="emit('complete')"
    >
      <WandSparkles :size="18" />
      <span>{{ loading ? 'AI 正在调用工具...' : 'AI 完善角色设定' }}</span>
    </button>
    <button v-if="loading" class="ghost-button" type="button" @click="emit('stop')">
      <span>暂停</span>
    </button>
  </div>
</template>
