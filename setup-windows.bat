@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo Strata Procurement OS - Windows setup
echo ==========================================

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found.
  echo Install Docker Desktop, start it, then run this file again.
  echo Alternatively, install PostgreSQL 16 locally and create database app_db.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is installed but is not running. Start Docker Desktop and retry.
  pause
  exit /b 1
)

echo [1/4] Starting PostgreSQL...
docker compose up -d
if errorlevel 1 goto :error

echo [2/4] Installing Node.js dependencies...
call npm install
if errorlevel 1 goto :error

echo [3/4] Creating/updating database tables...
call npx drizzle-kit push
if errorlevel 1 goto :error

echo [4/4] Setup complete.
echo Start the application with: npm run dev
echo Then open http://localhost:3000
pause
exit /b 0

:error
echo Setup failed. Read the error above, fix it, and run this file again.
pause
exit /b 1
