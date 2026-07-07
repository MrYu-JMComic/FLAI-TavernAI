<script setup>
import { ListChecks, Plus } from '@lucide/vue';

defineProps({
  creating: { type: Boolean, default: false },
  suggestions: { type: Array, default: () => [] }
});

const emit = defineEmits(['create']);
</script>

<template>
  <div class="ai-mod-suggestions">
    <div class="ai-tool-title">
      <ListChecks :size="16" />
      <span>AI Mod 建议 {{ suggestions.length }}</span>
    </div>
    <article v-for="(mod, index) in suggestions" :key="index" class="ai-mod-card">
      <strong>{{ mod.name }}</strong>
      <small>{{ mod.type || 'system' }}</small>
      <p>{{ mod.description || mod.content }}</p>
    </article>
    <button
      class="ghost-button"
      type="button"
      :disabled="creating"
      @click="emit('create')"
    >
      <Plus :size="16" />
      <span>{{ creating ? '创建中...' : '创建这些 Mod' }}</span>
    </button>
  </div>
</template>
