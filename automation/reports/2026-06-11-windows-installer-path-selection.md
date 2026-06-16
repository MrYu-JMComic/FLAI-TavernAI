# 2026-06-11 Windows installer path selection

## Summary

Changed the default Windows setup package from a silent one-click installer to a
setup wizard that allows choosing the install directory.

## Changed files

- `packaging/windows/package.json`
- `docs/windows-packaging.md`
- `automation/reports/2026-06-11-windows-installer-path-selection.md`

## Changes

- Set NSIS `oneClick` to `false` so the installer opens an installation wizard.
- Enabled `allowToChangeInstallationDirectory` so the user can choose the app
  install folder.
- Re-enabled elevation support for protected install locations.
- Documented the default install location and separated it from runtime data in
  `%APPDATA%\flai-tavernai-windows-desktop`.

## Validation

- JSON parse check for `packaging/windows/package.json` passed.
- `node scripts/check-encoding.mjs` passed.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -SkipNpmInstall -SkipElectronInstall`
  passed and produced `dist/windows-exe/FLAI-TavernAI-Setup.exe`.
- Packaging output confirmed `oneClick=false` for the NSIS build.
- Output inspection confirmed `dist/windows-exe` contained only
  `FLAI-TavernAI-Setup.exe`, and `dist/windows-app` was removed.
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` passed
  with backend tests at 940 passing and the frontend build passing.

## Notes

- Existing dirty backend and frontend source files were not edited.
- The portable EXE remains available through `scripts/package-windows.ps1
  -Portable`.
