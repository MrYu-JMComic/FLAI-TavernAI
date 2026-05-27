# FLAI TavernAI Autonomous Iteration Guide

This project may be maintained by AI agents. Follow these rules before changing code.

## Governance — 三省六部制

See `governance.md` for the full framework.

### 三权分立

| 省 | 执掌 | 职责 |
|---|---|---|
| 中书省 | 乐（人） | 立项、规划、写 backlog |
| 门下省 | 自动化 | 跑测试、生成报告、pass/fail |
| 尚书省 | OpenCode / Claude Code | 写代码、改文件 |

### 核心规则

- **中书省未立项** → 尚书省不可行动
- **门下省未审核** → 变更不可合并
- **任何人不得兼任中书省和门下省**
- 门下省审核命令: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

### Encoding Rules

- All source and Markdown files must be UTF-8. Do not save files with GBK, ANSI, or PowerShell's default legacy encoding.
- On Windows, prefer Node `fs.readFileSync/writeFileSync(..., 'utf8')`, editor UTF-8 mode, or PowerShell `Set-Content -Encoding utf8` when writing files.
- Never paste mojibake or replacement-character text into source files.
- Run `node scripts/check-encoding.mjs` before reporting that a code change is complete.

## Mission

Improve FLAI TavernAI in small, verified iterations. Prefer fixes and product polish that make the app more reliable, easier to use, and easier to maintain.

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
