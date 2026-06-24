# Accessory Agent Observation Window

Date: 2026-06-24

## Changed Files

- `backend/src/services/accessoryAgents.js`
- `backend/src/routes/conversations.js`
- `backend/src/tests/accessoryAgents.test.js`
- `backend/src/tests/accessoryAgentsNpc.test.js`
- `docs/superpowers/specs/2026-06-24-accessory-agent-observation-window-design.md`
- `docs/superpowers/plans/2026-06-24-accessory-agent-observation-window.md`
- `automation/reports/2026-06-24-accessory-agent-observation-window.md`

## Summary

Added a structured current-turn observation window for provider-backed background accessory agents. Status, NPC, and economy agents now receive both the accepted user message and saved assistant reply, with prompt guidance to record only changes clearly evidenced in the current turn.

The deterministic fallback parsers still read the assistant reply directly, so existing no-provider behavior remains compatible.

## Validation

- `cd backend; npm test` - PASS, 981/981 tests
- `cd frontend; npm run build` - PASS
- `node scripts/check-encoding.mjs` - PASS, scanned 704 files

## Cleanup And Scope Notes

No database schema, frontend UI, provider transport, or accessory tool schemas changed. Existing duplicate-memory, hidden-NPC, behavior-cap, and ownership guards remain in place.

## Next Recommended Task

Move to B-stage: improve the character draft assistant so generated character cards include steadier persona boundaries, better first-message scaffolding, and more useful extension/status suggestions.
