@echo off
REM ---- force UTF-8 codepage so Chinese text in this file never gets misparsed ----
chcp 65001 >nul
REM ---- use bundled Node.js/npm/pnpm from Dependency ----
set "PATH=%~dp0Dependency\nodejs;%PATH%"
title OrcaMind (开发模式)
cd /d "%~dp0"

echo ========================================================
echo   OrcaMind 桌面端 - 源码开发调试模式
echo   提示：此模式直接读取 desktop/ 源码，改动即时生效！
echo   支持在主窗口右键使用【检查元素】与控制台即时日志
echo ========================================================

REM ---- 检查开发依赖环境 ----
if not exist "desktop\node_modules\electron\dist\electron.exe" (
    echo [提示] 桌面端开发依赖未安装，首次启动将自动安装...
    cd desktop
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络或重试。
        pause
        exit /b 1
    )
    cd ..
)

echo [启动] 正在以源码模式拉起 OrcaMind...
"desktop\node_modules\electron\dist\electron.exe" "desktop"