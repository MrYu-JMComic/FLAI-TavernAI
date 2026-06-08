# Provider Message Clone Helper

## Backlog item

- Shared provider tool-completion message cloning through one direct-loop helper.

## Changed files

- `backend/src/services/providers.js`
- `backend/src/tests/backend.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-08-provider-message-clone-helper.md`

## What changed

- Replaced repeated provider tool-completion message shallow clones with `cloneProviderMessages`.
- Kept non-streaming OpenAI-compatible, streaming OpenAI-compatible, and Anthropic tool-completion paths on the same cloning helper.
- Extended provider tool-completion tests so guarded source message arrays fail if future code reintroduces `Array.prototype.map` cloning for these paths.

## Validation

- Focused backend provider coverage passed before this report was written:
  - `node --test backend\src\tests\backend.test.js --test-name-pattern "(runToolCompletion skips malformed tool calls|streamToolCompletion normalizes streaming tool calls|Anthropic tool completion skips malformed tool rows)"`
- Full review gate passed:
  - `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`
  - Covered encoding check, unreferenced Vue component diagnostic, Vue accessibility diagnostic, backend tests, frontend build, and Git status check.

## Next recommended task

- Continue scanning provider helper paths for repeated allocation-only transforms, but only where source tests can pin behavior and avoid negative optimization.
