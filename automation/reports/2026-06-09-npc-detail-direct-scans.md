# 2026-06-09 - NPC Detail Direct Scans

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-npc-detail-direct-scans.md`

## Summary

- Built NPC memory detail rows with a direct loop instead of `.map(toNpcMemory)`.
- Built NPC behavior detail rows with a direct loop instead of `.map(toNpcBehavior)`.
- Hid empty NPCs from the list snapshot in one direct scan instead of creating a filtered intermediate list.

## Coverage

- Added a source guard for NPC detail list scans and empty-NPC hiding.
- Reused existing NPC CRUD, ordering, ownership, and hide-empty behavior tests.

## Validation

- PASS: `node --test src\tests\npcs.test.js` in `backend`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `node scripts\check-encoding.mjs`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.

## Next Recommended Task

- Continue reviewing chat-facing list refresh paths where repeated array replacement can make UI state feel stale or noisy.
