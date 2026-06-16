# 2026-06-11 NPC Organizer Assistant

## Summary

Added an AI organizer entry point to the NPC management panel. The organizer can stream tool-call progress while it creates or updates NPC profiles, adds/edits/deletes NPC memories, adds/edits/deletes behavior rules, and hides false-positive NPC profiles.

## Changed Files

- `backend/src/services/npcOrganizer.js`
  - Added the dedicated NPC organizer tool loop and guarded tool executors.
- `backend/src/routes/conversations.js`
  - Added `POST /api/conversations/:id/npcs/organize` with SSE support.
- `backend/src/validations/schemas.js`
  - Added request validation for NPC organizer payloads.
- `frontend/src/api.js`
  - Added `streamNpcOrganizer`.
- `frontend/src/components/NpcPanel.vue`
  - Added the organizer button, prompt panel, stop action, process log, and tool result display.
- `backend/src/tests/npcOrganizer.test.js`
  - Added focused backend coverage for organizer tool mutations.
- `backend/src/tests/frontendApi.test.js`
  - Added coverage for the NPC organizer stream route.
- `backend/src/tests/frontendNpcPanel.test.js`
  - Added source coverage for the organizer UI and busy-state lock.

## Validation

- `node --test backend\src\tests\npcOrganizer.test.js backend\src\tests\frontendApi.test.js backend\src\tests\frontendNpcPanel.test.js`
  - Passed: 42 tests.
- `node scripts/check-encoding.mjs`
  - Passed: scanned 633 files.
- `npm test` in `backend`
  - Passed: 940 tests.
- `npm run build` in `frontend`
  - Passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Passed.

## Notes

- Existing unrelated working-tree changes were left intact.
- The organizer hides NPC profiles instead of deleting their memories or behaviors, matching the current NPC removal semantics.

## Next Recommended Task

Add a small confirmation or dry-run mode for destructive organizer actions if users want to preview AI deletes before applying them.
