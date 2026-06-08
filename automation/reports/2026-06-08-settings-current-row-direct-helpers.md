# Settings current-row direct helpers

## Summary

- Added a shared `getListItemById` direct list scanner in `SettingsView`.
- Routed tag, preset, mod, and regex current-row guards through the shared helper.
- Routed Mod drag reorder through the existing direct move helper so it reuses the same optimistic update, id list, and rollback path as regex reorder.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-settings-current-row-direct-helpers.md`

## Validation

- `node --test backend\src\tests\frontendSettingsView.test.js` passed: 11 tests.
- `node scripts/check-encoding.mjs` passed: 421 files scanned.
- `npm.cmd run build` passed in `frontend`.
- `npm.cmd test` passed in `backend`: 762 tests.
- `git diff --check` passed with CRLF normalization warnings only.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed.

## Next Recommended Task

- Continue the UI freshness/performance audit by converting remaining deep equality helpers in `WorldBookView.vue` or `useChatSubmit.js` from `.every()` callback chains to direct loops.
