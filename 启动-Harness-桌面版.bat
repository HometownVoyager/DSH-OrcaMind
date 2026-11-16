@echo off
chcp 65001 >nul
REM ---- use bundled Node.js/npm/pnpm from Dependency ----
set "PATH=%~dp0Dependency\nodejs;%PATH%"
title OrcaMind
cd /d "%~dp0"

REM ---- 优先使用已打包好的便携版（无版本号文件名）----
set "EXE=desktop\dist\OrcaMind.exe"
if exist "%EXE%" (
    start "" "%EXE%"
    exit /b 0
)
REM ---- 兼容旧的带版本号产物 ----
set "EXE=desktop\dist\OrcaMind-1.0.0.exe"
if exist "%EXE%" (
    start "" "%EXE%"
    exit /b 0
)

REM ---- 开发模式（未打包）：首次自动安装 Electron ----
if not exist "desktop\node_modules\electron\dist\electron.exe" (
    echo [提示] 开发依赖未安装，首次启动将自动安装（GitHub 失败时走 npmmirror 镜像）...
    cd desktop
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请重试。
        pause
        exit /b 1
    )
    cd ..
)
start "" "desktop\node_modules\electron\dist\electron.exe" "desktop"