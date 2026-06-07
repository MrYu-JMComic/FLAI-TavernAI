# Validation Script Guard

## Scope

- Added backend coverage for validation entry points so required gates cannot be silently removed.
- Asserted backend `pretest` still runs `scripts/check-encoding.mjs` and backend `test` still runs Node's test runner over `src/tests/*.test.js`.
- Asserted frontend `prebuild` still runs `scripts/check-encoding.mjs` and frontend `build` still runs `vite build`.
- Asserted `scripts/review-gate.ps1` still wires encoding checks, backend tests, frontend builds, nonzero exit checks, and failure exit behavior.

## Changed Files

- `backend/src/tests/validation-scripts.test.js`

## Validation

- `node --test src/tests/validation-scripts.test.js src/tests/source-hygiene.test.js` passed: 13 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 389 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: scanned 311 files; no common Chinese mojibake markers found.

## Notes

- This directly supports the "reject negative optimization" goal by making validation weakening visible in CI/local gates.
- Next useful follow-up: keep adding guardrails only where they protect an actual project invariant, not as speculative policy.
