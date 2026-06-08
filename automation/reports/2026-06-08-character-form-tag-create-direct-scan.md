# 2026-06-08 CharacterForm Tag Create Direct Scan

## Goal

Keep the CharacterForm tag-create button state cheap and predictable during tag search input updates.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Changes

- Moved tag-create visibility out of the template into `canCreateSearchedTag`.
- Replaced the inline `availableTags.some(...)` render-time callback with a direct helper scan.
- Added source-test coverage for the computed helper and template binding.

## Validation

- PASS: `node --test backend\src\tests\frontendCharacterFormView.test.js` (15 tests passed)
- PASS: `npm.cmd test` in `backend` (824 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue reviewing inline template conditions that rescan large reactive lists during input-driven renders.
