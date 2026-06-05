# Character Assistant Status Placeholder Fix

## Summary

- Strengthened the character assistant status bar instructions so custom templates must bind dynamic values with `{{变量名}}` placeholders.
- Updated `statusBarBlueprint.variables[].value` to accept both numeric meter values and string text values.
- Added backend coverage to ensure the provider request includes placeholder guidance, `.sb-val` rules, and string-capable status variable schema.

## Changed Files

- `backend/src/services/characterAssistant.js`
- `backend/src/tests/backend.test.js`
- `automation/reports/2026-06-05-character-assistant-status-placeholders.md`

## Validation

- `node scripts/check-encoding.mjs` — PASS
- `node --test src\tests\backend.test.js` from `backend` — PASS
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` — PASS

## Notes

- The repository had many unrelated modified and untracked files before this fix; this iteration only targeted the character assistant status bar generation path.
- Generated custom status rows should now use patterns such as `<span class="sb-val">{{姓名}}</span>` with variables like `{"name":"姓名","value":"待定"}` instead of hardcoding `待定` in the template.
