# 2026-06-11 - World-Book Explain Toggle Scroll

## Changed Files

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatComposer.test.js`
- `automation/reports/2026-06-11-worldbook-explain-toggle-scroll.md`

## Summary

- Found the root cause of the thin-line state: the world-book explain panel is the last item inside the chat scroller, so opening it adds the match list below the current scroll viewport while the scroll position stays anchored.
- Added a `toggle` handler that waits for the opened layout, then scrolls the panel top back into the chat scroller viewport.
- Kept the collapsed list hidden and the opened list rendered as a grid.
- Added source coverage for the opened-panel scroll correction.

## Validation

- PASS: `node --test src/tests/frontendChatComposer.test.js` in `backend`.
- PASS: `npm run build` in `frontend`.

## Notes

- The working tree already contained unrelated modified and untracked files before this run; they were preserved.

## Next Recommended Task

- Re-test the panel in the browser by clicking the collapsed pill at the bottom of the active chat.
