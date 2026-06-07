# Chat Appearance Save Stale Guard

Date: 2026-06-07

## Scope

Guarded chat appearance saves so stale responses from an older conversation cannot update the active conversation appearance, show stale success or error notices, or leave the save button stuck after navigation.

## Changed Files

- `frontend/src/composables/chat/useChatAppearance.js`
- `automation/backlog.md`
- `automation/reports/2026-06-07-chat-appearance-save-stale-guard.md`

## Validation

- PASS: `npm.cmd run build` in `frontend`.
  - Encoding precheck passed: scanned 419 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed: scanned 419 files.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic passed with no inaccessible controls.
  - Backend tests passed: 438/438.
  - Frontend production build passed.
  - Git status reported existing dirty worktree.
- PASS: final `node scripts/check-encoding.mjs`.
  - Encoding check passed: scanned 419 files.

## Notes

- Added an appearance save token that must match before writing saved settings, showing errors, showing success, or clearing save state.
- Kept the existing conversation id guard and made save-state cleanup token-based so navigation during a save does not leave the current settings drawer stuck in a saving state.

## Next Recommended Task

Continue checking chat settings actions where async saves call follow-up apply or refresh routines before showing user-facing notices.
