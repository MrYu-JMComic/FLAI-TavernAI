# FLAI TavernAI Autonomous Iteration Guide

This project may be maintained by AI agents. Follow these rules before changing code.

## Governance - Three-Office Workflow

See `governance.md` for the full framework. Keep this file ASCII-only unless the user explicitly approves otherwise, so every agent and terminal can read it without encoding ambiguity.

### Separation Of Duties

| Office | Holder | Duties |
|---|---|---|
| Planning Office (Zhongshu) | Le (human) | Approve initiatives, write plans, maintain backlog |
| Review Office (Menxia) | Automation | Run tests, generate reports, decide pass/fail |
| Implementation Office (Shangshu) | OpenCode / Claude Code | Write code and edit files |

### Core Rules

- No approved planning item -> Implementation Office must not act.
- No Review Office approval -> changes must not be merged.
- No person or agent may serve as both Planning Office and Review Office.
- Review Office gate command: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

### Encoding Rules

- All source and Markdown files must be UTF-8. Do not save files with GBK, ANSI, or PowerShell's default legacy encoding.
- Keep `AGENTS.md` ASCII-only by default because it is the cross-agent entry point.
- On Windows, prefer Node `fs.readFileSync/writeFileSync(..., 'utf8')`, editor UTF-8 mode, or PowerShell `Set-Content -Encoding utf8` when writing files.
- Never paste mojibake or replacement-character text into source files.
- Run `node scripts/check-encoding.mjs` before reporting that a code change is complete.

## Mission

Improve FLAI TavernAI in small, verified iterations. Prefer fixes and product polish that make the app more reliable, easier to use, and easier to maintain.

## Implementation Hygiene - Old Code Cleanup

- Do not only layer patches on top of old behavior. When a fix or new flow replaces an older UI entry, component branch, helper, style rule, test expectation, or dead branch, identify the replaced path and clean it up in the same small iteration when safe.
- Prefer simplifying the existing path over adding another permanent workaround.
- Avoid duplicate controls, overlapping responsive rules, parallel implementations, and avoidable compatibility branches that make the app harder to maintain.
- If cleanup cannot be done safely because it would touch unrelated user work, widen risk, or require separate design, record the reason, retained scope, and exact follow-up task in the iteration report.

## Project Shape

- Frontend: `frontend`, Vue + Vite.
- Backend: `backend`, Express + Node 24 with `node:sqlite`.
- Backend tests: `backend`, `npm test`.
- Frontend verification: `frontend`, `npm run build`.

## Safety Rules

- Do not edit `backend/data`, `backend/uploads`, `.env`, `.env.*`, `node_modules`, or generated build output.
- Do not delete files, reset Git state, force checkout, publish, deploy, push, or create external PRs unless the user explicitly asks.
- If `git status --short` shows unrelated or unclear user changes, do not overwrite them. Either work only in new files or stop with a report.
- Keep each autonomous change small enough to review in one sitting.
- Run the relevant validation before declaring success.
- Record every autonomous run in `automation/reports`.

## Iteration Loop

1. Read `automation/backlog.md`.
2. Inspect the current project state and Git status.
3. Pick one high-signal task that can be completed safely.
4. Make the smallest useful change.
5. Run backend tests and frontend build when relevant.
6. Write an iteration report with changed files, validation results, and next recommended task.

## Definition Of Done

- No secrets are written to the repository.
- Existing user changes are preserved.
- Validation status is clear.
- The report explains exactly what changed and what still needs attention.
