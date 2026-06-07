# 2026-06-07 Talent Roll Retry Loading Guard

## Goal

Prevent TalentRollDialog error-state retry clicks from starting redundant pool/talent refreshes while dialog data is already loading.

## Changes

- Added a dedicated `retryLoadDialogData()` entry point that ignores retry events while `loading` is active.
- Routed the error-state retry button through the guarded retry entry point.
- Added `aria-busy` to the retry button so the visible loading state matches the handler guard.
- Added focused source coverage for the retry guard and retry button binding.

## Files Touched

- `frontend/src/components/TalentRollDialog.vue`
- `backend/src/tests/frontendTalentRollDialog.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendTalentRollDialog.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 496 backend/source tests and frontend build.

## Notes

- `loadDialogData()` remains reusable for the initial immediate watcher and character/context changes; only the user retry entry point is blocked while loading.
- Existing CharacterImagePanel/auth/settings/preset/world-book working-tree changes were present during validation and were left untouched.
