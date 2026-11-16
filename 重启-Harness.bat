@echo off
setlocal
REM ---- force GBK codepage so Chinese text in this file never gets misparsed ----
chcp 936 >nul
title DeepSeek Harness - 重启
cd /d "%~dp0"

set "PORT=3080"

echo ==============================================
echo   DeepSeek Harness 正在重启...
echo ==============================================

REM ---- 桌面壳托管服务时由壳自己管理重启，脚本代杀会跟壳的自动重启抢端口 ----
tasklist | findstr /i "OrcaMind.exe" >nul 2>nul
if not errorlevel 1 (
    echo [提示] OrcaMind 桌面壳正在运行：请直接退出壳再重新打开（壳会自己重启服务），
    echo        本脚本不代杀，避免抢占端口。
    pause
    exit /b 0
)

REM ---- 第一步：结束正在运行的 Harness 进程 ----
netstat -ano | findstr LISTENING | findstr /c:":%PORT% " >nul 2>nul
if errorlevel 1 (
    echo [提示] 未检测到正在运行的 Harness，将直接启动。
    goto relaunch
)

echo [提示] 正在停止 Harness ...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr LISTENING ^| findstr /c:":%PORT% "') do (
    echo   已结束进程 PID=%%P
    taskkill /f /t /pid %%P >nul 2>nul
)

REM ---- 第二步：等待端口释放（最多 10 秒）----
set /a WAIT=0
:wait_port
netstat -ano | findstr LISTENING | findstr /c:":%PORT% " >nul 2>nul
if errorlevel 1 goto relaunch
set /a WAIT+=1
if %WAIT% geq 10 (
    echo [错误] 端口 %PORT% 仍被占用，请手动检查后重试。
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_port

:relaunch
REM ---- 第三步：重新启动（复用启动脚本）----
call "%~dp0启动-Harness.bat"
