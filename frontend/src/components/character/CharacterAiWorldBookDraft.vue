<script setup>
import { BookOpen, Plus } from '@lucide/vue';

defineProps({
  creating: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  draft: { type: Object, required: true }
});

const emit = defineEmits(['create']);

function positionLabel(position) {
  return ({
    at_start: '上下文最前',
    before_char: '角色设定前',
    after_char: '角色设定后',
    at_depth: '指定深度'
  })[position] || '角色设定前';
}
</script>

<template>
  <section class="ai-worldbook-draft" aria-label="AI 世界书草稿">
    <header class="ai-worldbook-head">
      <span class="ai-tool-title">
        <BookOpen :size="15" />
        <span>世界书草稿</span>
      </span>
      <small>{{ draft.entries.length }} 条</small>
    </header>

    <div class="ai-worldbook-profile">
      <strong>{{ draft.name }}</strong>
      <p v-if="draft.description">{{ draft.description }}</p>
      <small>扫描 {{ draft.scanDepth }} 条消息 · 上下文预算 {{ draft.lorebookContextPercent }}%</small>
    </div>

    <div class="ai-worldbook-entry-list">
      <article v-for="(entry, index) in draft.entries" :key="`${entry.name}-${index}`" class="ai-worldbook-entry">
        <div>
          <strong>{{ entry.name }}</strong>
          <small>{{ positionLabel(entry.position) }}</small>
        </div>
        <span>{{ entry.alwaysActive ? '始终生效' : entry.triggerKeys }}</span>
        <p>{{ entry.content }}</p>
      </article>
    </div>

    <button
      class="ghost-button ai-worldbook-create"
      type="button"
      :disabled="disabled || creating"
      :aria-busy="creating"
      @click="emit('create')"
    >
      <Plus :size="15" />
      <span>{{ creating ? '创建中...' : '创建并关联世界书' }}</span>
    </button>
  </section>
</template>
