# 2026-06-09 - StatusBar Template Click Target Guard

## Changed Files

- `frontend/src/components/StatusBar.vue`
- `backend/src/tests/frontendStatusBar.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-statusbar-template-click-target-guard.md`

## Summary

- Guarded the StatusBar custom-template click handler so missing or malformed event targets are ignored instead of throwing before action dispatch.
- Added source coverage to keep the handler aligned with the event-target guards used by the other UI input/click paths.

## Validation

- PASS: `node --test src/tests/frontendStatusBar.test.js` in `backend` (5 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 553 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (847 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing custom-template and delegated-click handlers for malformed event assumptions.
