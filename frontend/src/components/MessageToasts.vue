<script setup>
import { ref, watch } from 'vue';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from '@lucide/vue';

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['dismiss']);
const pendingActionIds = ref(new Set());

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

function isActionPending(item) {
  return pendingActionIds.value.has(item?.id);
}

function markActionPending(id) {
  pendingActionIds.value = new Set(pendingActionIds.value).add(id);
}

function runAction(item) {
  if (!item?.id || isActionPending(item)) return;
  markActionPending(item.id);
  emit('dismiss', item.id);
  item.action?.();
}

watch(
  () => props.items.map((item) => item.id),
  (ids) => {
    const activeIds = new Set(ids);
    const nextPendingIds = new Set([...pendingActionIds.value].filter((id) => activeIds.has(id)));
    if (nextPendingIds.size !== pendingActionIds.value.size) {
      pendingActionIds.value = nextPendingIds;
    }
  }
);
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
          :disabled="isActionPending(item)"
          :aria-busy="isActionPending(item)"
          @click="runAction(item)"
        >
          {{ item.actionLabel }}
        </button>
        <button class="message-toast-close" type="button" aria-label="关闭通知" title="关闭通知" @click="emit('dismiss', item.id)">
          <X :size="16" />
        </button>
      </article>
    </TransitionGroup>
  </Teleport>
</template>
