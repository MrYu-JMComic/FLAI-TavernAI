# 2026-06-08 Chat Appearance Selector List Direct Scan

## Goal

Make scoped custom CSS more reliable and reduce temporary selector-list allocations in chat appearance and status-bar template styling.

## Changed Files

- `frontend/src/utils/chatAppearance.js`
- `backend/src/tests/frontendChatAppearance.test.js`
- `automation/backlog.md`

## Changes

- Replaced selector-list `split/map/filter/join` scoping with a direct comma scanner.
- Preserved commas inside pseudo-class arguments and attribute selector values before prefixing custom CSS selectors.
- Added focused behavior coverage and source guards against the old selector-list pipeline.

## Validation

- PASS: `node --test backend\src\tests\frontendChatAppearance.test.js` (15 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 510 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (815 backend/source tests passed; frontend build passed)

## Next

- Continue auditing custom UI rendering helpers that parse user-provided CSS, template, or appearance text during refreshes.
