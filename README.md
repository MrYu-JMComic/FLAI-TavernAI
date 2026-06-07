# FLAI Tavern AI

FLAI Tavern AI is a local full-stack Tavern-style roleplay chat app with Vue + Vite on the frontend and Express on the backend.

## Features

- Local account registration/login with HttpOnly cookie sessions.
- SQLite persistence for users, provider settings, characters, regex rules, conversations, and messages.
- Server-side encrypted AI API keys.
- OpenAI-compatible provider presets for DeepSeek, OpenAI, Gemini, and custom gateways.
- Streaming chat with normalized `meta`, `reasoning`, `content`, `usage`, `done`, and `error` events.
- Native model reasoning/thought display when the provider returns it.
- Character creation/editing with avatar upload, persona fields, opening message, tags, and ordered regex replacement rules.
- Warm light/dark UI with dynamically loaded single-page views.

## Requirements

- Node.js 24 or newer is recommended because the backend uses the built-in experimental `node:sqlite` module.
- No extra database service is required.

## Quick Start

Set a strong `APP_SECRET` in `backend/.env` before saving real API keys (copy `backend/.env.example` if the file does not exist).

Start both servers with one command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1
```

| Service | URL |
|---|---|
| Frontend dev | `http://127.0.0.1:5173/#/` |
| Backend health | `http://127.0.0.1:3001/api/health` |

Vite is configured with `strictPort` so port 5173 is the only frontend dev port. If 5173 is occupied Vite will fail instead of silently falling back to another port.

## Data

- SQLite database: `backend/data/flai.sqlite`
- Uploaded avatars: `backend/uploads/avatars`
- Both are ignored by git.
- Production startup, backup, and restore steps are documented in `docs/production-runbook.md`.

## Tests

```bash
cd backend
npm test

cd ../frontend
npm run build
```

## Repository Hygiene

Before committing, use the guarded preparation script instead of a broad `git add -A`:

```powershell
.\scripts\prepare-commit.ps1
.\scripts\prepare-commit.ps1 -Stage -Path README.md,scripts\prepare-commit.ps1
.\scripts\prepare-commit.ps1 -Stage -AllAllowed -IncludeUntracked
```

The dry run checks UTF-8 encoding and shows the worktree, including ignored local files. The staging mode blocks local data, uploads, env files, build output, logs, dependency folders, generated prompt drafts, and common temporary files. Prefer `-Path` for reviewed files; reserve `-AllAllowed` for fully reviewed worktrees.

## AI Workstation

This repo includes a guarded autonomous iteration setup:

```powershell
.\scripts\check-workstation.ps1
.\scripts\self-evolve.ps1 -Mode report
.\scripts\self-evolve.ps1 -Mode iterate
.\scripts\start-ai-workstation.bat
```

Read `AGENTS.md` and `automation/backlog.md` before allowing autonomous code changes. Reports are written to `automation/reports`. Markdown storage rules are documented in `docs/markdown-organization.md`.
