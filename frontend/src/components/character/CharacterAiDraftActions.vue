<script setup>
import { ArrowUp, LoaderCircle, Square } from '@lucide/vue';

defineProps({
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  pending: { type: Boolean, default: false }
});
const emit = defineEmits(['complete', 'stop']);
</script>

<template>
  <button v-if="loading" class="assistant-send-button is-stop" type="button" aria-label="停止生成" @click="emit('stop')"><Square :size="15" fill="currentColor" /></button>
  <button v-else class="assistant-send-button" type="button" :disabled="disabled" aria-label="发送消息" @click="emit('complete')"><LoaderCircle v-if="pending" :size="18" class="assistant-spinning" />
      <ArrowUp v-else :size="20" /></button>
</template>
