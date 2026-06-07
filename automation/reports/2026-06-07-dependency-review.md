# 2026-06-07 Dependency Review

## Backlog Item

- Review dependency versions and record upgrade candidates before changing them.

## Changes

- Added `docs/dependency-review.md`.
  - Recorded `npm outdated --json --long` results for backend and frontend.
  - Recorded `npm audit --json` summaries for backend and frontend.
  - Grouped upgrade candidates into small recommended batches.
  - Listed validation commands to run after any actual upgrade.
- Added the dependency review to `docs/README.md`.
- Moved the backlog item from Ready to Done.

## Findings

- Backend audit: 0 known vulnerabilities.
- Frontend audit: 0 known vulnerabilities.
- Backend upgrade candidate: `dompurify` `3.4.5` -> `3.4.8`.
- Frontend upgrade candidates:
  - `@tanstack/vue-virtual` `3.13.25` -> `3.13.28`.
  - `dompurify` `3.4.5` -> `3.4.8`.
  - `@lucide/vue` `1.16.0` -> `1.17.0`.
  - `vite` `8.0.14` -> `8.0.16`.
  - `vue` `3.5.34` -> `3.5.35`.

## Validation

- PASS: `node scripts/check-encoding.mjs` scanned 343 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`.
  - Backend tests passed: 393/393.
  - Frontend build passed.
  - Vue accessibility diagnostic reported no findings.

## Notes

- No dependency versions were changed in this run.
- The worktree already contained many modified and untracked files from earlier iterations; this run intentionally changed the dependency review doc, docs index, backlog, and this report.
