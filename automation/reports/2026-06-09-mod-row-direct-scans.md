# 2026-06-09 - Mod Row Direct Scans

## Changed Files

- `backend/src/modules/mods.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-mod-row-direct-scans.md`

## Summary

- Replaced backend Mod reorder id collection with a direct row scan.
- Replaced enabled-Mod loading `map(toMod).filter(...)` with one direct row loop.
- Preserved Mod ordering, character-scope filtering, and existing enabled-Mod behavior while reducing transient arrays in settings/chat paths.

## Coverage

- Added a backend source guard for direct Mod reorder and enabled-Mod loading loops.
- Added regression checks preventing the old `current.map(...)` and `map(toMod).filter(...)` paths from returning.

## Validation

- PASS: `node --test src/tests/backend.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm run build` in `frontend`.
- PASS: `npm test` in `backend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing backend scoped list helpers used by settings and chat context assembly for unnecessary callback pipelines.
