<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { RotateCcw, X, ZoomIn, ZoomOut } from '@lucide/vue';

const props = defineProps({
  sourceElement: { type: Object, required: true }
});

const emit = defineEmits(['close']);
const dialogRef = ref(null);
const closeButtonRef = ref(null);
const viewportRef = ref(null);
const sourceHostRef = ref(null);
const zoom = ref(1);
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`);
const canZoomOut = computed(() => zoom.value > 0.75);
const canZoomIn = computed(() => zoom.value < 2);
let previousFocus = null;
let previousBodyOverflow = '';

onMounted(async () => {
  previousFocus = document.activeElement;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  mountPreviewSource();
  await nextTick();
  viewportRef.value?.scrollTo({ top: 0, left: 0 });
  closeButtonRef.value?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow;
  if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
    previousFocus.focus({ preventScroll: true });
  }
});

function mountPreviewSource() {
  const host = sourceHostRef.value;
  if (!host || typeof props.sourceElement?.cloneNode !== 'function') return;
  host.replaceChildren(props.sourceElement.cloneNode(true));
}

function updateZoom(step) {
  zoom.value = Math.min(2, Math.max(0.75, Number((zoom.value + step).toFixed(2))));
}

function resetZoom() {
  zoom.value = 1;
}

function requestClose() {
  emit('close');
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== 'Tab') return;

  const dialog = dialogRef.value;
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="katex-preview" appear>
      <div class="katex-preview-overlay" @click.self="requestClose">
        <section
          ref="dialogRef"
          class="katex-preview-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="katex-preview-title"
          aria-keyshortcuts="Escape"
          tabindex="-1"
          @keydown="handleDialogKeydown"
        >
          <header class="katex-preview-header">
            <h2 id="katex-preview-title">公式预览</h2>
            <div class="katex-preview-actions">
              <div class="katex-preview-zoom-controls" role="group" aria-label="调整预览大小">
                <button
                  class="icon-button katex-preview-action"
                  type="button"
                  title="缩小"
                  aria-label="缩小公式预览"
                  :disabled="!canZoomOut"
                  @click="updateZoom(-0.25)"
                >
                  <ZoomOut :size="19" />
                </button>
                <button
                  class="icon-button katex-preview-action"
                  type="button"
                  title="恢复 100%"
                  aria-label="恢复公式预览到 100%"
                  :disabled="zoom === 1"
                  @click="resetZoom"
                >
                  <RotateCcw :size="18" />
                </button>
                <output class="katex-preview-zoom-value" aria-live="polite">{{ zoomPercent }}</output>
                <button
                  class="icon-button katex-preview-action"
                  type="button"
                  title="放大"
                  aria-label="放大公式预览"
                  :disabled="!canZoomIn"
                  @click="updateZoom(0.25)"
                >
                  <ZoomIn :size="19" />
                </button>
              </div>
              <button
                ref="closeButtonRef"
                class="icon-button katex-preview-action"
                type="button"
                title="关闭"
                aria-label="关闭公式预览"
                @click="requestClose"
              >
                <X :size="20" />
              </button>
            </div>
          </header>

          <div ref="viewportRef" class="katex-preview-viewport">
            <div class="katex-preview-canvas">
              <div
                ref="sourceHostRef"
                class="katex-preview-source"
                :style="{ '--katex-preview-zoom': zoom }"
              />
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
