# Regex Rule Deletion Plan

## Objective

Allow users to delete a regex rule from the extensions management list and persist the change.

## Scope

- Inspect the existing settings panel, regex API, confirmation flow, and async state handling.
- Add the missing deletion control, frontend API helper, and ownership-scoped backend endpoint.
- Keep disabled rules deletable and retain the existing toggle, filtering, and ordering behavior.
- Review related legacy code for obsolete or duplicate deletion paths; reuse existing helpers.
- Preserve all unrelated working tree changes and existing user rules during verification.

## Checklist

- [x] Inspect the existing deletion API and settings conventions; identify the failure.
- [x] Implement a focused deletion flow with confirmation, busy state, and error handling.
- [x] Validate deletion, cancellation, failure, and persistence using isolated test data.
- [x] Run the frontend build and encoding check; record results and review the final diff.

## Acceptance Criteria

- Each regex rule has a clearly labelled, accessible delete action.
- Cancelling confirmation sends no delete request and preserves the rule.
- Confirming deletion removes the selected rule and persists after reloading.
- Failed requests preserve the rule, show an error, and release busy state.
- Duplicate requests and stale responses are handled consistently with other settings actions.
- Existing toggle, filtering, and ordering behavior is preserved.

## Validation Commands

- Run the relevant existing frontend unit or settings behavior tests.
- Run focused browser checks with isolated rule data when available.
- `npm run test:unit -- src/components/__tests__/settingsRegexDelete.test.js` from `frontend`.
- `npm run test:e2e -- settings-regex-delete.spec.js` from `frontend`, with `FLAI_E2E_BACKEND_PORT=3221` and `FLAI_E2E_FRONTEND_PORT=5184`.
- `npm run build` from `frontend`.
- `node scripts/check-encoding.mjs` from the repository root.
- `npm test` from `backend` (backend endpoint changes are required).

## Findings and Results

- Initial Git status contains substantial unrelated work; target regex panel and composable are currently unchanged.
- The extensions regex panel currently exposes only an enable/disable action for each rule.
- The frontend API helper and backend router also lack a single-rule delete operation; a focused backend endpoint and ownership regression tests are required.
- Reuse the settings list removal helper and async mutation tokens; the character editor's local draft removal remains necessary and is not a duplicate persisted deletion path.
- Implemented the accessible per-rule delete action, confirmation, guarded mutation, local list/group update after success, and error notification without removing failed rows.
- Added an authenticated backend endpoint using an owner-scoped DELETE and a 404 for missing or foreign rules.
- Updated two stale source contract expectations to include the delete icon and deletion busy state.
- Backend regex regression tests: PASS, 19/19.
- Frontend integrated deletion regression tests: PASS, 7/7 (cancellation, missing ID, disabled rule removal, reload, group cleanup, failure/retry, pending controls, duplicate suppression, stale responses, toggle compatibility).
- Full backend `npm test`: PASS, 1603/1603. Log: `.runtime-check/regex-rule-delete-backend-tests.log`.
- Frontend `npm run build`: PASS; existing advisory about chunks larger than 500 kB remains.
- Browser inspection of the running development page confirms the delete action is present on enabled and disabled rules and fits the current narrow viewport.
- Isolated Playwright end-to-end validation: PASS, 2/2 at 959x930 and 390x844. Verified cancellation sends no DELETE, confirmed deletion persists, remaining rules are unchanged, group options update, and reload/character API reads agree.
- End-to-end verification used dedicated ports 3221/5184 and an in-memory database. No existing user rules were changed during verification.
- Reviewed desktop/mobile screenshots; the delete control is visible and fits both layouts.
- Final encoding check: PASS, 680 files scanned. Scoped Git diff whitespace check: PASS.
- Independent final review found no actionable issues. Unrelated changes in SettingsView were preserved.
- The live backend is supervised by `node --watch src/server.js`; source changes reload automatically.
- No remaining work or blockers. The full review gate was not required for this focused change; relevant backend, frontend, end-to-end, and encoding checks passed.
