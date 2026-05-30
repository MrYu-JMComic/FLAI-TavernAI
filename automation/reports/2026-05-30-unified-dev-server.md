# 2026-05-30 Unified Dev Server

## Objective

Eliminate the need to run separate frontend and backend dev servers. A single `start-dev` command should launch both Vite (frontend) and Express (backend) together.

## Changed Files

- `README.md`
- `frontend/vite.config.js`
- `scripts/start-dev.ps1`

## Validation Results

| Check | Result |
|---|---|
| `node scripts/check-encoding.mjs` | passed |
| `frontend` `npm run build` | passed (existing large chunk warning) |
| Backend health `http://127.0.0.1:3001/api/health` | ok |
| Frontend `http://127.0.0.1:5173` | 200 |
| Frontend proxy `/api/health` | ok |
| `strictPort` test (port 5173 occupied) | failed as expected |

## Canonical URLs

- Backend: `http://127.0.0.1:3001`
- Frontend: `http://127.0.0.1:5173`
