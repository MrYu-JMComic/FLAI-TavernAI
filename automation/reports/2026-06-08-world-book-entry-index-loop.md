# World Book Entry Index Loop

## Backlog item

- Reduce repeated array transforms in world-book matching internals.

## Changed files

- `backend/src/modules/worldBooks.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-world-book-entry-index-loop.md`

## What changed

- Added `indexWorldBookEntries` to collect entry ids and the `entryById` lookup in one direct loop.
- Reused the collected ids for state loading and the lookup map for group inclusion.
- Extended the group-inclusion test so raw world-book entry rows fail if this indexing path reintroduces `Array.prototype.map`.

## Validation

- Focused backend coverage passed:
  - `node --test backend\src\tests\backend.test.js --test-name-pattern "world book (group inclusion keeps only one entry per group|recursive activation preserves group inclusion)"`
- Backend test suite passed:
  - `cd backend; npm test`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next recommended task

- Continue checking world-book matching for repeated allocation patterns only where the behavior is already covered by targeted tests.
