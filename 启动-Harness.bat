@echo off
REM ---- use bundled Node.js/npm/pnpm from Dependency ----
set "PATH=%~dp0Dependency\nodejs;%PATH%"
setlocal
REM ---- force GBK codepage so Chinese text in this file never gets misparsed ----
chcp 936 >nul
title DeepSeek Harness
cd /d "%~dp0"

set "URL=http://127.0.0.1:3080"
set "PORT=3080"

REM ---- check node ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

REM ---- 已在监听就只开浏览器 ----
netstat -ano | findstr LISTENING | findstr /c:":%PORT% " >nul 2>nul
if not errorlevel 1 (
    echo [hint] Harness already running, opening browser...
    start "" "%URL%"
    exit /b 0
)

echo ==============================================
echo   DeepSeek Harness starting...
echo   URL: %URL%
echo   Ctrl+C 停止服务
echo ==============================================

REM ---- 3 秒后自动开浏览器 ----
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process '%URL%'"

REM ---- 固定入口：与 OrcaMind 壳共用；源码版/npm 版的判断与依赖补装都在 serve-harness.mjs 里 ----
node "serve-harness.mjs" --port %PORT%
pause
