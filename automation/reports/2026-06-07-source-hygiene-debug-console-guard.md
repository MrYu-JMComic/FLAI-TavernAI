# Source Hygiene Debug Console Guard

## Scope

- Added a frontend-only source hygiene guard for debug-only console calls: `console.debug(...)` and `console.trace(...)`.
- Added focused sample coverage so strings, comments, regex literals, and non-global logger calls are ignored while real global debug console calls are reported.
- Preserved backend operational logging such as startup and backup messages by keeping this rule scoped to `frontend/src`.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 7 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 383 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: no common Chinese mojibake markers found.

## Notes

- This reduces the chance of shipping frontend-only debug residue without blocking intentional backend service logs.
- Next useful follow-up: inspect one production-facing frontend error path from the backlog and improve user-facing handling with focused verification.
