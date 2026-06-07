# 2026-06-07 Source Hygiene Mask And Vue Read Guard

## Goal

Harden source hygiene checks so future cleanup guards do not miss multiline Vue SFC source reads or get confused by comments, strings, and nested template literals.

## Changes

- Fixed `maskSourceText()` to resume code scanning correctly after nested template literals inside template expressions.
- Made the unused named-import guard scan import declarations from masked code instead of matching pseudo-imports inside fixture strings.
- Counted named-import usages against masked code so comments and strings do not hide real unused imports.
- Extended the direct Vue source-read guard to detect multiline `readRepoText('*.vue')` calls while ignoring strings and comments.
- Added focused source hygiene tests for nested templates, fixture-string imports, and multiline Vue SFC reads.
- Recorded the completed iteration in `automation/backlog.md`.

## Files Touched

- `backend/src/tests/source-hygiene.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-source-hygiene-mask-vue-read-guard.md`

## Validation

- Passed: `node --test backend\src\tests\source-hygiene.test.js` (16 tests)
- Passed: `node scripts\check-encoding.mjs`
- Passed: `git diff --check` with LF/CRLF conversion warnings only and no whitespace errors.
- Passed: `git diff --cached --check`
- Passed: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (513 backend/source tests and frontend build)

## Notes

- This is a test-maintenance hardening change only; no product runtime code changed in this iteration.
- A raw grep for direct Vue reads now also sees intentional fixture strings in `source-hygiene.test.js`; the source hygiene test verifies those strings are ignored by the actual guard.
- Existing parallel Chat, Settings, StatusBar, backend route, and report worktree changes were preserved.
