# Character Form Export Stale Guard

Date: 2026-06-07

## Scope

Close stale and duplicate completion gaps in the character form export action.

## Changes

- Added a character export loading state and request token invalidated during component unmount.
- Blocked duplicate export clicks while an export is already running.
- Snapshotted the editing character ID before export so stale route completions cannot download or notify for the wrong character.
- Revoked generated object URLs in a guarded cleanup path.

## Changed Files

- `frontend/src/views/CharacterFormView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-character-form-export-stale-guard.md`

## Validation

- PASS: `git diff --check` (only existing CRLF warnings).
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (rerun with approval after Windows sandbox setup failure).

## Next Recommended Task

Continue auditing CharacterFormView delete actions for stale completions and duplicate clicks.
