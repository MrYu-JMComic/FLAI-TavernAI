# Settings Regex Stale Load Guard

## Summary

- Added a request token guard for Settings regex rule loads.
- Captured the active regex group filter before fetching rules.
- Ignored stale rule responses, errors, and loading-state updates when the group filter has already changed.
- Recorded the iteration in `automation/backlog.md`.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-regex-stale-load-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 402 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 402 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 435/435.
  - Frontend production build passed.
  - Git status reported the existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 402 files.

## Next Recommended Task

- Continue reviewing extension-section loaders for stale async writes or shared loading state when users switch filters quickly.
