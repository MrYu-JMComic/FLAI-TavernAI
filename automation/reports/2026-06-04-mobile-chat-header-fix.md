# 2026-06-04 Mobile Chat Header Fix

## Task

修复手机端聊天页顶部标题与导航/功能按钮错位、重叠的问题。

## Changed Files

- `frontend/src/components/chat/ChatHeader.vue`
- `frontend/src/styles.css`
- `automation/reports/2026-06-04-mobile-chat-header-fix.md`

## Summary

- Grouped the right-side chat header action buttons into a single `.deep-chat-header-actions` container.
- Reduced the header grid from five columns to three columns: left actions, title, right actions.
- Mobile header now reserves stable side columns and lets the middle title shrink safely.
- Long conversation titles now use two-line clamping on mobile instead of overflowing into adjacent icons.
- Provider/model text stays centered and truncated within the title column.

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: passed.

## Notes

- Playwright screenshot verification was not available because the local node REPL browser automation tool failed under the current Windows sandbox.
- Existing unrelated modified/untracked files were preserved.
