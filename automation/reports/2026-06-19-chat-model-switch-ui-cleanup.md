# 2026-06-19 Chat model switch UI cleanup

## Summary

Cleaned up the chat composer model switching UI after the quick selector landed. Desktop now shows only the inline quick model selector when model options are available, while the older model switch button remains only as a fallback when no quick options exist. Mobile layout now assigns composer controls to stable grid positions, and dark mode styling for the quick selector follows the shared surface/text tokens.

## Changed files

- `AGENTS.md`
- `frontend/src/components/chat/ChatComposer.vue`
- `frontend/src/styles.css`
- `backend/src/tests/frontendChatComposer.test.js`

## Validation

- Passed: `node --test src/tests/frontendChatComposer.test.js`
- Passed: `node scripts/find-inaccessible-vue-controls.mjs --json`
  - Result: `violations: []`
- Passed: `cd frontend && npm run build`
- Passed: `node scripts/check-encoding.mjs`

## Notes

- Added an `Implementation Hygiene` rule to `AGENTS.md`: replacements should clean up old UI paths, styles, tests, and dead branches instead of layering duplicate behavior.
- No backend API, database schema, dependency, environment, upload, local data, or generated output change was required by this cleanup.
- The worktree still contains separate in-progress attachment/image-generation changes; they were preserved.
