# Agent Task Planning Workflow Plan

## Objective

Require a task-specific Markdown plan for every task, then derive task goals
from that plan and execute them while keeping progress current.

## Scope

- Update AGENTS.md with the mandatory planning and execution workflow.
- Preserve existing safety, cleanup, encoding, and validation requirements.

## Steps

- [x] Inspect repository status and existing agent instructions.
- [x] Create this task plan before implementation.
- [x] Add plan naming, goal creation, execution, and progress rules to AGENTS.md.
- [x] Review the documentation diff and run the encoding check.

## Acceptance Criteria

- Every task starts with a descriptively named plan Markdown file.
- Task goals and execution steps follow the plan.
- Progress, validation results, and blockers are recorded in the plan.

## Validation

- Run `node scripts/check-encoding.mjs` after documentation edits.
- Backend tests and frontend build do not apply to this documentation-only task.

## Results

- AGENTS.md now requires a task-specific plan, goals derived from that plan,
  execution against its checklist, and progress and validation updates.
- Encoding check passed; documentation diff review and whitespace check passed.
- No blockers or remaining work.
