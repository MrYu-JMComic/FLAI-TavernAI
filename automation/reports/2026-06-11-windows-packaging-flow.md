# 2026-06-11 Windows packaging flow

## Summary

Added a one-click Windows packaging path that stages the current backend,
frontend, and a Node 24 runtime, then builds a portable Electron EXE locally.

## Changed files

- `package-windows.bat`
- `scripts/package-windows.ps1`
- `packaging/windows/main.js`
- `packaging/windows/package.json`
- `packaging/windows/afterPack.cjs`
- `docs/windows-packaging.md`
- `automation/reports/2026-06-11-windows-packaging-flow.md`

## Validation

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall -SkipElectronInstall -NoPackage`
  passed. This built the frontend into `dist/windows-app/frontend`, staged the
  backend while excluding local data and secrets, downloaded Node 24.16.0 for
  win-x64, and skipped only the final Electron EXE packaging step.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall`
  passed. This produced
  `dist/windows-release/FLAI-TavernAI-Desktop-0.1.0-win-x64.exe`.
- Follow-up package inspection confirmed `backend/node_modules/dotenv`,
  `backend/node_modules/express`, and `shared/sse.js` exist under
  `dist/windows-release/win-unpacked/resources`.
- Packaged backend smoke test passed by starting
  `dist/windows-release/win-unpacked/resources/node/node.exe` against the
  packaged backend and polling `http://127.0.0.1:3399/api/health`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall -KeepBuildScratch`
  passed after desktop polish. Package inspection confirmed
  `backend/node_modules/dotenv` and `shared/sse.js` under
  `dist/windows-exe/win-unpacked/resources`, and the packaged backend health
  check passed on `http://127.0.0.1:3401/api/health`.
- Final default `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall`
  passed and left only `dist/windows-exe/FLAI-TavernAI.exe` in the output
  directory.
- `node scripts/check-encoding.mjs` passed.
- `npm test` in `backend` passed with 940 tests.
- `npm run build` in `frontend` passed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed.

## Notes

- Existing dirty frontend and backend source files were not edited.
- The packaging script excludes `.env`, `backend/data`, `backend/uploads`, logs,
  and backend tests from staged package resources.
- Runtime data is kept under `%APPDATA%\flai-tavernai-windows-desktop` so the
  output folder stays clean.
- Follow-up fix: packaged backend dependencies and `shared` runtime helpers are
  included so the backend can resolve `dotenv` and shared imports after launch.
- Follow-up polish: the desktop wrapper now hides the Electron menu, shows a
  startup window, uses the app icon, displays backend failures in an app-styled
  error window, stores runtime data under roaming app data, and cleans
  electron-builder scratch output so the release folder can contain one EXE.
- Second polish pass: the generated artifact is now
  `dist/windows-exe/FLAI-TavernAI.exe`; default packaging removes
  `dist/windows-app`, `win-unpacked`, `.icon-ico`, and builder debug files.

## Next recommended task

Run the full packaging command on a Windows release machine and smoke-test the
generated EXE with a fresh data directory.
