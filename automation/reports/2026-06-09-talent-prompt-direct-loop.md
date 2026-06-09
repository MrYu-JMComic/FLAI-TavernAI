# 2026-06-09 - Talent Prompt Direct Loop

## Changed Files

- `backend/src/modules/talents.js`
- `backend/src/tests/talentsSource.test.js`
- `automation/backlog.md`
- `automation/reports/2026-06-09-talent-prompt-direct-loop.md`

## Summary

- Replaced `buildTalentSystemPrompt()` line generation with direct prompt string accumulation.
- Added a small `formatTalentPromptLine()` helper so each talent row keeps the same name, rarity, description, and effect formatting without temporary arrays.
- Preserved existing prompt behavior and character-talent ordering while reducing callback work in the active prompt injection path.

## Coverage

- Added a source guard requiring `buildTalentSystemPrompt()` to scan talents directly.
- Added regression checks preventing the previous `talents.map()`, `lines.map()`, and `parts.join()` prompt-building paths from returning.

## Validation

- PASS: `node --test src/tests/talentsSource.test.js` in `backend`.
- PASS: `node --test src/tests/backend.test.js` in `backend`.
- PASS: `node scripts/check-encoding.mjs`.
- PASS: `npm test` in `backend`.
- PASS: `npm run build` in `frontend`.
- PASS: `git diff --check`.
- PASS: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Next Recommended Task

- Continue auditing prompt builders and route payload normalizers for callback-heavy array pipelines on active chat or save paths.
