# Unreferenced Vue Pattern Lookup Reuse

## Scope

- Calculated component lookup names once in `findComponentReferences()`.
- Passed the shared lookup-name list into the tag-pattern and dynamic-`is` pattern builders.
- Kept all existing component reference matching rules unchanged.
- Updated the validation source contract to require the shared lookup-name path and reject recomputing names through `componentTagPatterns(componentPath)` or `componentIsAttributePatterns(componentPath)`.
- Recorded the completed task in `automation/backlog.md`.

## Validation

- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
  - Result: 0 candidates, 2 reviewed dormant components.
- PASS: `node --test backend\src\tests\validation-scripts.test.js`
  - Result: 13 tests passed.
- PASS: `node scripts\check-encoding.mjs`
  - Result: scanned 342 files; no common Chinese mojibake markers found.
- PASS: `git diff --check`
- PASS: `git diff --cached --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Result: backend tests passed with 669 tests, frontend build passed, review gate passed.

## Notes

- Behavior is intended to stay unchanged; this only avoids repeated basename/kebab-name lookup work for the same component.
- The repository still has many unrelated or parallel dirty files; this iteration only changes the focused scanner path, validation contract, backlog entry, and report.

## Next Recommended Task

- Continue favoring small diagnostic/source-hygiene cleanups where repeated work can be removed without changing product behavior.
