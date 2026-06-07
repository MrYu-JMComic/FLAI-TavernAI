# 2026-06-07 WorldBook Retry Loading Guard

## Goal

Prevent WorldBookView error-state retry controls from starting redundant list or detail refreshes while a world-book load is already pending.

## Changes

- Added a `loading.value` early return to the `retryLoad()` entry point.
- Disabled and marked busy both list and detail retry buttons while loading is active.
- Added focused source coverage for the guarded retry entry point and both retry button bindings.

## Files Touched

- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendWorldBookView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 493 backend/source tests and frontend build.

## Notes

- The underlying `loadBooks()` and `loadBook()` token-based stale-response protection was left intact; this change only aligns the user retry entry point with the visible loading state.
- `CharacterFormView.vue` had unrelated working-tree changes during validation and was left untouched.
