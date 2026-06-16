@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-windows.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Windows packaging failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
