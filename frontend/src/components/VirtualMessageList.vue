<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
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
  },
  virtualize: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['scroll', 'wheel', 'touchstart', 'touchmove']);

const scrollContainerRef = ref(null);
const measurementCache = new Map();
const messageRenderKeys = new WeakMap();
const messageKeysById = new Map();
let nextMessageRenderKey = 1;
let scrollRequestId = 0;
const activeMessageRenderKeys = computed(() => (
  props.messages.map((message, index) => getMessageRenderKey(message, index))
));

watch(activeMessageRenderKeys, (keys) => {
  const activeKeys = new Set(keys);
  const activeIds = new Set(props.messages.map((message) => message?.id));
  for (const id of messageKeysById.keys()) {
    if (!activeIds.has(id)) messageKeysById.delete(id);
  }
  for (const renderKey of measurementCache.keys()) {
    if (!activeKeys.has(renderKey)) {
      measurementCache.delete(renderKey);
    }
  }
});

function getMessageRenderKey(message, index) {
  if (!message || (typeof message !== 'object' && typeof message !== 'function')) {
    return `message-fallback-${index}`;
  }
  // Object identity keeps a local draft mounted when its server ID arrives;
  // ID identity keeps the same row mounted when a refresh returns a new object.
  const messageId = message.id;
  let renderKey = messageRenderKeys.get(message) || (messageId && messageKeysById.get(messageId));
  if (!renderKey) {
    renderKey = `message-${nextMessageRenderKey}`;
    nextMessageRenderKey += 1;
  }
  messageRenderKeys.set(message, renderKey);
  if (messageId) messageKeysById.set(messageId, renderKey);
  return renderKey;
}

function estimateSize(index) {
  const message = props.messages[index];
  if (!message) return props.estimatedHeight;
  
  const cached = measurementCache.get(getMessageRenderKey(message, index));
  if (cached) return cached;
  
  // Estimate based on content length
  const content = message.content || message.reasoning || '';
  const lines = Math.ceil(content.length / 50);
  const baseHeight = message.role === 'assistant' ? 120 : 80;
  return Math.min(baseHeight + lines * 24, 600);
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.virtualize ? props.messages.length : 0,
    getScrollElement: () => scrollContainerRef.value,
    getItemKey: (index) => getMessageRenderKey(props.messages[index], index),
    estimateSize,
    // Apply observer-driven size corrections outside the ResizeObserver delivery
    // cycle so content reflow cannot recursively trigger measurement writes.
    useAnimationFrameWithResizeObserver: true,
    overscan: props.overscan
  }))
);

// Measure actual rendered items
function measureElement(el) {
  if (!el) return;
  virtualizer.value?.measureElement?.(el);

  const renderKey = el.dataset?.messageRenderKey;
  if (!renderKey) return;
  
  const height = Math.ceil(el.getBoundingClientRect().height);
  if (height > 0) {
    measurementCache.set(renderKey, height);
  }
}

function getScrollElement() {
  return scrollContainerRef.value;
}

function scrollToBottom(smooth = false) {
  const requestId = ++scrollRequestId;
  if (props.virtualize && props.messages.length) {
    const scrollToLastMessage = () => virtualizer.value?.scrollToIndex?.(props.messages.length - 1, {
      align: 'end',
      behavior: 'auto'
    });
    if (typeof virtualizer.value?.scrollToIndex !== 'function') return false;
    scrollToLastMessage();
    nextTick(() => {
      if (requestId !== scrollRequestId) return;
      // ResizeObserver measures changed rows. A global measure() here discards
      // every cached height and makes long conversations jump on each update.
      scrollToLastMessage();
      nextTick(() => {
        if (requestId === scrollRequestId) scrollContainerToBottom(smooth);
      });
    });
    return true;
  }
  return scrollContainerToBottom(smooth);
}

function scrollContainerToBottom(smooth) {
  const container = scrollContainerRef.value;
  if (!container) return false;
  const top = Math.max(0, container.scrollHeight - container.clientHeight);
  
  if (smooth) {
    container.scrollTo({
      top,
      behavior: 'smooth'
    });
  } else {
    container.scrollTop = top;
  }
  return true;
}

function scrollToMessage(messageId, options = {}) {
  scrollRequestId += 1;
  const targetId = String(messageId || '');
  if (!targetId) return false;
  let targetIndex = -1;
  for (let index = 0; index < props.messages.length; index += 1) {
    if (String(props.messages[index]?.id || '') === targetId) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return false;
  if (!props.virtualize) {
    const target = scrollContainerRef.value?.querySelector?.(`[data-message-id="${cssEscape(targetId)}"]`);
    target?.scrollIntoView?.({ behavior: options.smooth === false ? 'auto' : 'smooth', block: options.block || 'end' });
    return Boolean(target);
  }
  virtualizer.value?.scrollToIndex?.(targetIndex, {
    align: options.block === 'start' ? 'start' : options.block === 'center' ? 'center' : 'end',
    behavior: options.smooth === false ? 'auto' : 'smooth'
  });
  return true;
}

function scrollToOffset(top) {
  if (!props.virtualize || typeof virtualizer.value?.scrollToOffset !== 'function') return false;
  scrollRequestId += 1;
  virtualizer.value.scrollToOffset(top, { behavior: 'auto' });
  return true;
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
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
  measureElement,
  scrollToOffset,
  scrollToMessage
});

function handleScroll(event) {
  emit('scroll', event);
}

function handleWheel(event) {
  scrollRequestId += 1;
  emit('wheel', event);
}

function handleTouchstart(event) {
  scrollRequestId += 1;
  emit('touchstart', event);
}

function handleTouchmove(event) {
  scrollRequestId += 1;
  emit('touchmove', event);
}

onBeforeUnmount(() => { scrollRequestId += 1; });
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
    <slot v-if="!messages.length" name="empty" />
    <div
      v-if="virtualize && messages.length"
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
        :data-message-render-key="getMessageRenderKey(messages[item.index], item.index)"
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
    <template v-else>
      <div
        v-for="(message, index) in messages"
        :key="getMessageRenderKey(message, index)"
        class="virtual-scroll-static-item"
        :data-message-id="message.id"
        :data-message-render-key="getMessageRenderKey(message, index)"
      >
        <slot :message="message" :index="index" :measure="measureElement" />
      </div>
    </template>
    <slot name="footer" />
  </div>
</template>

<style scoped>
.virtual-scroll-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.virtual-scroll-spacer {
  flex: 0 0 auto;
  width: 100%;
}

.virtual-scroll-item {
  width: 100%;
}

.virtual-scroll-static-item {
  width: 100%;
}
</style>
