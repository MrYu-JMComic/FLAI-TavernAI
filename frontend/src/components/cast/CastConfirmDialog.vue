<script setup>
import { nextTick, ref, watch } from 'vue';
import { AlertTriangle, X } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  cancelLabel: { type: String, default: '取消' },
  danger: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'cancel']);
const dialogRef = ref(null);
const cancelRef = ref(null);

watch(() => props.open, async (open) => {
  if (!open) return;
  await nextTick();
  cancelRef.value?.focus({ preventScroll: true });
});

function handleKeydown(event) {
  if (event.key === 'Escape' && !props.busy) {
    event.stopPropagation();
    emit('cancel');
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = dialogRef.value?.querySelectorAll?.(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable?.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div v-if="open" class="cast-confirm-layer" @keydown="handleKeydown">
    <button class="cast-confirm-backdrop" type="button" aria-label="取消确认" @click="!busy && emit('cancel')"></button>
    <section
      ref="dialogRef"
      class="cast-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cast-confirm-title"
      aria-describedby="cast-confirm-message"
    >
      <header>
        <span class="cast-confirm-icon" aria-hidden="true"><AlertTriangle :size="20" /></span>
        <h2 id="cast-confirm-title">{{ title }}</h2>
        <button type="button" class="cast-icon-button" aria-label="取消确认" title="取消" :disabled="busy" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>
      <p id="cast-confirm-message">{{ message }}</p>
      <footer>
        <button ref="cancelRef" type="button" class="cast-button secondary" :disabled="busy" @click="emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button type="button" class="cast-button" :class="danger ? 'danger' : 'primary'" :disabled="busy" @click="emit('confirm')">
          {{ busy ? '处理中' : confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>
