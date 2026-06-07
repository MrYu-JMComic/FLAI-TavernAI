# Autonomous Report: Virtual Message List Audit

## Summary

Audited `VirtualMessageList.vue` as an unreferenced Vue component candidate. It is a plausible long-chat performance component, but directly wiring it into `ChatView.vue` would be risky today because the current chat scroll system expects `messageScroller` to be a real DOM element and message actions depend on DOM query anchors inside that scroller.

The safe improvement was to harden the dormant virtual list component and record why it should not be wired into chat until a component-backed scroller adapter is designed.

## Changed Files

- `frontend/src/components/VirtualMessageList.vue`
  - Removed unused Vue imports.
  - Prunes cached measurements when message IDs leave the list.
  - Passes rendered rows into `virtualizer.measureElement`.
  - Adds `data-index` for virtualizer measurement.
  - Rounds measured heights before caching.
  - Exposes `getScrollElement()` for future adapter work.
  - Uses a clamped bottom scroll target and inclusive near-bottom check.
- `automation/backlog.md`
  - Notes that `VirtualMessageList.vue` has been audited and hardened, but still needs scroll contract work before wiring.

## Evidence

- `ChatView.vue` binds `messageScroller` to a native `.deep-message-scroll` element.
- `useChatScroll` reads and writes `scrollTop`, `scrollHeight`, `clientHeight`, and calls `scrollTo()` directly.
- `useChatMessageActions` restores delete/edit anchors by querying `.deep-message` elements inside `messageScroller`.
- `StatusBar` is injected after the latest assistant message inside the current message loop.
- `VirtualMessageList.vue` would need a wrapper/adapter before it can preserve those behaviors under virtualization.

## Validation

- PASS: Vue SFC compile check for `src/components/VirtualMessageList.vue`
- PASS: `node scripts/find-unreferenced-vue-components.mjs`
  - Remaining candidates: `ExtensionManager.vue`, `VirtualMessageList.vue`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue diagnostic reports 2 candidates.
  - Backend tests passed: 392/392.
  - Frontend build passed.
- PASS: post-report `node scripts/check-encoding.mjs`
  - Scanned 326 files after this report was added.

## Remaining Attention

Do not delete `VirtualMessageList.vue` yet; it is a hardened dormant performance component. The next safe performance step would be to design a small scroller adapter for `useChatScroll` and message anchor restoration before attempting to render chat messages through virtualization.

`ExtensionManager.vue` remains the other unreferenced component candidate and should stay separate from the current backend-backed Mod/extension page unless a clear runtime use case is established.
