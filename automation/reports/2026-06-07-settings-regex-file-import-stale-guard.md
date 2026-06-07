# Settings Regex File Import Stale Guard

Date: 2026-06-07

## Scope

Guard the Settings regex-rule file import flow so delayed FileReader completions cannot overwrite import text, run imports, or show read errors after the extension page or regex group state has changed.

## Changes

- Updated `importRegexRules()` to accept the mutation token and group-filter snapshot from its caller.
- Made `handleRegexImportFile()` start a fresh regex mutation generation for each selected file.
- Guarded FileReader `onload` before writing `regexImportText` or triggering the import.
- Added a guarded FileReader `onerror` notification for failed file reads.

## Changed Files

- `frontend/src/views/SettingsView.vue`
- `automation/backlog.md`
- `automation/reports/2026-06-07-settings-regex-file-import-stale-guard.md`

## Validation

- PASS: `node scripts/check-encoding.mjs` before report creation.
  - Scanned 454 files.
- PASS: `npm.cmd run build` in `frontend`.
  - Prebuild encoding check scanned 454 files.
  - Vite production build passed.
- PASS: final `node scripts/check-encoding.mjs` after adding this report.
  - Scanned 455 files.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.
  - Encoding check passed.
  - Unreferenced Vue component diagnostic passed.
  - Vue accessibility diagnostic passed.
  - Backend tests passed.
  - Frontend build passed.

## User Change Safety

The worktree already contained many unrelated modified and untracked files. This run only edited the Settings regex file-import lifecycle path, updated the backlog Done list, and added this report.

## Next Recommended Task

Continue auditing remaining local file reads, especially avatar and preset import paths, for stronger abort or stale-token coverage around FileReader errors.
