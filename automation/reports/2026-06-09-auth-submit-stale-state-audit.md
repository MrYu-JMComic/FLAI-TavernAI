# 2026-06-09 - Auth Submit Stale State Audit

## Changed Files

- `automation/reports/2026-06-09-auth-submit-stale-state-audit.md`

## Summary

- Performed a read-only audit because the worktree already contained unrelated backend/provider changes.
- Found a concrete stale-state risk in `frontend/src/views/LoginView.vue` and `frontend/src/views/RegisterView.vue`.
- Both auth forms emit `authenticated` with the awaited login/register result and then always set `loading.value = false` in `finally`.
- `frontend/src/App.vue` handles that event by refreshing provider state and navigating to `home`, which can replace the auth component before the `finally` state write runs.

## Evidence

- `LoginView.vue`: `submit()` sets `loading.value = true`, emits `authenticated` from the awaited `login(...)`, then clears `loading` in `finally`.
- `RegisterView.vue`: `submit()` follows the same pattern after `register(...)`.
- `App.vue`: `handleAuthenticated()` sets the user/provider state and calls `navigate('home')`, replacing the auth route component.
- Existing `frontendAuthViews` coverage only asserts busy locking; it does not assert stale completion guards or unmount cleanup.

## Recommended Fix

- Add `onBeforeUnmount` disposal state and a submit token to both auth views.
- Only emit success, notify errors, and clear `loading` when the submit token is still current and the component is still mounted.
- Extend `backend/src/tests/frontendAuthViews.test.js` to lock the guard contract.

## Validation

- PASS: Read-only source audit with `rg` and targeted file inspection.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `git diff --check -- automation/reports/2026-06-09-auth-submit-stale-state-audit.md`.

## Notes

- Existing unrelated dirty files were intentionally left untouched:
  `automation/backlog.md`, `backend/src/routes/settings.js`, `backend/src/services/providers.js`, `backend/src/tests/backend.test.js`, and `automation/reports/2026-06-09-gemini-openai-compatible-request-guard.md`.
