@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\AppData\Roaming\npm;%PATH%"

echo Starting FLAI TavernAI for LAN access...
echo Frontend will listen on 0.0.0.0:5173.
echo Backend will listen on 3001.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"

echo.
echo Launcher finished. Keep the Backend and Frontend windows open to keep the app running.