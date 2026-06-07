# 2026-06-07 NPC Panel Busy Refresh Allowlist

## Goal

Prevent the NPC panel action-busy guard from blocking its own post-mutation refreshes.

## Changes

- Added an explicit `allowWhileBusy` option to `loadNpcs()` and `loadNpcDetail()`.
- Kept user-triggered list refreshes and detail retries blocked while an NPC mutation is busy.
- Allowed mutation success paths to refresh NPC list/detail state with `loadNpcs({ allowWhileBusy: true })`.
- Tightened the NPC panel source diagnostic so future busy-guard changes preserve the internal refresh path.

## Files Touched

- `frontend/src/components/NpcPanel.vue`
- `backend/src/tests/frontendNpcPanel.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-npc-panel-busy-refresh-allowlist.md`

## Validation

- `node --test backend\src\tests\frontendNpcPanel.test.js` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed:
  - Encoding check passed, scanning 531 files.
  - Unreferenced Vue component diagnostic found no unreviewed candidates.
  - Vue accessibility diagnostic found no inaccessible controls.
  - Backend tests passed: 464 tests.
  - Frontend build passed.
- `node scripts\check-encoding.mjs` passed, scanning 531 files.

## Notes

- This keeps the duplicate-action guard without turning it into a stale-list regression after successful NPC mutations.
