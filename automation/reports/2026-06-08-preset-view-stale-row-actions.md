# PresetView Stale Row Actions

## Summary

- Reviewed `PresetView` list row actions for stale events after preset list refreshes.
- Routed edit, delete, and set-default actions through a current-list lookup before mutating UI state or calling the API.
- Kept confirmation and success labels sourced from the current preset row rather than an older event payload.
- Replaced the preset-list equality helper's `.every()` callback with a direct loop.

## Changed Files

- `frontend/src/views/PresetView.vue`
- `backend/src/tests/frontendPresetView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-preset-view-stale-row-actions.md`

## Validation

- PASS: `node --test backend\src\tests\frontendPresetView.test.js`
  - Result: 4 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 401 files; no common Chinese mojibake markers found.
- PASS: `npm.cmd run build` in `frontend`
  - Result: Vite production build completed.
- PASS: `npm.cmd test` in `backend`
  - Result: 748 tests passed.
- PASS: `git diff --check`
  - Result: no whitespace errors; Git reported line-ending normalization warnings only.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 748 tests, frontend build passed, review gate passed.

## Existing Worktree Notes

- Preserved existing unrelated changes in provider parsing, frontend API tests, CharacterForm/world-book dialog work, EconomyPanel, NpcPanel, WorldBookView, and earlier automation reports.

## Next Recommended Task

- Continue auditing row-action handlers in list-heavy views so stale row objects cannot drive UI state or API mutations after a refresh.
