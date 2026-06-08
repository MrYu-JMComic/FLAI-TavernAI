# 2026-06-09 - Home Mobile Layout Next-Tick Guard

## Changed Files

- `frontend/src/views/HomeView.vue`
- `backend/src/tests/frontendHomeView.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-home-mobile-layout-nexttick-guard.md`

## Summary

- Guarded the HomeView mobile-list layout watcher after its `nextTick()` await so unmounted home views cannot recreate scroll measurement work.
- Extended HomeView source coverage to keep the post-tick active-view check next to the existing ResizeObserver cleanup contract.

## Validation

- PASS: `node --test src/tests/frontendHomeView.test.js` in `backend` (11 tests)
- PASS: `node scripts/check-encoding.mjs` (scanned 555 files)
- PASS: `git diff --check` (line-ending warnings only)
- PASS: `npm.cmd test` in `backend` (848 tests)
- PASS: `npm.cmd run build` in `frontend`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## Next Recommended Task

- Continue auditing `nextTick()` and animation-frame layout callbacks for post-unmount active-scope checks.
