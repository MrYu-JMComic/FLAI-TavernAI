# World Book At-Depth Injection Loop

## Backlog item

- Reduce intermediate array creation while injecting matched world-book `at_depth` entries into chat messages.

## Changed files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-world-book-at-depth-injection-loop.md`

## What changed

- Replaced the source `entries.filter(...)` plus spread-copy sorting path with a direct index scan that collects only `at_depth` entries.
- Kept sorting scoped to the small collected injection list so the caller-provided source entries array is not reordered.
- Added focused coverage that fails if marked source entries are processed through `Array.prototype.filter` or iterator-copying.

## Validation

- Focused backend coverage passed:
  - `node --test backend\src\tests\backend.test.js --test-name-pattern "world book at_depth injection"`
- Backend test suite passed:
  - `cd backend; npm test`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next recommended task

- Review the `injectAtDepthEntries` depth comment and insertion-index contract separately before changing any `depth=0` behavior.
