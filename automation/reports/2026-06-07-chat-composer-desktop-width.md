# Chat Composer Desktop Width

## Changed Files

- `frontend/src/styles.css`
- `backend/src/tests/frontendChatComposer.test.js`

## What Changed

- Made the collapsed-sidebar chat composer use the same width token as the chat readable area instead of staying capped at the default `860px`.
- Kept tablet and narrow-desktop composer layout inset by removing the edge-to-edge overrides from the `1179px` breakpoint.
- Left the phone breakpoint responsible for the fixed bottom, full-width composer layout.
- Added a source test that locks the collapsed-sidebar composer width to `--chat-readable-width`.
- Added a source test that prevents the tablet breakpoint from reusing the phone edge-to-edge composer layout.

## Validation

- `node --test backend\src\tests\frontendChatComposer.test.js`: pass
- `npm run build` in `frontend`: pass
- `node scripts\check-encoding.mjs`: pass
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: pass

## Notes

- Existing unrelated worktree changes were left untouched.
- Recommended manual check: open a desktop chat around a 1165px-wide viewport with the sidebar collapsed and confirm the input panel keeps side inset instead of touching both viewport edges.
