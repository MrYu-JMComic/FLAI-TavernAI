# 2026-06-11 Windows packaging optimization

## Summary

Optimized the Windows packaging flow after local packaged-app testing showed the
portable EXE was slow to present a window and could make repeated launches feel
like a failed startup.

## Changed files

- `scripts/package-windows.ps1`
- `packaging/windows/package.json`
- `packaging/windows/main.js`
- `docs/windows-packaging.md`
- `automation/reports/2026-06-11-windows-packaging-optimization.md`

## Changes

- Changed the default packaging target from portable EXE to a one-click NSIS
  installer named `FLAI-TavernAI-Setup.exe`.
- Kept the portable EXE path available through `scripts/package-windows.ps1
  -Portable`, producing `FLAI-TavernAI-Portable.exe`.
- Focused the currently visible desktop window when a second app instance is
  launched, including the startup splash and error windows.
- Set the Windows app user model id so the installed app groups more cleanly in
  the taskbar.
- Updated the packaging docs to explain the startup tradeoff between installer
  and portable builds.

## Validation

- `node --check packaging/windows/main.js` passed.
- PowerShell parser check for `scripts/package-windows.ps1` passed.
- `node scripts/check-encoding.mjs` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall -SkipElectronInstall`
  passed and produced `dist/windows-exe/FLAI-TavernAI-Setup.exe`.
- Output inspection confirmed `dist/windows-exe` contained only
  `FLAI-TavernAI-Setup.exe` after the default packaging run, and
  `dist/windows-app` was removed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed
  with backend tests at 940 passing and the frontend build passing.

## Notes

- Existing dirty backend and frontend source files were not edited.
- Runtime data remains under `%APPDATA%\flai-tavernai-windows-desktop`.
