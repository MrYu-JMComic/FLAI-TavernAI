# 2026-06-08 NPC List Summary Direct Aggregation

## Goal

Avoid repeated per-NPC count queries and callback-heavy list assembly when rendering conversation NPC summaries.

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`
- `automation/backlog.md`

## Changes

- Replaced distinct-name collection plus per-NPC memory/behavior count queries with grouped count queries.
- Built NPC summaries through one `Map` and direct loops for registry, memory, behavior, visibility, and result assembly.
- Added behavior and source-test coverage that verifies aggregated memory/behavior counts and rejects the old per-row count query path.

## Validation

- PASS: `node --test backend\src\tests\frontendHomeView.test.js backend\src\tests\npcs.test.js` (32 tests passed)
- PASS: `npm.cmd test` in `backend` (823 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue reviewing refresh paths where UI lists are rebuilt even when API data is unchanged.
