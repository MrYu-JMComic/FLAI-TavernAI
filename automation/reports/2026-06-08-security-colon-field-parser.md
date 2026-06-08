# 2026-06-08 Security Colon Field Parser

## Goal

Harden colon-delimited security formats so malformed password hashes or encrypted API keys cannot be accepted by ignoring trailing fields.

## Changed Files

- `backend/src/security.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`

## Changes

- Replaced password-hash and encrypted-secret `split(':')` parsing with a shared exact-field scanner.
- Rejected encrypted secret values with missing, empty, or trailing colon fields before decryption.
- Added regression coverage proving trailing password-hash fields fail verification and trailing encrypted-secret fields throw an unsupported-format error.
- Added a source guard to keep security colon parsing off the old `split(':')` path.

## Validation

- PASS: `node --test backend\src\tests\backend.test.js` (276 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 512 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (821 backend/source tests passed; frontend build passed)

## Next

- Continue auditing security and provider parsing paths where permissive string parsing can silently discard malformed input.
