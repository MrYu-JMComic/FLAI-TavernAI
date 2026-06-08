# Save Preview Direct Assistant Scan

## Backlog item

- Remove an allocation-only snapshot clone/reverse from save preview generation.

## Changed files

- `backend/src/modules/saves.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-save-preview-direct-assistant-scan.md`

## What changed

- Replaced save preview's `[...messages].reverse().find(...)` with a named reverse-index helper.
- Kept preview behavior unchanged: latest assistant content is preferred, user-only conversations still show message count, and empty conversations still show the empty preview label.
- Extended the existing save preview test to fail if assistant snapshots are reversed again.

## Validation

- Focused backend coverage passed:
  - `node --test backend\src\tests\backend.test.js --test-name-pattern "saves preview uses last assistant message"`
- Full review gate passed after one transient backend-test rerun:
  - `npm test` in `backend` passed with 715 tests.
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed after rerun, covering encoding, Vue diagnostics, backend tests, frontend build, and Git status.

## Next recommended task

- Continue reviewing save and conversation helper paths for similar clone/reverse scans, but only where the existing behavior can be pinned by focused tests.
