# NPC panel load error retry state

Date: 2026-06-07

## Scope

Improved the chat NPC management panel's behavior when NPC list or detail requests fail.

## Changed files

- `frontend/src/components/NpcPanel.vue`
  - Added inline retryable error state for failed NPC list loads.
  - Added retryable error state for failed NPC memory/behavior detail loads.
  - Cleared stale detail rows when switching NPCs or when a detail request starts, preventing the previous NPC's memories and behaviors from appearing under the newly selected NPC after a failed request.
  - Preserved already loaded NPC lists during refresh failures while showing an inline retry notice.

## Validation

- PASS: `npm.cmd run build` from `frontend`.
  - Encoding precheck passed: scanned 314 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 390/390.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report file was added.
  - Encoding check passed: scanned 315 files.

## User change safety

The worktree already had many modified and untracked files. This run only edited `frontend/src/components/NpcPanel.vue` and added this report.

## Notes

- `frontend/src/components/CharacterImagePanel.vue` did not show a direct reference in `frontend/src` during inspection, so this run avoided polishing that potentially unused path.

## Next recommended task

Review the suspected unused `CharacterImagePanel.vue` path and decide whether it should be wired back into the character form, covered by a guard, or left for explicit deletion approval.
