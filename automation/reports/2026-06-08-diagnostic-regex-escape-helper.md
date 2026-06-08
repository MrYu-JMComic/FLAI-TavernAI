# 2026-06-08 - Diagnostic Regex Escape Helper

## Scope

- Moved duplicate `escapeRegExp` logic into `scripts/diagnostic-file-utils.mjs`.
- Updated the Vue accessibility diagnostic and unreferenced-component diagnostic to use the shared helper.
- Extended validation-script structure checks so the duplicate regex escaping helper does not return to either diagnostic script.

## Changed Files

- `scripts/diagnostic-file-utils.mjs`
- `scripts/find-inaccessible-vue-controls.mjs`
- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-diagnostic-regex-escape-helper.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-inaccessible-vue-controls.mjs --json`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Next Recommended Task

- Keep consolidating diagnostic-only duplication in small steps, and continue avoiding the active parallel Chat, CharacterFormView, and SettingsView edits unless a focused task requires them.
