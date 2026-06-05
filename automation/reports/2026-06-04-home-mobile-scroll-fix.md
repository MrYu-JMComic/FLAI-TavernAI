# 2026-06-04 Home Mobile Scroll Fix

## Task

修复手机端首页中角色列表与整页滚动分离，导致滑动和操作不方便的问题。

## Changed Files

- `frontend/src/views/HomeView.vue`
- `frontend/src/styles.css`
- `automation/reports/2026-06-04-home-mobile-scroll-fix.md`

## Summary

- Added a mobile layout mode for the home role list using `matchMedia('(max-width: 760px)')`.
- Mobile now renders characters in a normal page-flow grid instead of inside the virtualized fixed-height scroll container.
- Desktop keeps the virtualized role list for better performance with larger character libraries.
- Added resize listener cleanup and scroll measurement refresh when switching between mobile and desktop layouts.
- Added `.home-character-list` styles so the mobile list shares the redesigned card appearance without nested scrolling.

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `node scripts/check-encoding.mjs`: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: passed.

## Notes

- The repository already had many unrelated modified and untracked files before this run. This iteration only intentionally changed the homepage component, homepage styles, and this report.

## Next Recommended Task

Open the homepage at mobile width and confirm the scroll gesture now moves the whole page continuously from hero to the final role card.
