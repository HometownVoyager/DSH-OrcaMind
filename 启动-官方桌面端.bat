@echo off
REM ---- use bundled Node.js/npm/pnpm from Dependency ----
set "PATH=%~dp0Dependency\nodejs;%PATH%"
title DeepSeek Harness Desktop
cd /d "%~dp0source\apps\desktop"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] pnpm not found. npm i -g pnpm
    pause
    exit /b 1
)

REM ---- Electron binary (download once, via npmmirror for CN network) ----
if not exist "node_modules\electron\dist\electron.exe" (
    echo [hint] Downloading Electron via npmmirror...
    set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
    call node node_modules\electron\install.js
    if errorlevel 1 (
        echo [ERROR] Electron download failed.
        pause
        exit /b 1
    )
)

REM ---- build if lib missing ----
if not exist "lib\main.js" (
    echo [hint] Building desktop shell...
    call pnpm run build
    if errorlevel 1 (
        echo [ERROR] build failed. See desktop-build.log
        pause
        exit /b 1
    )
)

REM ---- dev mode: uses the SOURCE runtime, so the local session patch and
REM      pi-ai catalog fixes (opencode-go etc.) all apply. The PACKAGED app
REM      would bundle its own runtime WITHOUT those local patches. ----
REM ---- dev.ts defaults to a throwaway DSH_HOME under .desktop-build; point
REM      it back at the real home so profiles/credentials/presets are shared ----
set "DSH_HOME=%USERPROFILE%\.dsh"
echo [hint] Starting desktop (dev mode, source runtime, DSH_HOME=%DSH_HOME%)...
call pnpm start
pause
