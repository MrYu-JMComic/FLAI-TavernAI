# 2026-06-19 Chat composer input enhancements

## Summary

Enhanced the existing chat composer input path with lightweight Markdown shortcuts, `{user}` insertion, and local input history browsing. The change keeps the single textarea and single submit helper as the only composer path, so the new tools do not add a parallel input surface or duplicate send logic.

## Changed files

- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatComposer.test.js`
- `automation/reports/2026-06-19-chat-composer-input-enhancements.md`

## Validation

- Passed: `cd backend && node --test src/tests/frontendChatComposer.test.js`
- Passed: `node scripts/find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- Passed: `cd frontend && npm run build`
  - Result: Vite build completed successfully.
- Passed: `node scripts/check-encoding.mjs`
  - Result: scanned 681 files; no common Chinese mojibake or replacement-character markers found.
- Passed: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`
  - Result: PASS; backend tests reported 965 passed, and frontend build completed successfully.

## Notes

- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required.
- Cleanup requirement applied: replaced the old direct template submit emits with `submitComposer`, and added regression assertions that block duplicate textareas or direct submit paths from returning.
