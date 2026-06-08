# Accessibility Stateless Pattern Hoist

## Scope

- Hoisted the Vue accessibility scanner's repeated stateless regex literals for scannable controls, `aria-hidden=true`, and hidden input types.
- Routed `hasScannableControl()`, `isAriaHidden()`, and `isHiddenInput()` through those shared constants.
- Updated the validation source contract to require the constants and reject the old per-call inline regex tests.
- Recorded the completed task in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 340 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 669 tests, frontend build passed, review gate passed.

## Notes

- Behavior is intended to stay unchanged; the hoisted patterns are not global or sticky, so they do not carry `lastIndex` state.
- This keeps the hot scanner helpers slightly lighter without adding new parsing logic or broad abstractions.
- The repository still has many unrelated or parallel dirty files; this iteration only changes the focused scanner path, validation contract, backlog entry, and report.

## Next Recommended Task

- Continue with small diagnostic-script or source-hygiene cleanups that reduce repeated work without changing product behavior.
