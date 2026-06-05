# Status Blueprint Schema Limit

Date: 2026-06-06

## Scope

Keep status bar blueprint variable limits consistent between normalization, frontend inference, and backend request validation.

## Changed Files

- `backend/src/validations/schemas.js`
- `backend/src/tests/backend.test.js`

## Change

- Added a backend validation constant for the status blueprint variable limit.
- Raised the request schema limit from 20 to 60 variables to match the current normalization and form inference limit.
- Added regression assertions that 60 variables are accepted and 61 variables are rejected.

## Why

The backend and frontend normalization paths now allow up to 60 inferred status variables, but the request schema still rejected payloads above 20. That mismatch could reject valid character form submissions before normalization had a chance to run.

## Validation

- `backend` `node --test src/tests/backend.test.js`: PASS, 142 tests.
- `node scripts/check-encoding.mjs`: PASS.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 239 backend tests, frontend build, and git status audit.

## Risk

Low. This only aligns validation with the existing 60-variable normalization limit; payloads above 60 remain rejected.
