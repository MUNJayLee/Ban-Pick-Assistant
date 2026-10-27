@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" pythonw scripts\adb_console.py
exit
