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
  <div v-if="open" class="confirmation-layer" @keydown="handleKeydown">
    <button class="confirmation-backdrop" type="button" aria-label="取消确认" @click="!busy && emit('cancel')"></button>
    <section
      ref="dialogRef"
      class="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
    >
      <header>
        <span class="confirmation-icon" aria-hidden="true"><AlertTriangle :size="20" /></span>
        <h2 id="confirmation-title">{{ title }}</h2>
        <button type="button" class="icon-button" aria-label="取消确认" title="取消" :disabled="busy" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>
      </header>
      <p id="confirmation-message">{{ message }}</p>
      <footer>
        <button ref="cancelRef" type="button" class="button secondary" :disabled="busy" @click="emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button type="button" class="button" :class="danger ? 'danger' : 'primary'" :disabled="busy" @click="emit('confirm')">
          {{ busy ? '处理中' : confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.confirmation-layer { position: fixed; inset: 0; z-index: 1600; display: grid; place-items: center; padding: 16px; }
.confirmation-backdrop { position: absolute; inset: 0; border: 0; background: #0008; }
.confirmation-dialog { position: relative; width: min(440px, 100%); padding: 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); box-shadow: 0 16px 64px #0004; }
header, footer { display: flex; align-items: center; gap: 10px; }
h2 { flex: 1; margin: 0; font-size: 18px; } p { margin: 18px 0; line-height: 1.6; } footer { justify-content: flex-end; }
button { min-height: 36px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; color: inherit; background: var(--surface); cursor: pointer; font: inherit; }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; } button:disabled { opacity: .5; cursor: default; }
.icon-button { padding: 6px; } .danger { color: white; background: var(--danger); } .primary { color: white; background: var(--primary); }
</style>
