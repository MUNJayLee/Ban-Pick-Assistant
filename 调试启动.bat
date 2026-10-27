@echo off
cd /d "%~dp0"
title WangZhe BP Assistant v3.0 - DEBUG MODE

echo ============================================================
echo   WangZhe BP Assistant v3.0  [DEBUG MODE]
echo   Web Console : http://localhost:5173/
echo   API Docs    : http://127.0.0.1:8900/docs
echo ============================================================
echo.
echo DEBUG mode shows API logs (recognition / settlement / errors).
echo Keep this window open while testing.
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Please install Python 3.11+
  pause
  exit /b 1
)

echo [1/3] Starting API server (with console log) on port 8900 ...
start "BP-API-DEBUG" cmd /k python scripts\api_server.py --port 8900
ping -n 6 127.0.0.1 >nul

echo [2/3] Starting web dev server on port 5173 ...
start "BP-Web" /min node scripts\dev-safe.mjs
ping -n 8 127.0.0.1 >nul

echo [3/3] Opening web UI ...
start http://localhost:5173/

echo.
echo All started (DEBUG).
echo   - API log window : "BP-API-DEBUG" (do NOT close while testing)
echo   - Web UI         : http://localhost:5173/
echo   - API Docs       : http://127.0.0.1:8900/docs
echo.
pause
