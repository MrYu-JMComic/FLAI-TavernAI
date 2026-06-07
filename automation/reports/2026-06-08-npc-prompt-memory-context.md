# NPC Prompt Memory Context

## Summary

Fixed main chat prompt assembly so the NPC assistant context includes saved NPC memories even when an NPC has no enabled behavior rule. NPC prompt sections now merge enabled behavior rules and the latest saved memories per visible NPC.

## Changed Files

- `backend/src/modules/npcs.js`
  - `buildNpcBehaviorPrompt` now builds context from both enabled behaviors and saved memories.
  - Memory-only NPCs are included, hidden NPCs remain excluded, and memory order stays newest-first with the existing per-NPC limit.
- `backend/src/tests/npcs.test.js`
  - Added focused coverage for memory-only NPC prompt inclusion.
- `backend/src/tests/backend.test.js`
  - Added route-level coverage proving main chat provider prompts receive NPC memories and behavior rules when the NPC agent feature is active.

## Validation

- `node scripts/check-encoding.mjs` passed.
- `node --test --test-name-pattern "chat prompt injects NPC" src/tests/backend.test.js` passed.
- `node --test src/tests/npcs.test.js src/tests/backend.test.js` passed: 260 tests.
- `npm test` in `backend` passed: 557 tests.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed.

## Notes

- The repository already had many unrelated modified, deleted, and untracked files before this run. This change only edited the NPC prompt module and related backend tests, plus this report.
- Frontend build was not run separately because no frontend production code changed; the review gate and backend test suite covered the required diagnostics for this backend-only fix.

## Next Recommended Task

Clarify the UI copy around the NPC Agent toggle so users can tell that enabling it both manages NPC memory extraction and feeds saved NPC context into main replies.
