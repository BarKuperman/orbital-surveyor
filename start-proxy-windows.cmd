@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

node proxy.js
echo.
echo Proxy stopped.
pause
