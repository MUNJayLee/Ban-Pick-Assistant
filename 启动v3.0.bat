@echo off
cd /d "%~dp0"
title WangZhe BP Assistant v3.0

echo ============================================================
echo   WangZhe BP Assistant v3.0
echo   Web Console : http://localhost:5173/console
echo   API Docs    : http://127.0.0.1:8900/docs
echo ============================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Please install Python 3.11+
  pause
  exit /b 1
)

echo [1/3] Starting API server on port 8900 ...
start "BP-API" /min pythonw scripts\api_server.py --port 8900
ping -n 6 127.0.0.1 >nul

echo [2/3] Starting web dev server on port 5173 ...
start "BP-Web" /min node scripts\dev-safe.mjs
ping -n 8 127.0.0.1 >nul

echo [3/3] Opening console page ...
start http://localhost:5173/console

echo.
echo All started.
echo   - Console : http://localhost:5173/console
echo   - API Docs: http://127.0.0.1:8900/docs
echo.
echo Closing this window will NOT stop the services.
pause
