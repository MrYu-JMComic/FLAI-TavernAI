# App Auth Provider Stale Guard

Date: 2026-06-07

## Scope

Harden the app-level session and provider state boundary so delayed authentication, provider refresh, profile save, or logout completions cannot restore stale global UI state.

## Changes

- Added an app auth-scope version that invalidates pending session and provider refreshes when auth state changes or the app unmounts.
- Guarded `refreshSession()` before writing user, provider, route, notification, or booting state.
- Guarded `refreshProvider()` with both auth-scope and latest-request checks so older provider refreshes cannot overwrite newer provider settings.
- Cleared provider state when a fresh authentication result arrives, preventing old provider details from remaining visible while the new account refreshes.
- Made logout update local UI immediately before waiting for the logout request, matching the existing ignore-failure behavior while making the UI more responsive.
- Restricted profile-save updates to the currently logged-in user id so delayed profile events cannot repopulate the header after logout or account changes.

## Changed Files

- `frontend/src/App.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-app-auth-provider-stale-guard.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` (scanned 442 files before this report).
- PASS: final `node scripts/check-encoding.mjs` after adding this report (scanned 443 files).
- PASS: `npm.cmd run build` in `frontend` (prebuild encoding check passed; Vite production build passed).
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed: 441/441.
  - Frontend build passed.

## User Change Safety

The worktree already had many modified and untracked files. This run only edited the app shell auth/provider state logic, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing global app events and long-lived timers, especially any state that can outlive the view where an async request started.
