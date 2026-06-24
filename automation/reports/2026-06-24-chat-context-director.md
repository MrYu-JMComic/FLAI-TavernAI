# Chat Context Director

Date: 2026-06-24

## Changed Files

- `backend/src/services/chatContextDirector.js`
- `backend/src/tests/chatContextDirector.test.js`
- `backend/src/routes/conversations.js`
- `backend/src/tests/conversationStreamingRoutes.test.js`
- `docs/superpowers/specs/2026-06-24-chat-context-director-design.md`
- `docs/superpowers/plans/2026-06-24-chat-context-director.md`
- `automation/reports/2026-06-24-chat-context-director.md`

## Summary

Added a backend context director prompt for the main chat assistant. The director gives the model the approved priority order for using user instructions, character card identity, world book rules, status/NPC context, and recent conversation details. It conditionally names active context sources so absent world book, NPC/status, Mod, or talent context is not claimed.

## Validation

- `cd backend; npm test` - PASS
- `cd frontend; npm run build` - PASS
- `node scripts/check-encoding.mjs` - PASS

## Cleanup And Scope Notes

No database schema, provider integration, streaming protocol, or frontend UI changed. Background accessory agents, character draft assistant, and world book draft assistant remain follow-up work.

## Next Recommended Task

Design the next assistant-improvement iteration for background accessory agents, focused on making NPC/status/economy extraction more reliable and less noisy.
