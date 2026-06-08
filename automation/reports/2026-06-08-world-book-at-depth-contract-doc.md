# World Book At-Depth Contract Documentation

## Backlog item

- Keep world-book `at_depth` injection behavior readable and maintainable without changing the tested prompt assembly contract.

## Changed files

- `backend/src/modules/worldBooks.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-world-book-at-depth-contract-doc.md`

## What changed

- Corrected the `injectAtDepthEntries` JSDoc so it matches the current implementation and tests: `depth=0` appends after the final message, while `depth=1` inserts before the final message.
- Avoided behavior changes because the current backend coverage already pins that tail-position contract.

## Validation

- Focused backend coverage passed:
  - `node --test backend\src\tests\backend.test.js --test-name-pattern "world book at_depth"`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next recommended task

- Review world-book depth labels in `WorldBookView.vue` only if product intent changes; the backend contract is now documented to match current behavior.
