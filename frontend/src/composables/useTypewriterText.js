import { computed, onScopeDispose, ref, watch } from 'vue';

const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const TYPEWRITER_FRAME_INTERVAL_MS = 32;

export function useTypewriterText(source, streaming, onProgress = null) {
  const displayedText = ref('');
  const targetText = ref('');
  let frameId = null;
  let initialized = false;
  let wasStreaming = Boolean(streaming.value);
  let lastAdvanceTime = 0;

  const isTyping = computed(() => (
    Boolean(streaming.value) || displayedText.value !== targetText.value
  ));

  function cancelFrame() {
    if (frameId === null) return;
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameId);
    } else {
      clearTimeout(frameId);
    }
    frameId = null;
  }

  function scheduleFrame() {
    if (frameId !== null) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);
    frameId = schedule(advanceFrame);
  }

  function advanceFrame(timestamp) {
    frameId = null;
    if (displayedText.value === targetText.value) return;
    const frameTime = Number.isFinite(timestamp)
      ? timestamp
      : lastAdvanceTime + TYPEWRITER_FRAME_INTERVAL_MS;
    if (
      streaming.value
      && lastAdvanceTime
      && frameTime - lastAdvanceTime < TYPEWRITER_FRAME_INTERVAL_MS
    ) {
      scheduleFrame();
      return;
    }
    lastAdvanceTime = frameTime;
    if (!targetText.value.startsWith(displayedText.value)) {
      displayedText.value = getCommonGraphemePrefix(displayedText.value, targetText.value);
      if (typeof onProgress === 'function') {
        onProgress(displayedText.value);
      }
      if (displayedText.value !== targetText.value) {
        scheduleFrame();
      }
      return;
    }

    const pending = splitGraphemes(targetText.value.slice(displayedText.value.length));
    const divisor = streaming.value ? 10 : 3;
    const limit = streaming.value ? 48 : 160;
    const count = Math.min(limit, Math.max(1, Math.ceil(pending.length / divisor)));
    displayedText.value += pending.slice(0, count).join('');
    if (typeof onProgress === 'function') {
      onProgress(displayedText.value);
    }
    if (displayedText.value !== targetText.value) {
      scheduleFrame();
    }
  }

  watch(
    [source, streaming],
    ([nextText, active]) => {
      targetText.value = String(nextText ?? '');
      if (!initialized) {
        displayedText.value = targetText.value;
        initialized = true;
        wasStreaming = Boolean(active);
        return;
      }
      if (!active && !wasStreaming) {
        cancelFrame();
        lastAdvanceTime = 0;
        displayedText.value = targetText.value;
        wasStreaming = false;
        return;
      }
      wasStreaming = Boolean(active);
      if (!active) {
        lastAdvanceTime = 0;
      }
      if (displayedText.value !== targetText.value) {
        scheduleFrame();
      }
    },
    { immediate: true }
  );

  onScopeDispose(cancelFrame);

  return { displayedText, isTyping };
}

function splitGraphemes(text) {
  if (!text) return [];
  if (!graphemeSegmenter) return Array.from(text);
  const segments = [];
  for (const part of graphemeSegmenter.segment(text)) {
    segments.push(part.segment);
  }
  return segments;
}

function getCommonGraphemePrefix(left, right) {
  const leftParts = splitGraphemes(left);
  const rightParts = splitGraphemes(right);
  const count = Math.min(leftParts.length, rightParts.length);
  let prefixLength = 0;
  while (prefixLength < count && leftParts[prefixLength] === rightParts[prefixLength]) {
    prefixLength += 1;
  }
  return leftParts.slice(0, prefixLength).join('');
}
