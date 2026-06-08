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
  const nextPendingIds = new Set(pendingActionIds.value);
  nextPendingIds.add(id);
  pendingActionIds.value = nextPendingIds;
}

function syncPendingActionIds(items) {
  const pendingIds = pendingActionIds.value;
  if (!pendingIds.size) return;

  const activeIds = collectToastIds(items);
  const nextPendingIds = new Set();
  let changed = false;
  for (const id of pendingIds) {
    if (activeIds.has(id)) {
      nextPendingIds.add(id);
    } else {
      changed = true;
    }
  }
  if (changed) {
    pendingActionIds.value = nextPendingIds;
  }
}

function collectToastIds(items) {
  const ids = new Set();
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (item?.id) {
      ids.add(item.id);
    }
  }
  return ids;
}

function runAction(item) {
  if (!item?.id || isActionPending(item)) return;
  markActionPending(item.id);
  emit('dismiss', item.id);
  item.action?.();
}

watch(
  () => props.items,
  syncPendingActionIds
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
