# 2026-06-04 Status CSS And Rate Limit Fix

## Task

修复状态栏自定义 CSS 与实际显示不一致的问题，并降低本地调试时过早触发“访问频繁”的概率。

## Changed Files

- `frontend/src/components/StatusBar.vue`
- `frontend/src/views/CharacterFormView.vue`
- `frontend/src/styles.css`
- `backend/src/server.js`
- `automation/reports/2026-06-04-status-css-rate-limit-fix.md`

## Summary

- Status bar custom templates now extract `<style>` blocks, sanitize them, and inject scoped CSS for the current status bar instance.
- Custom template CSS is no longer left as inert or globally ambiguous HTML inside `v-html`.
- Character edit now shows an actual status bar preview using the same `StatusBar` component as the chat page.
- The preview supports both custom HTML templates and JSON built-in status bar config.
- API rate limits are configurable via environment variables and use a higher default limit for local editing flows.
- Login/register attempts no longer also consume the global API limiter.

## Validation

- `npm.cmd run build` in `frontend`: passed.
- Local login request with the provided account: passed.
- Reported character API fetch after login: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: passed.

## Notes

- The repository already had many unrelated modified and untracked files before this run. This iteration only intentionally changed the status bar component, character form preview, related styles, backend rate-limit config, and this report.
- Backend processes already running before this change need a restart to pick up the new rate-limit defaults.

## Next Recommended Task

Open the reported character edit page and compare the new “实际效果预览” with a newly created chat session using the same character.
