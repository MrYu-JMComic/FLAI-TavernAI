# 2026-06-08 NPC Prompt Registry Direct Scan

## Goal

Reduce repeated registry scans while building NPC autonomous behavior prompts without changing prompt text or section ordering.

## Changed Files

- `backend/src/modules/npcs.js`
- `backend/src/tests/npcs.test.js`
- `automation/backlog.md`

## Changes

- Replaced registry `filter/map/filter` and `map` setup pipelines with one direct scan.
- Built hidden-name and registry metadata indexes together while skipping empty normalized NPC names.
- Added source-test coverage that keeps the registry setup on the direct-scan path.

## Validation

- PASS: `node --test backend\src\tests\npcs.test.js` (21 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 516 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (823 backend/source tests passed; frontend build passed)

Note: the review gate also reported unrelated dirty `CharacterFormView` files that were not part of this iteration.

## Next

- Continue reviewing chat prompt preparation paths where request-time helper setup still builds short-lived arrays.
