# Talent Roll Mutation Stale Guard

Date: 2026-06-07

## Scope

Close a remaining UI race in the talent roll dialog where delayed roll, delete, or clear-all requests could update the visible panel after the user switched to another character or lost edit permission.

## Changes

- Added a dialog context version tied to `characterId` and `canEdit`.
- Reset transient roll and clear-all busy/result state as soon as the dialog context changes.
- Bound talent loads, roll requests, delete requests, and clear-all requests to the captured context before applying UI updates.
- Suppressed stale success/error notifications when old mutation requests finish after the dialog context has changed.
- Kept same-character parallel actions independent; the context token only invalidates on character or permission changes.

## Changed Files

- `frontend/src/components/TalentRollDialog.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-talent-roll-mutation-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check passed; Vite production build passed).
- PASS: `node scripts/check-encoding.mjs` (scanned 440 files).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed: 441/441.
  - Frontend build passed.

## User Change Safety

The worktree already had many modified and untracked files. This run only edited the talent roll dialog, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue the async audit with app-level session/provider refreshes or remaining global notification/session state, where old responses can affect cross-page UI.
