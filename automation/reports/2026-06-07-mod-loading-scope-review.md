# 2026-06-07 Mod Loading Scope Review

## Summary

Reviewed the Mod loading-scope change for logic and functional regressions. One edge case was fixed during review: legacy or previously saved `characters`-scope Mods with empty bindings can no longer be enabled and silently become active-but-never-applied.

## Changed Files

- `backend/src/modules/mods.js`
- `backend/src/tests/backend.test.js`

## Findings And Fixes

- Fixed backend normalization so an unbound selected-character Mod is rejected when created, explicitly edited, or enabled.
- Still allows disabling a legacy invalid selected-character Mod, so users are not blocked from turning bad old data off.
- Added regression coverage for the legacy empty-binding enable path.
- Rechecked frontend routing: `settings` and `extensions` both use `SettingsView.vue`, but `App.vue` keys the rendered component by route name, so entering the extensions page remounts and loads Mod/character options correctly.

## Validation

- `npm.cmd test` in `backend`: PASS, 438 tests.
- `npm.cmd run build` in `frontend`: PASS.
- `node scripts/check-encoding.mjs`: PASS, scanned 413 files.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS.

## Notes

- The worktree already contained many unrelated modified and untracked files before this review; this run only changed the two Mod-review files listed above plus this report.
- No remaining blocking issues were found in the reviewed Mod loading-scope path.
