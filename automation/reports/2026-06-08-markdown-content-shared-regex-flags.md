# 2026-06-08 Markdown Content Shared Regex Flags

## Goal

Continue consolidating duplicate regex flag normalization without changing Markdown fold-plugin matching behavior.

## Changed Files

- `frontend/src/components/MarkdownContent.vue`
- `backend/src/tests/frontendMarkdownContent.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-markdown-content-shared-regex-flags.md`

## What Changed

- Reused the shared `normalizeRegexFlags` scanner in `MarkdownContent`.
- Kept the frontend fold-plugin wrapper behavior: remove `g` so global regex state cannot affect line matching, and fallback to `u`.
- Updated the MarkdownContent source test to guard the shared import and the wrapper semantics.

## Validation

- `node --test backend\src\tests\frontendMarkdownContent.test.js backend\src\tests\regexFlags.test.js` PASS, 7 tests.
- `npm.cmd run build` in `frontend` PASS, 1904 modules transformed.
- `node scripts/check-encoding.mjs` PASS, 422 files scanned.
- `git diff --check` PASS, with existing LF/CRLF warnings only.

## Notes

- The repo remains intentionally dirty from parallel iterations. This run only touched the MarkdownContent regex flag wrapper, its source test, and this report/backlog entry.
- Next recommended task: continue consolidating truly duplicated helpers only when the wrapper semantics are explicit and covered.
