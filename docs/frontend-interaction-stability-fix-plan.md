# Frontend Interaction Stability Fix Plan

## Objective

Fix all confirmed frontend interaction stability defects from the full-project review, including the separately reported Home dark-theme contrast issue, without disturbing unrelated working-tree changes.

## Scope

- Preserve worldbook AI drafts across list/detail navigation and make entry reordering recover from partial failures.
- Prevent stale Home list responses from overwriting reaction state.
- Isolate assistant version loading by session and make default-image changes recoverable.
- Register chat viewport and keyboard behavior before slow auxiliary loads finish; make Escape close only the topmost chat overlay.
- Correct the Home dark-theme primary action contrast and update only demonstrably stale E2E selectors/assertions.
- Add focused tests for race conditions and failure recovery.

## Checklist

- [x] Add focused regression tests for each confirmed behavior.
- [x] Fix worldbook AI draft lifecycle and partial reorder recovery.
- [x] Fix Home reaction/list response race and dark-theme contrast.
- [x] Fix assistant session history loading and default-image failure recovery.
- [x] Fix chat listener initialization and Escape propagation while preserving existing local edits.
- [x] Review/update stale E2E selectors only where current UI semantics are confirmed.
- [x] Run frontend unit tests, targeted E2E, full E2E, encoding check, and diff check.
- [x] Record validation results and remaining risks here.

## Acceptance Criteria

- Navigating between worldbook list and detail retains unapplied assistant state.
- Partial worldbook reorder failures leave the UI reconciled with server state.
- A delayed Home list response cannot revert a saved favorite or like.
- Switching assistant sessions cannot leave history loading stuck or blank.
- A failed default-image update does not leave the character without a default image.
- Chat keyboard and viewport listeners are active as soon as the page mounts, and Escape closes only the topmost chat overlay.
- Home dark-theme primary button text meets a 4.5:1 contrast ratio.
- All applicable tests and source encoding checks pass; unrelated user changes remain intact.

## Validation Commands

- `npm run test:unit` (frontend)
- `npm run test:e2e -- <targeted specs>` (frontend)
- `npm run test:e2e` (frontend, when the full suite remains feasible)
- `node scripts/check-encoding.mjs`
- `git diff --check`
- `npm run build` (only if it can be run without overwriting protected `frontend/dist`)

## Results

- All seven confirmed interaction defects and the Home dark-theme contrast defect are fixed. Regression coverage now covers draft retention and reorder recovery, Home reaction races, assistant session/image failure recovery, early chat listener registration, and Escape overlay behavior.
- Chat composer focus is now visible on its container in both themes. The Home contrast check measures the final theme color after its transition and verifies at least 4.5:1.
- The stale settings-provider and DeepSeek E2E steps now follow the current settings overview and overlay behavior.

### Validation

- Frontend unit tests: 35 files and 334 tests passed.
- Targeted final E2E: 10 tests passed across chat runtime, DeepSeek response mode, Home design polish, and provider settings.
- Full frontend E2E: 114 tests passed with one worker.
- Production build passed to `.runtime-check/frontend-interaction-stability-build-final-20261024`; protected `frontend/dist` was not touched.
- Encoding check passed across 747 files; `git diff --check` passed (Git emitted existing LF-to-CRLF working-copy warnings).
- Backend focused default-image tests passed (13 tests). The full backend suite previously failed only at the unchanged static expectation in `frontendMarkdownContent.test.js:17`, which still expects the old Markdown watcher structure.
- Review gate completed with E2E 114/114 passed, build passed, and frontend unit tests passed. It returned FAIL only for the same pre-existing backend static expectation at `frontendMarkdownContent.test.js:17` and the production dependency audit, which reports existing high-severity advisories for `markdown-it` and `vite`.

### Visual Verification

- Home dark theme: `.runtime-check/design-polish-home-dark-desktop.png` (1440x980) and `.runtime-check/design-polish-home-dark-mobile.png` (390px, full page). Checked readable button contrast, no horizontal overflow, clipping, or overlap.
- Chat: `.runtime-check/deepseek-online-search-desktop.png` (1440x900) and `.runtime-check/deepseek-online-search-mobile.png` (363px). Checked toolbar alignment, Escape dismissal, viewport fit, and visible composer focus ring.
- Worldbook draft/review: `.runtime-check/frontend-interaction-fix-full/worldbook-assistant-select-bd14e--atomic-apply-and-follow-up-chromium/worldbook-desktop.png` and `worldbook-mobile.png`; reorder recovery screenshots are in `.runtime-check/frontend-interaction-fix-full/worldbook-assistant-partia-604c6--before-reporting-the-error-chromium/`. Checked action controls, long draft content, and mobile fit.
