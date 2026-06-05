# Status Variable Limit 60

Date: 2026-06-06

## Scope

Raise the status bar and character status blueprint variable limit from 20 to 60.

## Changed Files

- `backend/src/modules/advancedSettings.js`
- `backend/src/modules/statusBars.js`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/backend.test.js`
- `backend/src/validations/schemas.js`
- `frontend/src/views/CharacterFormView.vue`

## Change

- Added named constants for the backend status blueprint and status bar variable limits.
- Increased normalization and template inference limits from 20 to 60.
- Increased schema validation for character status blueprint variables to 60.
- Added regression tests for late inferred template placeholders and schema max validation.
- Updated the status extraction comment so it no longer references the old 20-variable cap.

## Validation

- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 239 backend tests, frontend build, and git status audit.

## Risk

Low to medium. This allows larger status templates, but could increase prompt and parsing size for heavily customized status bars.
