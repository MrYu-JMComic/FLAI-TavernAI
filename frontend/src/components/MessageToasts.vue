<script setup>
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from '@lucide/vue';

defineProps({
  items: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['dismiss']);

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info
};

const titles = {
  success: '已完成',
  error: '出现问题',
  warning: '请注意',
  info: '消息'
};

function iconFor(type) {
  return icons[type] || icons.info;
}

function titleFor(item) {
  return item.title || titles[item.type] || titles.info;
}

function runAction(item) {
  item.action?.();
  emit('dismiss', item.id);
}
</script>

<template>
  <Teleport to="body">
    <TransitionGroup
      name="message-toast"
      tag="section"
      class="message-toast-stack"
      aria-live="polite"
      aria-label="消息通知"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="message-toast"
        :class="item.type"
        role="status"
      >
        <span class="message-toast-icon" aria-hidden="true">
          <component :is="iconFor(item.type)" :size="20" />
        </span>
        <div class="message-toast-content">
          <strong>{{ titleFor(item) }}</strong>
          <p>{{ item.message }}</p>
        </div>
        <button
          v-if="item.actionLabel"
          class="message-toast-action"
          type="button"
          @click="runAction(item)"
        >
          {{ item.actionLabel }}
        </button>
        <button class="message-toast-close" type="button" title="关闭通知" @click="emit('dismiss', item.id)">
          <X :size="16" />
        </button>
      </article>
    </TransitionGroup>
  </Teleport>
</template>
