# 2026-06-08 Extension Hook Unregister Direct Loop

## Goal

Avoid needless array allocation when removing a missing extension hook while preserving hook priority order and cleanup behavior.

## Changed Files

- `frontend/src/services/extensionHooks.js`
- `backend/src/tests/frontendExtensionHooks.test.js`
- `automation/backlog.md`

## Changes

- Reworked `unregisterHook` to scan hook entries directly and only allocate a replacement list after the target extension is found.
- Preserved existing behavior for removing a hook, removing the last hook for a type, and returning false when nothing is removed.
- Added behavior coverage plus a source guard against returning to `entries.filter(...)`.

## Validation

- PASS: `node --test backend\src\tests\frontendExtensionHooks.test.js` (2 tests)
- PASS: `node scripts/check-encoding.mjs` (492 files)
- PASS: `git diff --check` (CRLF warnings only)
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` (805 backend tests and frontend build)

## Next

- Continue favoring pure helper refactors with behavior tests over broad runtime rewrites.
