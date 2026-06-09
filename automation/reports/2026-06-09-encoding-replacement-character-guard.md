# 2026-06-09 - Encoding Replacement Character Guard

## Changed Files

- `scripts/check-encoding.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-encoding-replacement-character-guard.md`

## Summary

- Clarified the encoding checker success and failure messages so they explicitly mention replacement-character markers.
- Added fixture coverage proving `String.fromCodePoint(0xfffd)` fails the encoding check and reports the affected file and line.
- Kept the scanner scope and traversal unchanged to avoid a broad or noisy hygiene change.

## Validation

- PASS: `node --test src/tests/validation-scripts.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue with small source-hygiene improvements where diagnostics already identify a concrete risk, rather than broad rewrites.
