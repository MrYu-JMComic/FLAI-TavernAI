# Economy panel load error retry state

Date: 2026-06-07

## Scope

Improved the economy side panel's resilience when account or history requests fail.

## Changed files

- `frontend/src/components/EconomyPanel.vue`
  - Added separate inline error state for initial economy account loading.
  - Added separate inline error state for transaction history loading.
  - Added retry buttons that re-run the appropriate request without relying only on toast messages.
  - Cleared stale history totals and offsets on failed loads so pagination does not survive an error.
  - Removed the unused `Gem` icon import while adding the `RefreshCw` retry icon.

## Validation

- PASS: `npm.cmd run build` from `frontend`.
  - Encoding precheck passed: scanned 313 files.
  - Vite production build passed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding checks passed.
  - Backend tests passed: 390/390.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report file was added.
  - Encoding check passed: scanned 314 files.

## User change safety

The worktree already had many modified and untracked files. This run only edited `frontend/src/components/EconomyPanel.vue` and added this report.

## Next recommended task

Continue the Vue empty/loading/error-state backlog item in another clean component, such as `NpcPanel.vue` or `CharacterImagePanel.vue`, while preserving the existing dirty worktree.
