# Encoding Check Reports Scan

## Scope

- Updated `scripts/check-encoding.mjs` so `automation/reports` is no longer skipped.
- Ensured autonomous iteration reports are covered by the same suspicious mojibake marker scan as other Markdown and source files.
- Kept generated/runtime data skips intact for `backend/data` and `backend/uploads`.

## Changed Files

- `scripts/check-encoding.mjs`

## Validation

- `node scripts/check-encoding.mjs` passed after enabling report scans.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Encoding checks passed with `automation/reports` included.
  - Backend test suite passed: 385 tests.
  - Frontend build passed.
- `node scripts/check-encoding.mjs` passed: no common Chinese mojibake markers found.

## Notes

- This makes the required final report artifact part of the UTF-8/mojibake guard instead of an unchecked exception.
- Next useful follow-up: add a small allowlist comment or test fixture only if future generated artifacts need an intentional encoding-scan exception.
