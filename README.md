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

Install dependencies in each app if needed:

```bash
cd frontend
npm install

cd ../backend
npm install
```

Create backend environment settings:

```bash
cd backend
copy .env.example .env
```

Set a strong `APP_SECRET` in `backend/.env` before saving real API keys.

Start the backend:

```bash
cd backend
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

The frontend runs on `http://127.0.0.1:5173` and proxies `/api` requests to the backend on `http://localhost:3001`.

## Data

- SQLite database: `backend/data/flai.sqlite`
- Uploaded avatars: `backend/uploads/avatars`
- Both are ignored by git.

## Tests

```bash
cd backend
npm test

cd ../frontend
npm run build
```

## AI Workstation

This repo includes a guarded autonomous iteration setup:

```powershell
.\scripts\check-workstation.ps1
.\scripts\self-evolve.ps1 -Mode report
.\scripts\self-evolve.ps1 -Mode iterate
.\scripts\start-ai-workstation.bat
```

Read `AGENTS.md` and `automation/backlog.md` before allowing autonomous code changes. Reports are written to `automation/reports`.
