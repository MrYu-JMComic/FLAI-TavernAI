# Toast Action Dismiss Before Run

Date: 2026-06-07

## Scope

Tighten toast action timing so clicking a notification action immediately clears the toast and its App-level timer before the action performs navigation or other state changes.

## Changes

- Updated `MessageToasts.vue` so `runAction()` emits `dismiss` before calling the action callback.
- Preserved the existing action API and close-button behavior.
- Avoided leaving a stale actionable toast visible while its originating action changes route or view state.

## Changed Files

- `frontend/src/components/MessageToasts.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-toast-action-dismiss-before-run.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` before report creation.
  - Scanned 460 files.
- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 460 files.
  - Vite production build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 461 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only edited the toast action ordering, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing notification producers that include actions, especially provider/settings navigation prompts, for stale action contexts after route changes.
