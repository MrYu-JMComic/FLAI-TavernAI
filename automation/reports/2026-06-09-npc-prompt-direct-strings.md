# 2026-06-09 - NPC Prompt Direct Strings

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-npc-prompt-direct-strings.md`

## Summary

- Replaced NPC behavior prompt section arrays with direct string accumulation.
- Built metadata, behavior-rule, and memory prompt lines with direct loops.
- Preserved NPC ordering, memory sealing, hidden NPC filtering, and behavior/memory prompt output while reducing intermediate arrays in the active chat prompt path.

## Coverage

- Extended NPC source guards to require `promptBody` direct accumulation.
- Added regression checks preventing `npc.behaviors.map()`, `npc.memories.map()`, `ruleLines`, `memoryLines`, and `sections.join()` prompt-building paths from returning.

## Validation

- PASS: `node --test src/tests/npcs.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing HomeView and CharacterFormView active UI lookup paths for stale state writes and callback-heavy computed work.
