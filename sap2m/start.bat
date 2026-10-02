@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title SAP2 - Simba TECHub
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer.
  echo The download page will open. Install the LTS version, then double-click start.bat again.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing SAP2 for the first time, please wait...
  call npm install
  if errorlevel 1 (
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist .env (
  echo.
  echo ===== First-time setup =====
  echo In Neon: open project sap2, click Connect, and copy the POOLED connection string.
  echo It starts with postgresql://
  set /p DB=Paste it here and press Enter: 
  (
    echo DATABASE_URL=!DB!
    echo PORT=3000
  ) > .env
  echo Saved.
)
echo.
echo Starting SAP2. Your browser will open in a few seconds.
echo Keep this window open while you use the app. Close it to stop.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
pause
