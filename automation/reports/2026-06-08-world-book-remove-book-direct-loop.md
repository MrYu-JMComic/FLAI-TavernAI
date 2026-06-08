# 2026-06-08 WorldBook Remove Book Direct Loop

## Goal

Avoid unnecessary list replacement work after world-book deletes while preserving the existing stale-route and current-book guards.

## Changed Files

- `frontend/src/views/WorldBookView.vue`
- `backend/src/tests/frontendWorldBookView.test.js`
- `automation/backlog.md`

## Changes

- Routed successful world-book deletion cleanup through `removeBookFromListIfPresent`.
- The helper scans the current list directly, returns false without allocating when the deleted id is already absent, and only builds a replacement list after finding a matching row.
- Tightened the WorldBookView source test to guard the direct-loop path and prevent falling back to `books.value.filter(...)` or a two-pass `hasBook` scan.

## Validation

- PASS: `node --test backend\src\tests\frontendWorldBookView.test.js` (7 tests)
- PASS: `node scripts/check-encoding.mjs` (490 files)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (803 backend tests and frontend build)

## Next

- Keep reviewing dirty or parallel changes for accidental negative optimization before committing them.
