# 2026-06-07 Home Retry Loading Guards

## Goal

Prevent HomeView manual refresh and retry controls from starting redundant character or tag requests while the matching load is already active.

## Changes

- Added `tagLoading` state around Home tag loading so retry controls can expose and respect pending tag loads.
- Added `retryLoadTags()` to ignore tag retry clicks while tag loading is active.
- Added `retryLoadCharacters()` to ignore manual character refresh clicks while the character list is loading.
- Routed the Home toolbar refresh, character error retry, and tag error retry buttons through guarded retry entry points with matching `disabled` and `aria-busy` bindings.
- Added focused source coverage for the Home retry guards and button bindings.

## Files Touched

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`

## Validation

- `node --test backend\src\tests\frontendHomeView.test.js` passed.
- `node scripts\check-encoding.mjs` passed.
- `git diff --check` reported only LF/CRLF conversion warnings and no whitespace errors.
- `git diff --cached --check` passed.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` passed, including 499 backend/source tests and frontend build.

## Notes

- `loadCharacters()` remains directly usable by search/sort/tag watchers so filter changes can still start a fresh newer request while an older request is pending.
- Existing CharacterForm/auth/settings/preset/world-book/component retry working-tree changes were present during validation and were left untouched.
- MessageToasts working-tree changes appeared before final validation and were left untouched.
