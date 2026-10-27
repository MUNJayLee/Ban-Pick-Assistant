@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 王者BP助手 - 实战识别（自动检测BP）
echo ============================================
echo   王者BP助手 · 实战识别
echo ============================================
echo   自动检测 BP 界面 → 识别 ban 位 → 采集样本
echo   打游戏时保持本窗口开着即可，Ctrl+C 退出
echo ============================================
echo.
python scripts\live_recognize.py
echo.
echo 识别已停止。
pause
