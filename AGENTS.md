# FLAI TavernAI Agent Guide

This repository may be maintained by AI agents. Follow this file before making
changes. Keep this file ASCII-only unless the user explicitly asks otherwise.

## Project Shape

- Frontend: `frontend`, Vue + Vite.
- Backend: `backend`, Express + Node 24 with `node:sqlite`.
- Backend tests: run from `backend` with `npm test`.
- Frontend build: run from `frontend` with `npm run build`.
- Review gate: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`.

## Safety Rules

- Do not edit `backend/data`, `backend/uploads`, `.env`, `.env.*`,
  `node_modules`, or generated build output.
- Do not reset Git state, force checkout, publish, deploy, push, or create
  external PRs unless the user explicitly asks.
- Do not delete files unless the user explicitly asks. If deletion is requested,
  verify the resolved paths stay inside the workspace before deleting.
- Preserve unrelated user changes. If `git status --short` shows unrelated or
  unclear work, avoid overwriting it.
- Keep each change small enough to review in one sitting.
- Do not write secrets to the repository.

## Encoding

- Save source and Markdown files as UTF-8.
- Do not paste mojibake or replacement-character text into source files.
- Prefer tools and editors that write UTF-8 explicitly on Windows.
- Run `node scripts/check-encoding.mjs` before reporting code or Markdown edits
  complete.

## Implementation Hygiene

- Read the existing code before editing.
- Prefer the repository's existing patterns and helpers over new abstractions.
- When a new path replaces an old path, remove the obsolete branch, helper,
  style, test expectation, or documentation reference when it is safe.
- Avoid duplicate controls, parallel implementations, and permanent workarounds.
- If cleanup is unsafe, report the reason and the follow-up task.

## Validation

- For backend changes, run `npm test` in `backend`.
- For frontend changes, run `npm run build` in `frontend`.
- For any text/source change, run `node scripts/check-encoding.mjs`.
- For broad changes, run the review gate command.
- If a validation command cannot be run, report exactly what was skipped and why.

## Autonomous Work

- Prefer small, verified iterations.
- Inspect current project state and Git status before editing.
- Make the smallest useful change.
- Validate the relevant surface before declaring success.
- Summarize changed files, validation results, and any remaining risks.
