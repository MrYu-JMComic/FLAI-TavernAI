# 2026-06-09 - Regex Reorder Direct Scans

## Changed Files

- `backend/src/modules/characters.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-regex-reorder-direct-scans.md`

## Summary

- Replaced regex-rule reorder id collection with a direct `Set` fill loop.
- Replaced the reorder update callback with an explicit indexed loop.
- Preserved partial reorder behavior, group-scoped reorder behavior, and savepoint rollback semantics.

## Coverage

- Added a backend source guard for the direct regex reorder scans.
- Added regression checks preventing the old `current.map(...)` and `nextIds.forEach(...)` reorder paths from returning.

## Validation

- PASS: `node --test src/tests/backend.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm run build` in `frontend`.
- PASS: `npm test` in `backend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing backend reorder helpers for transient id collections only where the ordering behavior is already covered by tests.
