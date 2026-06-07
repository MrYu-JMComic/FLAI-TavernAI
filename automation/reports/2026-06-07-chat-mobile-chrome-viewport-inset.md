# 2026-06-07 Chat Mobile Chrome Viewport Inset

## Task

Fix the chat page top navigation being covered by the Chrome mobile browser UI.

## Changed Files

- `frontend/src/views/ChatView.vue`
- `frontend/src/styles.css`

## Summary

- Added chat-level CSS variables sourced from `window.visualViewport` for the visible viewport height and top offset.
- Reset those variables to safe defaults outside phone layouts or when `visualViewport` is unavailable.
- On mobile browsers that support `dvh`, fixed the deep chat shell to the visible viewport and positioned it below the browser top overlay.

## Validation

- `npm.cmd run build` in `frontend`: passed.
- Build precheck `node ../scripts/check-encoding.mjs`: passed, scanned 478 files.
- `node scripts/check-encoding.mjs`: passed, scanned 480 files.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: passed.

## Notes

- The repository already had many unrelated uncommitted changes before this run; this iteration only targeted the chat mobile viewport behavior.
- Next recommended task: verify the chat route on a physical Android Chrome session while the address bar is expanded, collapsed, and the keyboard is open.
