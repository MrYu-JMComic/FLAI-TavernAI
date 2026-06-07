# Unreferenced Vue Component Is Tag Scope

## Scope

- Tightened dynamic `is` reference matching in the unreferenced Vue component diagnostic so only `<component ... is=...>` tags count as direct component references.
- Kept existing support for static, bound, quoted, unquoted, kebab-case, PascalCase, and spaced `is` values on `<component>`.
- Added fixture coverage proving `is` attributes on non-`component` tags do not hide dormant Vue component files.
- Migrated Chat conversation source coverage to `readVueBlocks()` after review gate exposed a direct Vue SFC read in a parallel test change.

## Changed Files

- `scripts/find-unreferenced-vue-components.mjs`
- `backend/src/tests/validation-scripts.test.js`
- `backend/src/tests/frontendChatConversation.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-unreferenced-vue-component-is-tag-scope.md`

## Validation

- PASS: `cd backend; node --test src\tests\validation-scripts.test.js`
- PASS: `node scripts\find-unreferenced-vue-components.mjs --json`
- PASS: `cd backend; node --test src\tests\source-hygiene.test.js src\tests\frontendChatConversation.test.js src\tests\validation-scripts.test.js`
- PASS: `node scripts\check-encoding.mjs`
- PASS: `git diff --check`
- PASS: `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`

## Notes

- Existing server rate-limit changes were treated as parallel work and left untouched.
- The real project scan still reports no unreviewed Vue component cleanup candidates after the stricter `is` tag scope.
