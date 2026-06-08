# 2026-06-08 Home Provider Hot Tag Direct Helpers

## Goal

Reduce small repeated allocations in HomeView computed UI state while keeping provider and hot-tag labels stable.

## Changed Files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`

## Changes

- Replaced provider label `filter(Boolean).join(...)` with a direct formatting helper.
- Replaced hot-tag selected containment `some(...)` callbacks with a shared direct scan helper.
- Added source-test guards for the provider label helper and hot-tag containment scan.

## Validation

- PASS: `node --test backend\src\tests\frontendHomeView.test.js` (11 tests passed)
- PASS: `node --test backend\src\tests\frontendHomeView.test.js backend\src\tests\npcs.test.js` (32 tests passed)
- PASS: `npm.cmd test` in `backend` (823 tests passed)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next

- Continue with narrow HomeView and SettingsView refresh paths that still allocate during repeated UI state recomputation.
