# 2026-06-08 Settings Regex Group Options Cache

## Summary

SettingsView now keeps regex group filter options in a dedicated cached list instead of deriving them only from the currently displayed rules. Filtered regex-rule refreshes preserve previously known groups and the active selected group, so the group dropdown does not collapse to only the current page of filtered rules.

## Changed Files

- `frontend/src/views/SettingsView.vue`
  - Added `regexGroupOptions` as the source for regex group filter options.
  - Synced group options after regex-rule loads while preserving the active selected group during filtered loads.
  - Replaced the Set/spread computed group derivation with direct helper loops and no-op-aware list updates.
- `backend/src/tests/frontendSettingsView.test.js`
  - Added source coverage for cached regex group options, filtered refresh preservation, direct group normalization, and removal of the old Set/spread derivation.
- `automation/backlog.md`
  - Recorded this completed autonomous iteration.

## Validation

- PASS: `node --test src/tests/frontendSettingsView.test.js` in `backend` (12 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 541 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (837 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

Continue auditing filtered option lists that derive choices only from the currently visible subset, especially settings panels where filtering can hide valid selected values.
