@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found. Start PostgreSQL locally, then run npm run dev.
  pause
  exit /b 1
)
docker compose up -d
if errorlevel 1 exit /b 1
call npm run dev
