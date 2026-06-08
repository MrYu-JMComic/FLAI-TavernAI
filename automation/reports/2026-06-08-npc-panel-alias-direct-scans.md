# 2026-06-08 NPC Panel Alias Direct Scans

## Goal

Reduce temporary allocations in NPC alias parsing and refresh comparisons while preserving unchanged NPC list references.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`

## Changes

- Replaced NPC alias text `split` parsing with a capped direct scanner over alias separators.
- Compared NPC alias lists directly by index instead of normalizing both sides with temporary `map(String)` arrays.
- Added source guards for the direct parser and direct alias list comparison.

## Validation

- PASS: `node --test backend\src\tests\frontendNpcPanel.test.js` (8 tests passed)
- PASS: `node scripts\check-encoding.mjs` (scanned 504 files)
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (812 backend/source tests passed; frontend build passed)

## Next

- Continue scanning panel refresh comparisons for temporary arrays that run during no-op refreshes.
