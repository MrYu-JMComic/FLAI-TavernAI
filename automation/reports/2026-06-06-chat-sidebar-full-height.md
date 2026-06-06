# Chat Sidebar Full Height Report

## Summary

- Fixed the chat conversation sidebar being clipped above the viewport bottom on tablet-width and narrow desktop layouts.
- Scoped the `max-height: 85dvh` sidebar limit to the mobile bottom-sheet breakpoint only.
- Restored `max-height: none` for side-drawer layouts at 769px and wider so the sidebar reaches the bottom and covers the composer area.

## Changed Files

- `frontend/src/styles.css`
- `automation/reports/2026-06-06-chat-sidebar-full-height.md`

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.

## Notes

- The working tree already contained many unrelated modified, deleted, and untracked files before this iteration. This run only intentionally changed the sidebar height CSS and added this report.

## Next Recommended Task

- Check the chat sidebar at 769px, 892px, and 1180px widths to confirm the side drawer, backdrop, and desktop column modes all keep the intended height.
