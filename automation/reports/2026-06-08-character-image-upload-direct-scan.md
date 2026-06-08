# 2026-06-08 Character Image Upload Direct Scan

## Goal

Reduce generic array work in the character image upload entry while keeping the existing busy and stale-upload guards intact.

## Changed Files

- `frontend/src/components/CharacterImagePanel.vue`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `automation/backlog.md`

## Changes

- Replaced `Array.from(input?.files || [])` with a direct file-list scanner.
- Replaced image MIME allowlist `includes` with direct type comparisons.
- Added a focused source test that guards the upload scanner and direct MIME check.

## Validation

- PASS: `node --test backend\src\tests\frontendCharacterImagePanel.test.js` (6 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 512 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (821 backend/source tests passed; frontend build passed)

## Next

- Continue auditing upload, drag, and refresh handlers for avoidable allocations in user-facing UI paths.
