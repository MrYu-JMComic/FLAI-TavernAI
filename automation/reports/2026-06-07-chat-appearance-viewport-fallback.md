# 2026-06-07 Chat Appearance Viewport Fallback

## Goal

Remove a leftover direct `matchMedia` call from chat appearance scripting context so custom scripts keep working in runtimes that only expose `innerWidth`.

## Changes

- Reused the shared `isPhoneViewport()` helper in `frontend/src/utils/chatAppearance.js`.
- Added coverage that `buildChatScriptContext().isMobile` uses the viewport fallback when `window.matchMedia` is unavailable.

## Files Touched

- `frontend/src/utils/chatAppearance.js`
- `backend/src/tests/frontendViewport.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendViewport.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 463 tests.
  - Frontend build passed.

## Notes

- This is a small robustness cleanup only; it does not change the intended desktop/mobile breakpoint.
