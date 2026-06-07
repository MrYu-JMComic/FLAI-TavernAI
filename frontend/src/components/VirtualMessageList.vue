<script setup>
import { computed, ref, watch } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  estimatedHeight: {
    type: Number,
    default: 160
  },
  overscan: {
    type: Number,
    default: 5
  }
});

const emit = defineEmits(['scroll', 'wheel', 'touchstart', 'touchmove']);

const scrollContainerRef = ref(null);
const measurementCache = new Map();
const messageIds = computed(() => props.messages.map((message) => String(message?.id || '')).filter(Boolean));

watch(messageIds, (ids) => {
  const activeIds = new Set(ids);
  for (const messageId of measurementCache.keys()) {
    if (!activeIds.has(messageId)) {
      measurementCache.delete(messageId);
    }
  }
});

function estimateSize(index) {
  const message = props.messages[index];
  if (!message) return props.estimatedHeight;
  
  const cached = measurementCache.get(message.id);
  if (cached) return cached;
  
  // Estimate based on content length
  const content = message.content || message.reasoning || '';
  const lines = Math.ceil(content.length / 50);
  const baseHeight = message.role === 'assistant' ? 120 : 80;
  return Math.min(baseHeight + lines * 24, 600);
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.messages.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize,
    overscan: props.overscan
  }))
);

// Measure actual rendered items
function measureElement(el) {
  if (!el) return;
  virtualizer.measureElement?.(el);

  const messageId = el.dataset?.messageId;
  if (!messageId) return;
  
  const height = Math.ceil(el.getBoundingClientRect().height);
  if (height > 0) {
    measurementCache.set(messageId, height);
  }
}

function getScrollElement() {
  return scrollContainerRef.value;
}

function scrollToBottom(smooth = false) {
  const container = scrollContainerRef.value;
  if (!container) return;
  const top = Math.max(0, container.scrollHeight - container.clientHeight);
  
  if (smooth) {
    container.scrollTo({
      top,
      behavior: 'smooth'
    });
  } else {
    container.scrollTop = top;
  }
}

function isNearBottom(threshold = 120) {
  const container = scrollContainerRef.value;
  if (!container) return true;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

defineExpose({
  scrollToBottom,
  isNearBottom,
  scrollContainerRef,
  getScrollElement,
  measureElement
});

function handleScroll(event) {
  emit('scroll', event);
}

function handleWheel(event) {
  emit('wheel', event);
}

function handleTouchstart(event) {
  emit('touchstart', event);
}

function handleTouchmove(event) {
  emit('touchmove', event);
}
</script>

<template>
  <div
    ref="scrollContainerRef"
    class="virtual-scroll-container"
    @scroll.passive="handleScroll"
    @wheel.passive="handleWheel"
    @touchstart.passive="handleTouchstart"
    @touchmove.passive="handleTouchmove"
  >
    <div
      class="virtual-scroll-spacer"
      :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }"
    >
      <div
        v-for="item in virtualizer.getVirtualItems()"
        :key="item.key"
        :ref="measureElement"
        class="virtual-scroll-item"
        :data-index="item.index"
        :data-message-id="messages[item.index]?.id"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${item.start}px)`
        }"
      >
        <slot
          :message="messages[item.index]"
          :index="item.index"
          :measure="measureElement"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-scroll-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.virtual-scroll-spacer {
  width: 100%;
}

.virtual-scroll-item {
  width: 100%;
}
</style>
