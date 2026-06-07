# Frontend Raw Console Hygiene

## Scope

- Removed raw `console.error(err)` output from chat custom appearance script failure handling.
- Kept the existing warning path and improved it to show a concise custom-JS error detail, clamped to avoid noisy notifications.
- Added a frontend source hygiene guard for raw console output methods: `console.log`, `console.debug`, `console.trace`, `console.warn`, and `console.error`.
- Added focused scanner coverage so strings, comments, regex literals, and `notify.error(...)` are not treated as raw console output.

## Changed Files

- `frontend/src/composables/chat/useChatAppearance.js`
- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 9 tests.
- `npm.cmd run build` passed in `frontend`.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 385 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: no common Chinese mojibake markers found.

## Notes

- This moves one frontend failure path from developer-console leakage toward user-facing feedback, matching the backlog's API/error-message polish direction.
- Next useful follow-up: inspect a specific empty/loading/error state in a Vue view and improve it with the same narrow validation style.
