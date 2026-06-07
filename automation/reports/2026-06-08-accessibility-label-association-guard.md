# 2026-06-08 Accessibility Label Association Guard

## Scope

- Continue the Vue accessibility diagnostic hardening in one small pass.
- Require associated `<label>` elements to provide non-empty visible text or their own accessible name before they satisfy a form control.
- Fix only the real unlabeled controls exposed by the stricter diagnostic.

## Relevant Changed Files

- `scripts/find-inaccessible-vue-controls.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `frontend/src/components/chat/ChatModelSwitcher.vue`
- `frontend/src/components/chat/ChatSidebar.vue`
- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendChatModelSwitcher.test.js`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-accessibility-label-association-guard.md`

## What Changed

- Label association now ignores empty wrapping and external labels.
- Label text checks strip nested form controls before deciding whether visible label text exists.
- Dynamic label/name bindings still count as runtime-provided names.
- The stricter diagnostic exposed five real unlabeled controls, which were fixed with concise `aria-label` attributes:
  - Chat model search input.
  - Chat sidebar history search input.
  - Chat sidebar conversation-selection checkbox.
  - Home search input.
  - Home sort select.
- Source tests were updated to expect the new accessible names instead of preserving stale exact-markup assertions.

## Validation

- PASS: `node --test src\tests\validation-scripts.test.js src\tests\frontendChatModelSwitcher.test.js src\tests\frontendChatSidebar.test.js src\tests\frontendHomeView.test.js` in `backend`
  - 19 tests passed.
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
  - Reported `violations: []`.
- PASS: `node scripts\check-encoding.mjs`
  - Scanned 248 files.
- PASS: `git diff --check`
  - Only LF-to-CRLF working-copy warnings were printed.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Encoding, unreferenced Vue component diagnostic, accessibility diagnostic, backend tests, frontend build, and final status reporting passed.

## Notes

- The worktree already contained many unrelated pending source, test, and archived-report changes. This iteration did not revert or overwrite those changes.
- `frontend/src/views/HomeView.vue` already has other pending HomeView work in the dirty tree; this report only covers the accessible-name additions.
- No data, upload, env, dependency, generated output, deployment, push, or Git reset actions were used.

## Next Recommended Task

- Continue using fixture-backed diagnostic hardening before deleting or rewiring dormant code, with each scanner change paired to a real frontend scan.
