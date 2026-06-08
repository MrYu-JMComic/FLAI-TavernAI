# Autonomous Report: NpcPanel Detail List Helpers

Date: 2026-06-08

## Scope

- Kept this pass focused on NpcPanel detail-list updates after profile, memory, and behavior mutations.
- Avoided broader panel refactors so the existing busy-state and stale-route guards remain unchanged.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Routed NPC profile row updates through `updateNpcByNameIfChanged` instead of an inline `map` replacement.
  - Routed new memory and behavior insertion through direct-loop helpers instead of spread-list copies.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Updated source coverage to require the helper paths.
  - Added negative checks to prevent the old `map` and spread-list mutation paths from returning.
- `automation/backlog.md`
  - Recorded this run in Done.

## Validation

- PASS: `node --test backend\src\tests\frontendNpcPanel.test.js`
- PASS: `node scripts/check-encoding.mjs`
- PASS: `npm.cmd run build` from `frontend`
- PASS: `npm.cmd test` from `backend`
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

Continue scanning visible panels for inline response-list replacements that bypass the existing reference-preserving setters.
