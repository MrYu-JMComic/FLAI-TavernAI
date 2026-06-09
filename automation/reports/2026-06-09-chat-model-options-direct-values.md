# 2026-06-09 - Chat Model Options Direct Values

## Changed Files

- `frontend/src/components/chat/ChatModelSwitcher.vue`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-model-options-direct-values.md`

## Summary

- Replaced ChatModelSwitcher model-option value spreading with a direct helper loop.
- Preserved the existing Map insertion order and current-model dedupe behavior.
- Reduced transient array work in the active quick-model switcher computed path.

## Coverage

- Added a source guard requiring model options to return through `collectModelOptionValues()`.
- Added a regression check preventing `return [...byId.values()]` from returning.

## Validation

- PASS: `node --test src/tests/frontendChatModelSwitcher.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing active model catalog and home filtering paths for callback-heavy computed work and stale UI state writes.
