# 2026-06-07 Notification Error Fallback

## Backlog Item

- Improve frontend API error handling and user-facing messages.

## Changes

- Updated `frontend/src/App.vue` notification normalization.
- Added safe fallback text for empty error and warning notifications.
- Preserved the existing behavior that drops empty success and info notifications.
- Allowed Error-like objects, numbers, and booleans to be normalized without producing blank toasts.

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 344 files.
  - Vite production build completed successfully.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no findings.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report update scanned 344 files.

## Notes

- This is a centralized fallback for existing `notify.error(err.message)` and `notify.warning(err.message)` call sites when a non-Error value or empty message reaches the UI.
- The broader frontend API error-handling backlog item remains open for focused view-level improvements and future frontend tests.
