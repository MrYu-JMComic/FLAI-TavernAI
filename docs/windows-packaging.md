# Windows Packaging

This project can build a local Windows desktop EXE without changing the normal
backend/frontend development flow. The package uses a small Electron shell to
  open the app, starts the existing Express backend as a child process, serves the
Vite build from a local loopback server, and proxies `/api` plus `/uploads` to
the backend. The packaged app hides the Electron menu, shows a small startup
window, and produces a setup installer by default so normal launches do not pay
the portable EXE self-extract cost.

## Prerequisites

- Windows 10 or Windows 11.
- Node.js 24 or newer available as `node` and `npm`.
- Internet access on the first packaging run so npm can install Electron tools
  and the script can download the latest Node 24 Windows runtime.

## One-click build

Double-click:

```bat
package-windows.bat
```

Or run the same flow from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

The EXE is written to:

```text
dist/windows-exe/
```

The default artifact is a setup installer:

```text
FLAI-TavernAI-Setup.exe
```

Run it once, choose the install folder in the setup wizard, then launch FLAI
TavernAI from the Start menu or desktop shortcut. This is faster than the
portable EXE because Electron does not need to self-extract on every launch.

## Useful options

Build an ARM64 package:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -Arch arm64
```

Use an exact Node runtime version instead of resolving the latest Node 24
release from nodejs.org:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -NodeVersion 24.11.1
```

Stage the backend, frontend, and Node runtime without producing the EXE:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -NoPackage
```

Build the slower single-file portable EXE instead of the installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -Portable
```

Keep electron-builder's unpacked scratch directory for packaging diagnostics:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -KeepBuildScratch
```

Skip dependency installation when `backend/node_modules`,
`frontend/node_modules`, and `packaging/windows/node_modules` already exist:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall -SkipElectronInstall
```

## What the script does

1. Verifies that the local build Node is version 24 or newer.
2. Runs `npm ci` in `backend` and `frontend` unless skipped.
3. Builds the Vue frontend into ignored staging under `dist/windows-app`.
4. Copies backend runtime source plus dependencies into staging, excluding
   `.env`, `backend/data`, `backend/uploads`, logs, and backend tests.
5. Copies the repository `shared` runtime helpers used by the backend.
6. Downloads and stages a Node 24 Windows runtime so the packaged backend can
   use `node:sqlite` without relying on the user's global Node install.
7. Installs Electron packaging tools under `packaging/windows/node_modules`
   without writing a package lock.
8. Uses an electron-builder `afterPack` hook to copy backend `node_modules`
   into the package resources before the installer is assembled.
9. Runs electron-builder to create the Windows installer, or a portable EXE when
   `-Portable` is supplied.
10. Removes staging and electron-builder scratch output, leaving only the EXE
    in `dist/windows-exe` unless `-KeepBuildScratch` is supplied.

## Runtime data

The desktop app stores runtime data in the user's roaming app-data folder:

```text
%APPDATA%\flai-tavernai-windows-desktop\
```

Inside that folder, the backend keeps its SQLite database, uploads, generated
app secret, and backend logs. The package output folder stays clean and can be
shared as a single EXE.

The installer defaults to the current user's local programs folder, usually:

```text
%LOCALAPPDATA%\Programs\FLAI TavernAI\
```

The setup wizard lets you choose a different install folder. Runtime data still
stays in `%APPDATA%\flai-tavernai-windows-desktop\` so app upgrades do not wipe
local conversations or uploads.

## Notes

- The package intentionally keeps the backend and frontend as separate local
  services, matching the existing `PORT` and `CLIENT_ORIGIN` startup model.
- The frontend is built with a relative API base. The desktop shell serves the
  frontend on loopback and proxies API traffic to the private backend port.
- The backend defaults to port `3001` when available and falls back to a random
  loopback port if it is already in use.
- Electron and electron-builder are installed with `latest` for this local
  packaging helper. Pin those versions in `packaging/windows/package.json` if
  you need repeatable release builds.
- The portable target is kept for sharing a single file, but it starts slower on
  Windows because the runtime is unpacked into a temporary directory before the
  app can show its window.
