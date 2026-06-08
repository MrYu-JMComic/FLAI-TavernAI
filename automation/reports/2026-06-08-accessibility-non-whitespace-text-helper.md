# Accessibility Non-Whitespace Text Helper

## Scope

- Added a shared `hasNonWhitespaceText()` helper backed by a stateless `\S` regex.
- Routed button visible-text checks and label text-content checks through the helper.
- Avoided rebuilding strings with `.replace(/\s+/g, '')` just to test whether text contains any non-whitespace content.
- Updated the validation source contract to require the helper path and reject the old whitespace-stripping checks.
- Recorded the completed task in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 341 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 669 tests, frontend build passed, review gate passed.

## Notes

- Behavior is intended to stay unchanged: `text.replace(/\s+/g, '').length > 0` is equivalent to testing for at least one non-whitespace character.
- The helper keeps the scanner checks consistent without adding a new parsing layer.
- The repository still has many unrelated or parallel dirty files; this iteration only changes the focused scanner path, validation contract, backlog entry, and report.

## Next Recommended Task

- Continue looking for repeated scanner work that can be collapsed into existing helpers without changing product behavior.
