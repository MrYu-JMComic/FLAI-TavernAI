# Save Panel Load Error State

## Scope

- Added an inline load-error state to `frontend/src/components/SaveLoadPanel.vue`.
- Failed save-list loads now clear stale rows, preserve the existing toast error, and show a retry button in the panel.
- Removed unused `Download` and `Plus` icon imports while adding the retry icon used by the new state.

## Changed Files

- `frontend/src/components/SaveLoadPanel.vue`

## Validation

- `npm.cmd run build` passed in `frontend`.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed:
  - Backend test suite passed: 390 tests.
  - Frontend build passed.
  - Encoding checks passed.
- `node scripts/check-encoding.mjs` passed: scanned 313 files; no common Chinese mojibake markers found.

## Notes

- This addresses a concrete empty/loading/error-state backlog item without touching the already-dirty view files.
- Next useful follow-up: inspect another clean, self-contained component for a similarly small user-facing error recovery improvement.
