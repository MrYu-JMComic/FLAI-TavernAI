# Accessibility aria-labelledby Token Scan

## Summary

Reused one static token scanner for Vue accessibility `aria-labelledby` handling. This keeps referenced-id collection and accessible-name lookup on the same parsing path without allocating split arrays for every static `aria-labelledby` value.

## Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
  - Added `forEachStaticToken()` with early stop support.
  - Replaced both `labelledBy.split(/\s+/)` paths with the shared token scanner.
  - Removed the extra `.trim()` allocation before scanning static `aria-labelledby` values.
- `backend/src/tests/validation-scripts.test.js`
  - Updated the scanner source contract to require the token helper and reject the old split path.
  - Added a fixture for multi-token `aria-labelledby` values where a later referenced id supplies the accessible name.
- `automation/backlog.md`
  - Recorded this completed iteration.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend test suite passed: 672 tests.
  - Frontend build passed.
  - Git status check completed.

## Next Recommended Task

Continue narrow diagnostic cleanup only after checking the current dirty worktree. A good next candidate is another scanner-only source hygiene pass, avoiding business-code edits while many unrelated changes remain active.
