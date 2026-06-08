# 2026-06-08 Home Import File Input Busy State

## Summary

HomeView character import file inputs now clear their selected value before early returns and stay disabled while an import confirmation is pending. This prevents stale file selections from blocking immediate same-file retries and keeps hidden import inputs aligned with the visible importing state.

## Changed Files

- `frontend/src/views/HomeView.vue`
  - Cleared the file input before busy, missing-file, or inactive-home returns in `handleImportFile`.
  - Disabled both character import file inputs while `importLoading` is active.
- `frontend/src/styles.css`
  - Added a disabled visual state for Home import file labels.
- `backend/src/tests/frontendHomeView.test.js`
  - Added source coverage for the input-clearing order and disabled import file bindings.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendHomeView.test.js` in `backend` (11 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 539 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (836 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing import and mutation flows for hidden inputs or stale busy state that can block immediate retries after canceled or ignored UI events.
