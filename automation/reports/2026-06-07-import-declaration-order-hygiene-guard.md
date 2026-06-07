# 2026-06-07 Import Declaration Order Hygiene Guard

## Goal

Reduce patch-overlap drift by preventing JS-like source files from accumulating static `import` declarations below runtime code.

## Changes

- Added a shared static import declaration scanner in `backend/src/tests/source-hygiene.test.js`.
- Reused the scanner in the duplicate same-module import guard.
- Added a new source hygiene guard for `.js`, `.mjs`, `.cjs`, and `.ts` files that flags static imports after runtime code.
- Added focused fixture coverage for ordered imports, late imports, dynamic imports, comments, strings, and Vue SFC exclusion.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-import-declaration-order-hygiene-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (23 tests)
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (528 backend/source tests and frontend build)

## Notes

- This is a source hygiene and test-only change; product behavior is unchanged.
- Vue SFC files are intentionally excluded because import order inside `<script setup>` must be evaluated against extracted script blocks, not raw `.vue` file order.
- Existing parallel frontend, backend, and report worktree changes were preserved.
