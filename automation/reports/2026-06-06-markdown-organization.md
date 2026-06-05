# Markdown Organization Cleanup

Date: 2026-06-06

## Scope

Clean up Markdown storage paths and define where future Markdown files should live.

## Changed Files

- `README.md`
- `docs/README.md`
- `docs/markdown-organization.md`
- `docs/ai-dev-workflow.md`
- `docs/project-structure.md`
- `docs/archive/test.md`
- `scripts/self-evolve.ps1`
- `automation/plans/legacy/*`
- `automation/prompts/opencode-self-evolve.prompt.md`
- `automation/tasks/*`
- `automation/reports/audits/*`

## Change

- Added `docs/markdown-organization.md` as the canonical Markdown routing guide.
- Added `docs/README.md` as an index for active project documentation.
- Moved top-level audit and robustness reports from `reports/` into `automation/reports/audits/`.
- Moved task briefs into `automation/tasks/`.
- Moved reusable prompt Markdown into `automation/prompts/`.
- Routed ignored generated Claude prompt drafts to `automation/prompts/`.
- Moved older root-level automation plans into `automation/plans/legacy/`.
- Archived the placeholder `docs/test.md` as `docs/archive/test.md`.
- Updated the self-evolve script to read the prompt from the new `automation/prompts/` path.
- Updated relevant documentation references for the new report and prompt paths.

## Validation

- `node scripts/check-encoding.mjs`: PASS.
- `Test-Path automation\prompts\opencode-self-evolve.prompt.md`: PASS.
- `Test-Path automation\prompts\claude-prompt.md`: PASS.
- `Test-Path automation\claude-prompt.md`: PASS, returns false after ignored prompt migration.
- Active docs/script old-path search: PASS, no stale active references found.
- `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1`: PASS, including encoding check, 241 backend tests, frontend build, and git status audit.

## Notes

- Historical reports that mention old paths were left unchanged because they record past state.
- Concurrent `characterImages` code/test/report changes are present in the worktree but are not part of this Markdown cleanup.
