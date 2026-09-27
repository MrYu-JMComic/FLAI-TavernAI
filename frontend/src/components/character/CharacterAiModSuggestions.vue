<script setup>
import { ListChecks, Plus } from '@lucide/vue';

defineProps({
  creating: { type: Boolean, default: false },
  suggestions: { type: Array, default: () => [] }
});

const emit = defineEmits(['create']);
</script>

<template>
  <section class="ai-mod-suggestions" aria-label="AI Mod 建议">
    <header class="ai-mod-head">
      <span class="ai-tool-title">
        <ListChecks :size="15" />
        <span>Mod 建议</span>
      </span>
      <small>{{ suggestions.length }} 项</small>
    </header>
    <div class="ai-mod-list">
      <article v-for="(mod, index) in suggestions" :key="index" class="ai-mod-card">
        <div class="ai-mod-card-head">
          <strong>{{ mod.name }}</strong>
          <small>{{ mod.type || 'system' }}</small>
        </div>
        <p>{{ mod.description || mod.content }}</p>
      </article>
    </div>
    <button
      class="ghost-button ai-mod-create"
      type="button"
      :disabled="creating"
      @click="emit('create')"
    >
      <Plus :size="15" />
      <span>{{ creating ? '创建中...' : '创建这些 Mod' }}</span>
    </button>
  </section>
</template>
