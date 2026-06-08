# 2026-06-08 CharacterForm AI Draft Seed Direct Scan

## Goal

Avoid rebuilding seed-field arrays while checking whether the AI assistant should use the current character draft.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Changes

- Hoisted the AI draft seed field list into one stable constant.
- Replaced the per-call array literal plus `.some(...)` callback with a direct seed-field loop.
- Kept tag and regex-rule seed behavior intact while guarding against non-array payload fields.
- Added source-test coverage to keep the helper on the direct-scan path.

## Validation

- PASS: `node --test backend\src\tests\frontendCharacterFormView.test.js` (15 tests passed)
- PASS: `npm.cmd test` in `backend` (824 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue reviewing small AI and settings state checks that allocate arrays during repeated UI decisions.
