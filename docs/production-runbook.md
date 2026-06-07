# Production Startup And SQLite Backup Runbook

This runbook covers a local or LAN deployment of FLAI Tavern AI. The app stores its durable state on the local filesystem, so startup and backup procedures should protect `backend/data` and `backend/uploads`.

## Scope

- Backend: Express service in `backend`, started with `npm.cmd run start`.
- Frontend: static Vite build in `frontend/dist`, built with `npm.cmd run build`.
- Database: SQLite file at `backend/data/flai.sqlite`.
- Uploads: avatar assets under `backend/uploads`.

Do not commit `.env`, `backend/data`, `backend/uploads`, build output, logs, or backup files.

## First-Time Setup

1. Install Node.js 24 or newer. The backend uses the built-in `node:sqlite` module.
2. Install dependencies separately:

```powershell
cd backend
npm.cmd ci

cd ..\frontend
npm.cmd ci
```

3. Create `backend\.env` from `backend\.env.example`.
4. Set a long random `APP_SECRET` before storing real provider API keys.
5. Set `CLIENT_ORIGIN` to the exact frontend origin or origins that will access the backend.

Example `backend\.env`:

```dotenv
PORT=3001
CLIENT_ORIGIN=http://127.0.0.1:4173,http://localhost:4173
ALLOW_PRIVATE_NETWORK_ORIGINS=true
APP_SECRET=replace-with-a-long-random-secret
```

Changing `APP_SECRET` after provider keys are saved can make encrypted API keys unreadable. Keep a copy of the secret outside the repository.

## Startup

Build the frontend:

```powershell
cd frontend
npm.cmd run build
```

Start the backend:

```powershell
cd ..\backend
npm.cmd run start
```

Verify the backend health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

Serve `frontend\dist` with your chosen local static server or reverse proxy. For a local smoke test, Vite preview is available:

```powershell
cd frontend
npm.cmd run preview -- --host 0.0.0.0 --port 4173
```

The frontend origin used in the browser must be included in `CLIENT_ORIGIN`, or authenticated API calls will be blocked by CORS.

## Normal Shutdown

Stop the backend with `Ctrl+C` or send `SIGTERM` from your process manager. The backend performs a SQLite WAL checkpoint and closes the database during graceful shutdown.

Avoid killing the process while a backup, upload, or long write operation is in progress. If a force stop is unavoidable, make a fresh backup after the next successful startup.

## Automatic Backups

On backend startup, the app schedules a daily backup. Backups are written to:

```text
backend/data/backups/
```

The backup service keeps the latest 7 daily `.sqlite` backups and copies companion `-wal` and `-shm` files when they exist.

Root admin users can also trigger and list backups through the admin backup API:

- `POST /api/admin/backup`
- `GET /api/admin/backups`

These endpoints require an authenticated root admin session and the app's CSRF protection.

## Manual Backup

For the safest manual backup, stop the backend first so SQLite can checkpoint WAL data:

```powershell
# Stop backend process first.
New-Item -ItemType Directory -Force backend\data\manual-backups
Copy-Item backend\data\flai.sqlite backend\data\manual-backups\flai-YYYY-MM-DD.sqlite
```

If you must copy while the backend is running, copy the main database file and any live WAL/SHM companions together:

```powershell
New-Item -ItemType Directory -Force backend\data\manual-backups
Copy-Item backend\data\flai.sqlite backend\data\manual-backups\flai-YYYY-MM-DD.sqlite
Copy-Item backend\data\flai.sqlite-wal backend\data\manual-backups\flai-YYYY-MM-DD.sqlite-wal -ErrorAction SilentlyContinue
Copy-Item backend\data\flai.sqlite-shm backend\data\manual-backups\flai-YYYY-MM-DD.sqlite-shm -ErrorAction SilentlyContinue
```

Also back up uploads when user or character avatars matter:

```powershell
Compress-Archive -Path backend\uploads -DestinationPath backend\data\manual-backups\uploads-YYYY-MM-DD.zip -Force
```

## Restore

1. Stop the backend.
2. Copy the current `backend\data` directory somewhere safe before replacing anything.
3. Replace `backend\data\flai.sqlite` with the chosen backup.
4. If the backup includes `-wal` and `-shm` files, restore them beside the main database with matching names:

```powershell
Copy-Item backend\data\backups\flai-YYYY-MM-DD.sqlite backend\data\flai.sqlite -Force
Copy-Item backend\data\backups\flai-YYYY-MM-DD.sqlite-wal backend\data\flai.sqlite-wal -Force -ErrorAction SilentlyContinue
Copy-Item backend\data\backups\flai-YYYY-MM-DD.sqlite-shm backend\data\flai.sqlite-shm -Force -ErrorAction SilentlyContinue
```

5. Restore `backend\uploads` if the backup includes uploaded assets.
6. Start the backend and verify `/api/health`.
7. Log in and check a conversation, a character, and provider settings before deleting the pre-restore copy.

## Operational Checks

- Keep `backend\.env`, `backend\data`, and `backend\uploads` outside git.
- Confirm free disk space before large imports, image uploads, or backup jobs.
- Keep `APP_SECRET` consistent across restarts and restores.
- Run `node scripts/check-encoding.mjs` before committing documentation or source changes.
- Run `powershell -ExecutionPolicy Bypass -File scripts\review-gate.ps1` before merging autonomous changes.
