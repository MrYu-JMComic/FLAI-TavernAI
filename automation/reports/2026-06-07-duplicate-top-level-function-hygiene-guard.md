# 2026-06-07 Duplicate Top-Level Function Hygiene Guard

## Goal

Reduce patch-overlap drift by preventing JS-like source files from declaring the same top-level function name more than once.

## Changes

- Added a JS-like source extension helper in `backend/src/tests/source-hygiene.test.js`.
- Added a masked-source scanner for top-level function declarations.
- Added a source hygiene guard that flags duplicate top-level function names within the same `.js`, `.mjs`, `.cjs`, or `.ts` file.
- Added focused fixture coverage for duplicate top-level declarations, nested functions, comments, strings, and Vue SFC exclusion.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-duplicate-top-level-function-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (25 tests)
- Pending: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- This is a source hygiene and test-only change; product behavior is unchanged.
- The guard intentionally scopes to JS-like files. Raw `.vue` files are excluded because their script sections need SFC-aware parsing.
- Existing parallel frontend, backend, and report worktree changes were preserved.
