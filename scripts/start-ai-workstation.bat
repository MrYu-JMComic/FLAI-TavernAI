@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0.."
set "NPM_GLOBAL_BIN=%USERPROFILE%\AppData\Roaming\npm"
set "PATH=C:\Program Files\nodejs;%NPM_GLOBAL_BIN%;%PATH%"

if /I "%~1"=="--check" goto check

if not defined MIMO_TOKEN_PLAN_API_KEY (
  echo MIMO_TOKEN_PLAN_API_KEY is not set.
  echo Set your Xiaomi MiMo Token Plan key before starting the AI workstation.
  pause
  exit /b 1
)

echo Starting FLAI TavernAI AI workstation...
start "FLAI OpenCode" cmd /k "cd /d ""%CD%"" && powershell -ExecutionPolicy Bypass -File .\scripts\self-evolve.ps1 -Mode report"
start "FLAI OpenClaw" cmd /k "cd /d ""%CD%"" && openclaw chat"
exit /b 0

:check
if not exist "scripts\check-workstation.ps1" (
  echo scripts\check-workstation.ps1 not found
  exit /b 1
)

if not exist "scripts\self-evolve.ps1" (
  echo scripts\self-evolve.ps1 not found
  exit /b 1
)

if not exist "AGENTS.md" (
  echo AGENTS.md not found
  exit /b 1
)

echo start-ai-workstation.bat check OK
exit /b 0
