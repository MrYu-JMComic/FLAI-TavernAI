# Source Hygiene Suppression Guard

## Scope

- Added a source hygiene guard against committed quality-suppression comments such as `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`.
- Extended the source masker so comments can be preserved for this rule while strings, template text, and regex literals remain masked.
- Tightened regex-literal start detection to consider the current line, avoiding previous-line comment text influencing regex masking.

## Changed Files

- `backend/src/tests/source-hygiene.test.js`

## Validation

- `node --test src/tests/source-hygiene.test.js` passed: 11 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 387 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: scanned 309 files; no common Chinese mojibake markers found.

## Notes

- This helps prevent negative optimization by rejecting blanket quality-check suppression in application source.
- Next useful follow-up: prefer targeted fixes or explicit test coverage over suppression comments when future checks fail.
