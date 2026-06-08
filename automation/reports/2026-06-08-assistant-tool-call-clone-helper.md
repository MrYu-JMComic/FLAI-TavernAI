# 2026-06-08 Assistant Tool-Call Clone Helper

## Goal

Remove duplicated backend assistant tool-call summary cloning without changing the response DTO shape.

## Changed Files

- `backend/src/services/assistantUtils.js`
- `backend/src/services/characterAssistant.js`
- `backend/src/services/worldBookAssistant.js`
- `backend/src/tests/assistantUtils.test.js`
- `automation/backlog.md`

## Changes

- Added a shared `cloneToolCalls` helper that directly copies the public tool-call summary fields.
- Routed character and world-book assistant non-streaming and streaming draft responses through the shared helper.
- Covered the helper with focused behavior tests for new-array cloning, shallow `arguments`/`result` preservation, omitted private fields, and null input.

## Validation

- PASS: `node --test backend\src\tests\assistantUtils.test.js` (3 tests passed)
- PASS: `node scripts/check-encoding.mjs` (scanned 497 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (808 backend/source tests passed; frontend build passed)

## Next

- Continue consolidating duplicated assistant result formatting only where a shared helper keeps the response contract easier to audit.
