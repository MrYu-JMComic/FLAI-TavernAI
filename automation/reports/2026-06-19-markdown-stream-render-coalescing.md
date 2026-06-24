# 2026-06-19 Markdown stream render coalescing

## Summary

Optimized Markdown rendering for streaming chat replies. `MarkdownContent` now coalesces deferred render updates through `requestAnimationFrame` while preserving immediate rendering for settled messages, the existing rendered HTML cache, fold plugins, syntax highlighting, and DOMPurify sanitization.

## Changed files

- `frontend/src/components/MarkdownContent.vue`
- `frontend/src/components/chat/ChatMessageItem.vue`
- `backend/src/tests/frontendMarkdownContent.test.js`
- `backend/src/tests/frontendChatMessageItem.test.js`
- `automation/reports/2026-06-19-markdown-stream-render-coalescing.md`

## Validation

- Passed: `cd backend && node --test src/tests/frontendMarkdownContent.test.js src/tests/frontendChatMessageItem.test.js`
- Passed: `cd frontend && npm run build`
  - Result: Vite build completed successfully.
- Passed: `node scripts/check-encoding.mjs`
  - Result: scanned 684 files; no common Chinese mojibake or replacement-character markers found.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Result: PASS; backend tests reported 969 passed, and frontend build completed successfully.

## Notes

- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required.
- Cleanup requirement applied: the old computed direct-render path was removed and replaced with one scheduled render path that supports both immediate and deferred updates.
- Existing unrelated worktree changes were preserved.
