# FLAI TavernAI Agent Guide

This repository may be maintained by AI agents. Read this guide before making
changes. Keep this file ASCII-only unless the user explicitly requests another
encoding or language.

## Project Overview

- Frontend: `frontend`, Vue and Vite.
- Backend: `backend`, Express and Node 24 with `node:sqlite`.
- Backend tests: run `npm test` from `backend`.
- Frontend build: run `npm run build` from `frontend`.
- Review gate: run `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Safety and Change Boundaries

- Do not edit `backend/data`, `backend/uploads`, `.env`, `.env.*`,
  `node_modules`, or generated build output.
- Do not reset Git state, force checkout, publish, deploy, push, or create an
  external PR unless the user explicitly asks.
- Do not delete files unless the user explicitly asks or the file is made
  obsolete by the requested feature's related cleanup; the user authorizes
  that scoped cleanup by default, so no separate approval is needed.
- Before removing an obsolete file, check its references and other
  responsibilities, and verify that its resolved path stays inside the
  workspace. If its scope or dependencies are unclear, leave it in place and
  report the follow-up.
- Preserve unrelated user changes. Inspect `git status --short` first, and do
  not overwrite work that is unrelated or unclear.
- Keep each change small enough to review in one sitting.
- Do not write secrets to the repository.

## Required Workflow

1. Inspect the current project state and Git status before editing.
2. Before implementation, create or continue a Markdown plan at
   `docs/<task-summary>-plan.md`. Use a short, descriptive kebab-case name;
   add a date or suffix when needed to avoid overwriting an unrelated plan.
3. Put the objective, scope, actionable checklist, acceptance criteria, and
   validation commands in the plan. Include related legacy-code cleanup when
   adding a feature.
4. Create trackable task goals from the plan, then execute the checklist in
   dependency order. Keep the plan as the execution reference.
5. Read the affected code before editing. Make the smallest useful change and
   use existing project patterns and helpers.
6. Update the plan as work finishes or scope changes. Record validation
   results, blockers, and remaining work. Mark goals complete only after the
   applicable acceptance criteria and checks pass.
7. Summarize changed files, validation results, and remaining risks when
   reporting completion.

## Implementation Hygiene

- When adding a feature, include cleanup of directly related obsolete code,
  helpers, styles, tests, and documentation by default. No separate approval
  is needed for this scoped cleanup.
- Review the affected paths for obsolete logic, unused helpers, duplicate
  implementations, and stale tests or documentation. Preserve behavior that
  is still needed, and do not turn feature cleanup into a general refactor.
- When a new path replaces an old path, remove the obsolete branch, helper,
  style, test expectation, or documentation reference when safe.
- Remove obsolete files only when they are made unnecessary by the requested
  feature, their references and other responsibilities have been checked, and
  their resolved paths are inside the workspace.
- Avoid duplicate controls, parallel implementations, and permanent
  workarounds. If cleanup is unsafe, report the reason and a follow-up task.
- Add concise comments to meaningful new or substantially changed methods and
  functions. Explain their purpose and the role of relevant parameters; include
  return values or side effects when that clarifies the contract.
- When changing a method's behavior or parameters, update its existing comment
  so the documentation remains accurate.
- Do not add a comment to every line or restate obvious implementation details.
  Skip files and formats that do not support appropriate comments, and avoid
  forcing comments on trivial, self-explanatory methods.

## Frontend Visual Verification

- After frontend changes, run the affected UI and capture screenshots of the
  changed pages and states using the available browser or UI tooling.
- Inspect the screenshots themselves for alignment, spacing, typography,
  contrast, overflow, clipping, and overlapping controls.
- Check desktop and mobile layouts when the affected UI supports both.
- If the result looks unbalanced or has layout problems, refine the affected
  UI within the existing design patterns and repeat screenshot verification.
- Record screenshot locations, checked viewports, and verification results in
  the task plan and final summary.
- If screenshots cannot be captured or inspected, report the exact blocker and
  the remaining visual verification work. Do not claim visual verification
  passed.

## Encoding and Validation

- Save source and Markdown files as UTF-8.
- Keep this file ASCII-only unless the user explicitly requests otherwise.
- Do not paste mojibake or replacement-character text into source files.
- Prefer tools and editors that write UTF-8 explicitly on Windows.
- Run `node scripts/check-encoding.mjs` before reporting source or Markdown
  edits complete.
- For backend changes, run `npm test` from `backend`.
- For frontend changes, run `npm run build` from `frontend` and complete the
  Frontend Visual Verification steps above.
- For broad changes, run the review gate command from Project Overview.
- Use `git diff --check` for changed text files when practical.
- If a validation command cannot be run, report exactly what was skipped and
  why.
