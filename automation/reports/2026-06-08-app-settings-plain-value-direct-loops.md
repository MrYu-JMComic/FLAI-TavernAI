# 2026-06-08 App and Settings Plain Value Direct Loops

## Goal

Keep reference-preserving refresh helpers cheap and consistent without adding new abstractions or changing UI behavior.

## Changed Files

- `frontend/src/App.vue`
- `frontend/src/views/SettingsView.vue`
- `backend/src/tests/frontendAppSessionState.test.js`
- `backend/src/tests/frontendSettingsView.test.js`
- `automation/backlog.md`

## Changes

- Reworked `App.vue` plain-value array and object comparisons to use direct index and own-key loops instead of `every` callbacks and `Object.keys` arrays.
- Reworked `SettingsView.vue` plain-value and list comparisons the same way, aligning with the existing CharacterFormView and WorldBookView refresh helpers.
- Tightened source tests so these helpers keep their direct-scan shape and do not regress back to `Object.keys` array allocation paths.

## Validation

- PASS: `node --test backend\src\tests\frontendAppSessionState.test.js backend\src\tests\frontendSettingsView.test.js` (13 tests)
- PASS: `node scripts/check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (802 backend tests, frontend build)

## Next

- Continue preferring fixture-backed cleanup or small reference-preservation improvements over speculative broad rewrites.
