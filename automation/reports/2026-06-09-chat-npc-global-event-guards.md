# 2026-06-09 - Chat NPC Global Event Guards

## Changed Files

- `frontend/src/views/ChatView.vue`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-chat-npc-global-event-guards.md`

## Summary

- Guarded the ChatView NPC panel global pointer-down handler against missing or malformed event objects before checking overlay and close targets.
- Guarded the paired global click suppression handler so synthetic events without `preventDefault()` or `stopPropagation()` cannot throw while clearing the suppression flag.

## Validation

- PASS: `node --test src/tests/frontendChatConversation.test.js` in `backend` (33 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 554 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (848 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing global DOM event listeners for assumptions about browser-native event shape before handler-specific work runs.
