@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 王者BP助手 v3.0

echo ============================================================
echo   王者BP助手 v3.0  一键启动
echo   前端: http://localhost:5173/console
echo   API : http://127.0.0.1:8900/docs
echo ============================================================
echo.

REM 检查 Python
where python >nul 2>nul
if errorlevel 1 (
  echo [X] 未找到 Python，请先安装 Python 3.11+
  pause
  exit /b 1
)

echo [1/3] 启动 API 服务（端口 8900）...
start "BP-API" /min pythonw scripts\api_server.py --port 8900
timeout /t 4 >nul

echo [2/3] 启动前端开发服务器（端口 5173）...
start "BP-Web" /min node scripts\dev-safe.mjs
timeout /t 6 >nul

echo [3/3] 打开控制台...
start http://localhost:5173/console

echo.
echo 已启动：
echo   - 控制台页面（自动打开）
echo   - API 文档: http://127.0.0.1:8900/docs
echo.
echo 关闭本窗口不会停止服务；需要停止请在任务管理器结束 python/node
echo.
pause
