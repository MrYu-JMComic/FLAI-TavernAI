# 2026-06-07 Frontend SFC Test Helper Dedupe

## Goal

Prevent the new frontend SFC source-level diagnostics from accumulating duplicated helper code.

## Changes

- Added `backend/src/tests/frontendSfcTestUtils.js` with shared helpers for reading repo text, extracting SFC blocks, and counting regex matches.
- Reused the shared helpers in `frontendCharacterImagePanel.test.js`.
- Reused the shared helpers in `frontendSaveLoadPanel.test.js`.

## Files Touched

- `backend/src/tests/frontendSfcTestUtils.js`
- `backend/src/tests/frontendCharacterImagePanel.test.js`
- `backend/src/tests/frontendSaveLoadPanel.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendCharacterImagePanel.test.js backend\src\tests\frontendSaveLoadPanel.test.js` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 463 tests.
  - Frontend build passed.

## Notes

- This is a test-only refactor; it does not change frontend runtime behavior.
