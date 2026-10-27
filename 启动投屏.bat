@echo off
chcp 65001 >nul
title 王者BP助手 - 手机投屏
set ADB=D:\scrcpy\adb.exe
set SCRCPY=D:\scrcpy\scrcpy.exe

echo ============================================
echo   王者BP助手 · 手机投屏启动器
echo ============================================
echo.

if not exist "%ADB%" (
  echo [X] 未找到 %ADB%
  echo     请先确认 scrcpy 已安装到 D:\scrcpy
  goto end
)

echo [1] 检测已连接设备...
"%ADB%" devices
echo.

echo [2] 连接方式选择：
echo     A. USB 数据线（推荐，延迟最低）
echo     B. 无线 WiFi（需先 USB 配对一次）
echo.
set /p MODE="请输入 A 或 B（直接回车默认 A）："
if /i "%MODE%"=="B" goto wireless

:usb
echo.
echo [3] 启动投屏（USB）...
echo     提示：手机需已开启「USB 调试」并允许授权
"%SCRCPY%" --no-audio --max-size=1920 --stay-awake
goto end

:wireless
echo.
echo [3] 无线投屏准备：
echo     1) 先用 USB 连上手机（确保 adb devices 能看到设备）
echo     2) 本脚本会执行 adb tcpip 5555，然后可拔掉数据线
echo.
pause
for /f "skip=1 tokens=1" %%d in ('"%ADB%" devices') do (
  if not "%%d"=="" (
    echo     切换到无线模式: %%d
    "%ADB%" -s %%d tcpip 5555
    timeout /t 2 >nul
    echo     请拔掉数据线，然后按任意键继续（手机和电脑需同一 WiFi）
    pause
    goto :wireless_connect
  )
)
:wireless_connect
set /p IP="请输入手机的 WiFi IP（如 192.168.1.100）："
"%ADB%" connect %IP%:5555
timeout /t 2 >nul
echo.
echo [4] 启动投屏（无线）...
"%SCRCPY%" --no-audio --max-size=1920 --stay-awake

:end
echo.
echo 投屏已结束。
pause
