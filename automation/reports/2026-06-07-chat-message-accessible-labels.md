# 2026-06-07 Chat Message Accessible Labels

## Backlog Item

- Burn down `node scripts/find-inaccessible-vue-controls.mjs --json` findings.

## Changes

- Added accessible names in `frontend/src/components/chat/ChatMessageItem.vue`.
  - Message edit textarea.
  - Previous candidate reply button.
  - Next or new candidate reply button.
  - Branch-from-message button.
- Added an accessible name to the close button in `frontend/src/components/chat/ChatModelSwitcher.vue`.
- Updated `automation/backlog.md` to reflect the current diagnostic count.

## Diagnostic Result

- Before this run, the Vue accessibility diagnostic reported 92 potentially inaccessible controls.
- After this run, `node scripts/find-inaccessible-vue-controls.mjs --json` reports 87 potentially inaccessible controls.
- `ChatMessageItem.vue` and `ChatModelSwitcher.vue` no longer appear in the diagnostic output.

## Validation

- PASS: `node scripts/find-inaccessible-vue-controls.mjs --json`.
- PASS: `npm.cmd run build` in `frontend`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic ran and reported 87 findings as non-blocking.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the two chat components, backlog count, and this report.
- Next recommended task: reduce the remaining chat findings in `ChatSettingsDrawer.vue` and `ChatSidebar.vue`.
