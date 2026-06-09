# Iteration Report: NpcPanel stale detail edit drafts

Date: 2026-06-09

## Summary

Cleared stale NPC memory and behavior edit drafts when refreshed detail lists no longer contain the row being edited. This keeps overlapping NPC detail refresh, delete, and stale-action paths from leaving hidden edit state behind.

## Changed Files

- `frontend/src/components/NpcPanel.vue`
  - Prunes the active memory edit draft before comparing refreshed memory lists.
  - Prunes the active behavior edit draft before comparing refreshed behavior lists.
  - Uses a direct `id` scan helper instead of `find` or array pipelines.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Adds source coverage for pruning stale detail edit drafts on list refresh.
- `automation/backlog.md`
  - Records this completed iteration.

## Validation

- `node scripts/check-encoding.mjs` - PASS
- `npm test` in `backend` - PASS, 871 tests
- `npm run build` in `frontend` - PASS
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` - PASS

## Notes

- Existing uncommitted `WorldBookView` changes were present during validation and left untouched for a separate commit.
- No generated build output was staged.

## Next Recommended Task

Continue with small UI state-boundary checks around refreshed detail panels, prioritizing places where saved, deleted, or refreshed rows can leave stale local drafts open.
