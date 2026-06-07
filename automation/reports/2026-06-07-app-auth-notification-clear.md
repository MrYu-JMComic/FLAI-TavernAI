# App Auth Notification Clear

Date: 2026-06-07

## Scope

Prevent global toast notifications and their timers from leaking across logout, login, session loss, or app teardown.

## Changes

- Added a shared `clearNotifications()` helper in `App.vue`.
- Reused the helper during app unmount instead of duplicating notification timer cleanup.
- Cleared stale notifications when authentication succeeds, when logout starts, and when session refresh resolves to an unauthenticated state or fails.
- Preserved the session-failure warning by clearing old notifications before showing the fresh warning.

## Changed Files

- `frontend/src/App.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-app-auth-notification-clear.md`

## Validation

- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed; scanned 466 files.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 468 files.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only touched App-level notification lifecycle handling, the autonomous backlog, and this report.

## Next Recommended Task

Continue auditing global or provided state that survives user/session boundaries, especially any callbacks stored beyond a single mounted view.
