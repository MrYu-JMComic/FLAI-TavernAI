# Markdown Content Segment Loop

## Backlog item

- Reduce MarkdownContent fold-rendering allocation work while preserving fold matching, title escaping, and Markdown rendering behavior.

## Changed files

- `frontend/src/components/MarkdownContent.vue`
- `backend/src/tests/frontendMarkdownContent.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-markdown-content-segment-loop.md`

## What changed

- Replaced the fold-rendering `String(text).split(...)` and `segments.map(...).join(...)` path with a direct line scanner and direct HTML appends.
- Kept CRLF handling equivalent to the previous `/\r?\n/` split behavior while preserving bare carriage returns inside lines.
- Hoisted the LF/CR scan codes, fold caret, and fallback fold title constants while retaining the same runtime caret and title through ASCII `\u` escapes.
- Moved fold HTML rendering through `renderFoldSegment`.
- Added MarkdownContent source coverage to guard against reintroducing the split, segment array, segment map, or intermediate HTML part-array path.

## Validation

- Focused MarkdownContent source coverage passed:
  - `node --test backend\src\tests\frontendMarkdownContent.test.js`
- Encoding check passed:
  - `node scripts\check-encoding.mjs`
- Backend test rerun passed after an initial review-gate backend-test failure did not reproduce:
  - `npm test` from `backend`
- Full review gate passed on rerun:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
- Diff safety checks passed:
  - `git diff --check`
  - `git diff --cached --check`
  - `git status --short -- backend/data backend/uploads .env .env.local .env.development .env.production`

## Next recommended task

- Continue with small MarkdownContent or chat-render hot-path checks only when behavior can be covered directly; avoid broad renderer rewrites.
