# NPC panel mutation stale guard

Date: 2026-06-07

## Scope

Hardened the chat NPC management panel's write-side async completions so old memory, behavior, or cleanup requests do not mutate the panel after the user changes conversation or NPC selection.

## Changed files

- `frontend/src/components/NpcPanel.vue`
  - Added an NPC mutation generation token that is invalidated when the panel resets for a different conversation.
  - Invalidated in-flight NPC writes when the user selects a different NPC.
  - Reused a single current-mutation helper across memory add/delete, behavior add/toggle/delete, single NPC removal, and empty NPC cleanup.
  - Added post-refresh guards so success notices are skipped if navigation or selection changes while the list refresh is still running.
  - Suppressed stale error notices from write requests that complete after the user has moved away.
- `automation/backlog.md`
  - Recorded this autonomous iteration in Done.

## Validation

- PASS: `npm.cmd run build` from `frontend`.
  - Encoding precheck passed: scanned 430 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 441/441.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report file was added and updated.
  - Encoding check passed: scanned 430 files.

## User change safety

The worktree already had many modified and untracked files. This run only edited `frontend/src/components/NpcPanel.vue`, updated `automation/backlog.md`, and added this report.

## Notes

- The token is not incremented per mutation, so same-NPC parallel actions are not unnecessarily canceled. It only advances on conversation reset and user NPC selection changes.

## Next recommended task

Review `EconomyPanel.vue` write-side mutation completions for stale conversation switches after currency/item updates.
