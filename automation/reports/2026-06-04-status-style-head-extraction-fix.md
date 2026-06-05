# 2026-06-04 Status Style Head Extraction Fix

## Task

修复用户粘贴的状态栏模板 `<style>...</style><div class="sb-panel">...` 实际显示成纯文本排版的问题。

## Changed Files

- `frontend/src/components/StatusBar.vue`
- `automation/reports/2026-06-04-status-style-head-extraction-fix.md`

## Summary

- Fixed custom status bar template style extraction for templates that start with a `<style>` tag.
- The previous sanitizer only scanned `DOMParser` body nodes; leading `<style>` tags can be moved into the parsed document head and were missed.
- Style blocks are now extracted before DOM parsing, sanitized, scoped to the current status bar instance, and injected into the page.
- `{{变量.percent}}` now resolves to a CSS-ready percentage such as `80%`, while `{{变量.percentage}}` remains numeric.

## Validation

- `npm.cmd run build` in `frontend`: passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`: passed.

## Notes

- The pasted template uses `width:{{体力.percent}}`; this now becomes valid CSS like `width:80%`.
- Existing unrelated modified/untracked files were preserved.
