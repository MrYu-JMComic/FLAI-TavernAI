# 2026-06-07 Vue Accessibility Diagnostic

## Backlog Item

- Add lightweight accessibility checks for forms and chat controls.

## Changes

- Added `scripts/find-inaccessible-vue-controls.mjs`.
  - Scans Vue files under `frontend/src`.
  - Reports icon-only buttons without `aria-label` or `aria-labelledby`.
  - Reports non-hidden `input`, `textarea`, and `select` controls without an accessible label.
  - Supports `--json`, `--project-root`, `--fail-on-violations`, and `--max-output`.
  - Defaults to a non-blocking diagnostic with capped text output.
- Wired the diagnostic into `scripts/review-gate.ps1` as a non-blocking stage.
- Added validation coverage in `backend/src/tests/validation-scripts.test.js`.
  - Confirms review gate wiring.
  - Confirms fixture detection for unlabeled icon-only buttons and textareas.
  - Confirms default mode exits successfully and strict mode fails on violations.
- Recorded the current diagnostic finding count in `automation/backlog.md`.

## Current Findings

- `node scripts/find-inaccessible-vue-controls.mjs` currently reports 92 potentially inaccessible controls.
- The diagnostic is intentionally non-blocking until existing findings are reviewed and reduced.

## Validation

- PASS: `node scripts/find-inaccessible-vue-controls.mjs`.
- PASS: `node scripts/find-inaccessible-vue-controls.mjs --json`.
- PASS: `node --test src\tests\validation-scripts.test.js` from `backend`.
  - Tests passed: 6/6.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed with no unreviewed candidates.
  - Vue accessibility diagnostic ran and reported 92 findings as non-blocking.
  - Backend tests passed: 393/393.
  - Frontend build passed.
- PASS: final `node scripts/check-encoding.mjs` after this report was written.

## Notes

- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the accessibility diagnostic script, review gate wiring, validation-script tests, backlog, and this report.
- Next recommended task: reduce the first batch of chat-component findings from the new diagnostic output.
