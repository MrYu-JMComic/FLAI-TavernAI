# Markdown Organization

This file is the routing guide for Markdown files in this repository.

## Root Directory

Keep only stable entry and governance files at the repository root:

- `README.md`
- `AGENTS.md`
- `governance.md`
- `governance-permissions.md`

Local AI workspace files such as `ENVIRONMENT.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md`, and `HEARTBEAT.md` are ignored by Git and may remain local-only at the root when a tool requires that location.

## Docs

Use `docs/` for durable project documentation that a developer or operator should read repeatedly.

- `docs/README.md` indexes active docs.
- `docs/archive/` keeps obsolete or placeholder docs that are retained for history.

## Automation

Use `automation/` for AI-agent working artifacts.

- `automation/backlog.md` remains the canonical autonomous backlog.
- `automation/plans/` stores active task plans.
- `automation/plans/legacy/` stores old plans, edicts, roadmaps, and superseded planning notes.
- `automation/prompts/` stores reusable agent/tool prompt files.
- Ignored generated prompt drafts such as `automation/prompts/claude-prompt.*` also belong under `automation/prompts/`.
- `automation/tasks/` stores task briefs and dispatch files.
- `automation/reports/` stores standard iteration reports.
- `automation/reports/audits/` stores larger audits, robustness reviews, project analyses, and optimization reports.

## Naming

- Reports: `YYYY-MM-DD-topic-slug.md`
- Plans: `YYYY-MM-DD-topic-plan.md` or the existing task ID format when a governance task already has one.
- Task briefs: `task-topic-slug.md` or the assigned governance task ID.
- Prompt files: `tool-or-agent-purpose.prompt.md`

## Cleanup Rules

- Do not delete Markdown files during cleanup unless the user explicitly asks.
- Prefer `git mv` for tracked Markdown moves so history is preserved.
- Update path references in scripts and docs in the same change.
- Run `node scripts/check-encoding.mjs` before reporting completion.
