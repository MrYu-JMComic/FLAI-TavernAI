# Autonomous Iteration Report - Message Scroll Anchor Route Guard

Date: 2026-06-09

## Goal

Continue the state/UI freshness audit and fix one confirmed stale UI update path.

## Change

- Guarded `withMessageScrollAnchor()` with a conversation route snapshot so delayed `nextTick`/animation-frame scroll restoration cannot apply an old conversation's scroll position after the route changes.
- Scoped message editor focus scheduling to the same route snapshot after starting an edit draft.
- Added focused coverage for route changes before frame restoration, including no stale scrollTop restore and no stale focus RAF scheduling.

## Files Changed In This Iteration

- `frontend/src/composables/chat/useChatMessageActions.js`
- `backend/src/tests/frontendChatMessageActions.test.js`
- `automation/reports/2026-06-09-message-scroll-anchor-route-guard.md`

## Validation

- `cd backend; node --test src/tests/frontendChatMessageActions.test.js` - passed
- `node scripts/check-encoding.mjs` - passed
- `cd backend; npm test` - passed, 877 tests
- `cd frontend; npm run build` - passed
- `git diff --check` - passed
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - passed

## Notes

- Unrelated dirty files were present after validation and were left unstaged: `frontend/src/views/CharacterFormView.vue` and `backend/src/tests/frontendCharacterFormView.test.js`.
- Next recommended task: continue auditing route-changing UI completions, especially delayed panel/editor focus and scroll restoration paths.
