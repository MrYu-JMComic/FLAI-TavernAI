# Accessibility Closing Tag Pattern Cache

## Scope

- Cached Vue accessibility scanner closing-tag regular expressions by tag name with `closingTagPatternCache`.
- Routed `findElementBodyRange()` through `getClosingTagPattern(tagName)` so repeated element body scans reuse compiled patterns.
- Kept the cached global regex state safe by resetting `closePattern.lastIndex = tagEnd + 1` before each `exec()` call.
- Updated the validation source contract to require the cache, helper, and cached lookup path.
- Recorded the completed task in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Result: `{ "violations": [] }`
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 666 tests, frontend build passed, review gate passed.

## Notes

- Behavior is intended to stay unchanged; the change only avoids rebuilding identical closing-tag regexes during repeated scans.
- The cached regexes are global and stateful, so every scanner path must continue resetting `lastIndex` before execution.
- The repository still has many unrelated or parallel dirty files; this iteration only reports the focused scanner cache change.

## Next Recommended Task

- Continue with narrow diagnostic-script cleanup only where repeated scans or allocations are obvious and covered by validation.
