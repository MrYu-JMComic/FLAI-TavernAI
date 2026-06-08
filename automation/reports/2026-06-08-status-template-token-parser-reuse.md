# 2026-06-08 Status Template Token Parser Reuse

## Goal

Keep status-template placeholder parsing consistent across frontend and backend paths while avoiding duplicated split/map parsing.

## Changed Files

- `backend/src/services/accessoryAgents.js`
- `frontend/src/views/CharacterFormView.vue`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/frontendCharacterFormView.test.js`
- `automation/backlog.md`

## Changes

- Routed accessory-agent status-template placeholder parsing through the shared `parseStatusTemplateToken` helper.
- Routed CharacterFormView composite placeholder parsing through the same shared helper.
- Added source guards in backend and frontend tests so both paths preserve the complete property suffix without returning to `token.split('.').map(...)`.

## Validation

- PASS: `node --test backend\src\tests\accessoryAgents.test.js backend\src\tests\frontendCharacterFormView.test.js backend\src\tests\statusTemplateTokens.test.js` (32 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 500 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (810 backend/source tests passed; frontend build passed)

## Next

- Continue scanning status-template and character-form refresh paths for duplicated parsing and no-op reactive writes.
