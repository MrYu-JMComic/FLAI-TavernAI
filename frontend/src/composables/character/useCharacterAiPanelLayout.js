import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { recordFrontendDiagnostic } from '../../diagnostics.js';
import { callEventMethod } from '../../utils/eventMethods';

const AI_PANEL_STORAGE_KEY = 'cf-ai-panel-pos';
const AI_PANEL_VIEWPORT_GAP = 0;
const AI_PANEL_DRAG_THRESHOLD = 8;
const AI_PANEL_MIN_WIDTH = 320;
const AI_PANEL_MIN_HEIGHT = 180;
const AI_PANEL_DEFAULT_HEIGHT = 640;

export function useCharacterAiPanelLayout({
  getScrollContainer = () => null,
  scheduleSectionNavSync = () => {}
} = {}) {
  const AI_PANEL_DEFAULT = (() => {
    try {
      return { x: Math.max(16, window.innerWidth - 460), y: 96, w: 420, h: getAiPanelDefaultHeight() };
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiPanel.defaultPosition', error, { storageKey: AI_PANEL_STORAGE_KEY });
      return { x: 16, y: 96, w: 420, h: AI_PANEL_DEFAULT_HEIGHT };
    }
  })();
  const aiPanelRef = ref(null);
  const aiPanelPos = ref(loadAiPanelPos());
  const aiPanelSize = ref(loadAiPanelSize());
  const aiPanelDragging = ref(false);
  let aiPanelDragTracking = false;
  let aiPanelResizing = false;
  let aiPanelLayoutRafId = null;
  let aiPanelResizeObserver = null;
  let pendingAiPanelSizeSync = false;
  let skipFirstAiPanelResize = true;
  let characterScrollListenerTarget = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStarted = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartWidth = 0;
  let resizeStartHeight = 0;

  function getAiPanelDefaultHeight() {
    try {
      return Math.max(
        AI_PANEL_MIN_HEIGHT,
        Math.min(AI_PANEL_DEFAULT_HEIGHT, window.innerHeight - 112)
      );
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiPanel.defaultHeight', error, { fallbackHeight: AI_PANEL_DEFAULT_HEIGHT });
      return AI_PANEL_DEFAULT_HEIGHT;
    }
  }

  function loadAiPanelPos() {
    try {
      const raw = localStorage.getItem(AI_PANEL_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.x === 'number' && typeof data.y === 'number') {
          return { x: data.x, y: data.y };
        }
      }
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiPanel.loadPosition', error, { storageKey: AI_PANEL_STORAGE_KEY });
    }
    return { x: AI_PANEL_DEFAULT.x, y: AI_PANEL_DEFAULT.y };
  }

  function loadAiPanelSize() {
    try {
      const raw = localStorage.getItem(AI_PANEL_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.w === 'number' && typeof data.h === 'number' && data.w > 0) {
          return {
            w: Math.max(AI_PANEL_MIN_WIDTH, data.w),
            h: data.h >= AI_PANEL_MIN_HEIGHT ? data.h : AI_PANEL_DEFAULT.h
          };
        }
      }
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiPanel.loadSize', error, { storageKey: AI_PANEL_STORAGE_KEY });
    }
    return { w: AI_PANEL_DEFAULT.w, h: AI_PANEL_DEFAULT.h };
  }

  function saveAiPanelState() {
    try {
      localStorage.setItem(AI_PANEL_STORAGE_KEY, JSON.stringify({
        x: aiPanelPos.value.x,
        y: aiPanelPos.value.y,
        w: aiPanelSize.value.w,
        h: aiPanelSize.value.h
      }));
    } catch (error) {
      recordFrontendDiagnostic('characterForm.aiPanel.saveState', error, { storageKey: AI_PANEL_STORAGE_KEY });
    }
  }

  function getAiPanelSafeTop() {
    if (window.innerWidth <= 760) {
      return 0;
    }
    return Math.max(
      AI_PANEL_VIEWPORT_GAP,
      readElementBottom('.topbar'),
      readElementBottom('.section-heading'),
      readElementBottom('.character-section-nav')
    );
  }

  function readElementBottom(selector) {
    const bottom = document.querySelector(selector)?.getBoundingClientRect().bottom;
    return Math.ceil(Number.isFinite(bottom) ? bottom : 0);
  }

  function getAiPanelElement() {
    return aiPanelRef.value?.getPanelElement?.() || aiPanelRef.value;
  }

  function getAiPanelMeasuredSize(fallback = aiPanelSize.value) {
    const rect = getAiPanelElement()?.getBoundingClientRect();
    return {
      w: rect?.width > 0 ? rect.width : fallback.w,
      h: rect?.height > 0 ? rect.height : fallback.h || 200
    };
  }

  function clampAiPanelPos(x, y, size = getAiPanelMeasuredSize()) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = size.w;
    const h = size.h || 200;
    const minX = AI_PANEL_VIEWPORT_GAP;
    const minY = getAiPanelSafeTop();
    const maxX = Math.max(minX, vw - w - AI_PANEL_VIEWPORT_GAP);
    const maxY = Math.max(minY, vh - h - AI_PANEL_VIEWPORT_GAP);
    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: Math.max(minY, Math.min(y, maxY))
    };
  }

  function readAiPanelPointerPoint(event) {
    const source = event?.touches?.[0] || event;
    const clientX = source?.clientX;
    const clientY = source?.clientY;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }
    return { clientX, clientY };
  }

  function onAiPanelDragStart(e) {
    if (window.innerWidth <= 760 || aiPanelResizing) return;
    const point = readAiPanelPointerPoint(e);
    if (!point) return;
    const panel = getAiPanelElement();
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragStartX = point.clientX;
    dragStartY = point.clientY;
    dragOffsetX = point.clientX - rect.left;
    dragOffsetY = point.clientY - rect.top;
    aiPanelDragTracking = true;
    aiPanelDragging.value = false;
    dragStarted = false;
    document.addEventListener('pointermove', onAiPanelDragMove, { passive: false });
    document.addEventListener('pointerup', onAiPanelDragEnd);
    document.addEventListener('pointercancel', onAiPanelDragEnd);
  }

  function onAiPanelDragMove(e) {
    if (!aiPanelDragTracking) return;
    callEventMethod(e, 'preventDefault');
    const point = readAiPanelPointerPoint(e);
    if (!point) return;
    const distance = Math.hypot(point.clientX - dragStartX, point.clientY - dragStartY);
    if (distance < AI_PANEL_DRAG_THRESHOLD) {
      return;
    }
    dragStarted = true;
    aiPanelDragging.value = true;
    const clamped = clampAiPanelPos(point.clientX - dragOffsetX, point.clientY - dragOffsetY);
    aiPanelPos.value = { x: clamped.x, y: clamped.y };
  }

  function onAiPanelDragEnd() {
    if (!aiPanelDragTracking) return;
    aiPanelDragTracking = false;
    aiPanelDragging.value = false;
    document.removeEventListener('pointermove', onAiPanelDragMove);
    document.removeEventListener('pointerup', onAiPanelDragEnd);
    document.removeEventListener('pointercancel', onAiPanelDragEnd);
    if (dragStarted) saveAiPanelState();
    dragStarted = false;
  }

  function onAiPanelResizeStart(e) {
    if (window.innerWidth <= 760) return;
    const point = readAiPanelPointerPoint(e);
    if (!point) return;
    const panel = getAiPanelElement();
    if (!panel) return;
    callEventMethod(e, 'preventDefault');
    const rect = panel.getBoundingClientRect();
    aiPanelResizing = true;
    resizeStartX = point.clientX;
    resizeStartY = point.clientY;
    resizeStartWidth = rect.width || aiPanelSize.value.w;
    resizeStartHeight = rect.height || aiPanelSize.value.h || AI_PANEL_MIN_HEIGHT;
    document.addEventListener('pointermove', onAiPanelResizeMove, { passive: false });
    document.addEventListener('pointerup', onAiPanelResizeEnd);
    document.addEventListener('pointercancel', onAiPanelResizeEnd);
  }

  function onAiPanelResizeMove(e) {
    if (!aiPanelResizing) return;
    callEventMethod(e, 'preventDefault');
    const point = readAiPanelPointerPoint(e);
    if (!point) return;
    const nextSize = {
      w: Math.max(AI_PANEL_MIN_WIDTH, Math.round(resizeStartWidth + point.clientX - resizeStartX)),
      h: Math.max(AI_PANEL_MIN_HEIGHT, Math.round(resizeStartHeight + point.clientY - resizeStartY))
    };
    aiPanelSize.value = nextSize;
    const clamped = clampAiPanelPos(aiPanelPos.value.x, aiPanelPos.value.y, nextSize);
    if (clamped.x !== aiPanelPos.value.x || clamped.y !== aiPanelPos.value.y) {
      aiPanelPos.value = clamped;
    }
  }

  function onAiPanelResizeEnd() {
    if (!aiPanelResizing) return;
    aiPanelResizing = false;
    document.removeEventListener('pointermove', onAiPanelResizeMove);
    document.removeEventListener('pointerup', onAiPanelResizeEnd);
    document.removeEventListener('pointercancel', onAiPanelResizeEnd);
    saveAiPanelState();
  }

  function resetAiPanel() {
    aiPanelSize.value = { w: AI_PANEL_DEFAULT.w, h: AI_PANEL_DEFAULT.h };
    aiPanelPos.value = clampAiPanelPos(AI_PANEL_DEFAULT.x, AI_PANEL_DEFAULT.y, aiPanelSize.value);
    saveAiPanelState();
  }

  function syncAiPanelSizeAndPosition() {
    if (window.innerWidth <= 760 || aiPanelResizing) return;
    const panel = getAiPanelElement();
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const nextSize = {
      w: Math.max(AI_PANEL_MIN_WIDTH, Math.round(rect.width)),
      h: Math.max(AI_PANEL_MIN_HEIGHT, Math.round(rect.height))
    };
    const sizeChanged = nextSize.w !== aiPanelSize.value.w || nextSize.h !== aiPanelSize.value.h;
    if (sizeChanged) {
      aiPanelSize.value = nextSize;
    }
    const clamped = clampAiPanelPos(aiPanelPos.value.x, aiPanelPos.value.y, nextSize);
    const posChanged = clamped.x !== aiPanelPos.value.x || clamped.y !== aiPanelPos.value.y;
    if (posChanged) {
      aiPanelPos.value = clamped;
    }
    if (sizeChanged || posChanged) {
      saveAiPanelState();
    }
  }

  function syncAiPanelPosition() {
    if (window.innerWidth <= 760) return;
    const clamped = clampAiPanelPos(aiPanelPos.value.x, aiPanelPos.value.y);
    if (clamped.x !== aiPanelPos.value.x || clamped.y !== aiPanelPos.value.y) {
      aiPanelPos.value = clamped;
      saveAiPanelState();
    }
  }

  function flushScheduledAiPanelLayout() {
    const includeSize = pendingAiPanelSizeSync;
    aiPanelLayoutRafId = null;
    pendingAiPanelSizeSync = false;
    if (includeSize) {
      syncAiPanelSizeAndPosition();
      return;
    }
    syncAiPanelPosition();
  }

  function scheduleAiPanelLayoutSync({ includeSize = false } = {}) {
    if (includeSize) {
      pendingAiPanelSizeSync = true;
    }
    if (aiPanelLayoutRafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      aiPanelLayoutRafId = requestAnimationFrame(flushScheduledAiPanelLayout);
      return;
    }
    flushScheduledAiPanelLayout();
  }

  function cancelAiPanelLayoutSync() {
    if (aiPanelLayoutRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(aiPanelLayoutRafId);
    }
    aiPanelLayoutRafId = null;
    pendingAiPanelSizeSync = false;
  }

  function onObservedAiPanelResize() {
    if (skipFirstAiPanelResize) {
      skipFirstAiPanelResize = false;
      return;
    }
    scheduleAiPanelLayoutSync({ includeSize: true });
  }

  function stopAiPanelResizeObserver() {
    if (aiPanelResizeObserver) {
      aiPanelResizeObserver.disconnect();
      aiPanelResizeObserver = null;
    }
  }

  function syncAiPanelResizeObserver(el = getAiPanelElement()) {
    if (window.innerWidth <= 760 || !el || typeof window.ResizeObserver !== 'function') {
      stopAiPanelResizeObserver();
      return;
    }
    if (aiPanelResizeObserver) return;
    skipFirstAiPanelResize = true;
    aiPanelResizeObserver = new window.ResizeObserver(onObservedAiPanelResize);
    aiPanelResizeObserver.observe(el);
  }

  function onCharacterScroll() {
    scheduleSectionNavSync();
  }

  function syncCharacterScrollListener() {
    const nextTarget = getScrollContainer() || (typeof window !== 'undefined' ? window : null);
    if (characterScrollListenerTarget === nextTarget) {
      return;
    }
    if (characterScrollListenerTarget) {
      characterScrollListenerTarget.removeEventListener('scroll', onCharacterScroll);
    }
    characterScrollListenerTarget = nextTarget;
    if (characterScrollListenerTarget) {
      characterScrollListenerTarget.addEventListener('scroll', onCharacterScroll, { passive: true });
    }
  }

  function stopCharacterScrollListener() {
    if (!characterScrollListenerTarget) {
      return;
    }
    characterScrollListenerTarget.removeEventListener('scroll', onCharacterScroll);
    characterScrollListenerTarget = null;
  }

  function onWindowResize() {
    syncAiPanelResizeObserver();
    syncCharacterScrollListener();
    scheduleAiPanelLayoutSync();
    scheduleSectionNavSync();
  }

  function disposeAiPanelLayout() {
    onAiPanelDragEnd();
    onAiPanelResizeEnd();
    stopAiPanelResizeObserver();
    cancelAiPanelLayoutSync();
    stopCharacterScrollListener();
    window.removeEventListener('resize', onWindowResize);
  }

  watch(aiPanelRef, () => {
    stopAiPanelResizeObserver();
    syncAiPanelResizeObserver();
  });

  onMounted(() => {
    window.addEventListener('resize', onWindowResize);
    syncCharacterScrollListener();
    onWindowResize();
  });

  onBeforeUnmount(disposeAiPanelLayout);

  return {
    aiPanelDragging,
    aiPanelPos,
    aiPanelRef,
    aiPanelSize,
    disposeAiPanelLayout,
    onAiPanelDragStart,
    onAiPanelResizeStart,
    resetAiPanel
  };
}
