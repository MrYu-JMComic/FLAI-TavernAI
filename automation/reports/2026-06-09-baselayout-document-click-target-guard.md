# 2026-06-09 - BaseLayout Document Click Target Guard

## Changed Files

- `frontend/src/components/BaseLayout.vue`
- `backend/src/tests/frontendBaseLayout.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-baselayout-document-click-target-guard.md`

## Summary

- Guarded BaseLayout document click handling before calling `contains()` on the user menu root.
- Added source coverage so malformed or missing document click targets close the menu without throwing.

## Validation

- PASS: `node --test src/tests/frontendBaseLayout.test.js` in `backend` (1 test)
- PASS: `node scripts/check-encoding.mjs` (scanned 547 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (843 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue reviewing remaining global pointer/click handlers in App, ChatView, and StatusBar for malformed event target assumptions.
