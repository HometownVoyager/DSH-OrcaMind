@echo off
setlocal
REM ============================================================
REM  update-harness.bat - self-update DeepSeek Harness from GitHub
REM  Pure ASCII on purpose: no chcp, no codepage dependency, and
REM  safe to edit with any editor or tool regardless of encoding.
REM ============================================================
set "PATH=%~dp0Dependency\nodejs;%PATH%"
title Update DeepSeek Harness
cd /d "%~dp0"

set "SRC=source"
set "PORT=3080"
set "REPO=deepseek-ai/deepseek-harness"
set "M1=https://ghfast.top/https://github.com/%REPO%.git"
set "M2=https://gh-proxy.com/https://github.com/%REPO%.git"
set "M3=https://ghproxy.net/https://github.com/%REPO%.git"
set "M4=https://github.com/%REPO%.git"
set "STASH_MSG=update-harness auto-stash"
REM conflict-recovery wait loop: RESUME_MAX polls x ~3s each (600 = 30 min)
set "RESUME_MAX=600"

REM ================= tool checks =================
where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] git not found. Install Git for Windows first.
    pause
    exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] node not found. Make sure Dependency\nodejs exists or install Node.js.
    pause
    exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [INFO] pnpm not found, installing pnpm@11.7.0 ...
    call npm install -g pnpm@11.7.0
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm.
        pause
        exit /b 1
    )
)

REM ================= running-instance check =================
REM A running instance never hot-reloads a new build ("updated but nothing
REM changed"), and Windows file locks can break install/build mid-run.
netstat -ano | findstr LISTENING | findstr /c:":%PORT% " >nul 2>nul
if errorlevel 1 goto READY

echo [INFO] Harness is currently running on port %PORT%.
tasklist | findstr /i "OrcaMind.exe" >nul 2>nul
if not errorlevel 1 (
    echo [ERROR] The OrcaMind desktop shell is running. It hosts the service and
    echo        would restart the OLD build 1-2 minutes after its child is killed.
    echo        Quit the shell completely (including the tray icon), then re-run.
    pause
    exit /b 1
)
choice /c YN /m "Stop the running Harness and continue the update (N = exit)"
if errorlevel 2 (
    echo [INFO] Cancelled. Stop the service yourself, then re-run this script.
    pause
    exit /b 1
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr LISTENING ^| findstr /c:":%PORT% "') do (
    echo   Stopping process PID=%%P
    taskkill /f /t /pid %%P >nul 2>nul
)
set "KILLED=1"
set /a WAIT=0
:WAIT_PORT
netstat -ano | findstr LISTENING | findstr /c:":%PORT% " >nul 2>nul
if errorlevel 1 goto READY
set /a WAIT+=1
if %WAIT% geq 10 (
    echo [ERROR] Port %PORT% was not released. Check manually and retry.
    pause
    exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto WAIT_PORT

:READY
if not exist "%SRC%\.git" goto CLONE

REM ================= leftover-state precheck (self-healing) =================
REM Never fetch/reset/build while unmerged (UU) files exist: the "already
REM latest" path would otherwise build a tree full of conflict markers
REM (same root cause as the 2026-10-26 incident).
git -C "%SRC%" diff --name-only --diff-filter=U 2>nul | findstr . >nul 2>nul
if errorlevel 1 goto CHECK_ORPHAN_STASH
echo [WARN] Unmerged (UU) files from a previous run detected. Entering recovery.
goto RESUME_START

:CHECK_ORPHAN_STASH
REM Clean tree but an auto-stash is left over: the previous run was
REM interrupted between "stash push" and "stash pop". Restore it now.
git -C "%SRC%" stash list 2>nul | findstr /c:"%STASH_MSG%" >nul 2>nul
if errorlevel 1 goto NO_LEFTOVER
git -C "%SRC%" status --porcelain -uno 2>nul | findstr . >nul 2>nul
if errorlevel 1 goto ORPHAN_STASH
:NO_LEFTOVER

REM rerere: identical conflict shapes are auto-resolved once solved by hand.
git -C "%SRC%" config rerere.enabled true >nul 2>nul
goto PULL_PHASE

:ORPHAN_STASH
echo [INFO] Clean tree with a leftover auto-stash; re-applying it ...
git -C "%SRC%" stash pop >nul 2>nul
if errorlevel 1 (
    echo [WARN] The stash no longer applies cleanly. Entering recovery.
    goto RESUME_START
)
echo [OK] Local changes restored.
goto PULL_PHASE

REM ================= existing source: pull updates =================
:PULL_PHASE
echo [INFO] Fetching updates from GitHub ...
cd "%SRC%"
for /f "delims=" %%i in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%i"
if not defined BRANCH goto FAIL
if /i "%BRANCH%"=="HEAD" set "BRANCH=master"
for /f "delims=" %%i in ('git rev-parse HEAD') do set "BEFORE=%%i"
if not defined BEFORE goto FAIL
REM Shallow clone has no common ancestor with the remote, so "git pull
REM --ff-only" always fails; use fetch --depth 1 + reset --hard FETCH_HEAD
REM instead (also follows upstream force-pushes).
set /a TRY=0
:PULL_LOOP
git fetch --depth 1 origin %BRANCH% >nul 2>nul
if not errorlevel 1 goto PULL_OK
set /a TRY+=1
if %TRY% GTR 3 goto FAIL
if %TRY%==1 set "U=%M2%"
if %TRY%==2 set "U=%M3%"
if %TRY%==3 set "U=%M4%"
echo [INFO] Current remote unreachable, switching mirror: %U%
git remote set-url origin "%U%"
goto PULL_LOOP

:PULL_OK
cd "%~dp0"
for /f "delims=" %%i in ('git -C "%SRC%" rev-parse FETCH_HEAD') do set "AFTER=%%i"
if "%BEFORE%"=="%AFTER%" (
    echo [INFO] Already at the latest version, nothing to pull.
    for /f "delims=" %%i in ('git -C "%SRC%" log -1 --oneline') do echo     Current: %%i
    goto BUILD
)
REM reset --hard would discard local changes (e.g. applied patches):
REM stash first, reset, then restore; on conflict enter recovery.
set "STASHED="
git -C "%SRC%" status --porcelain -uno 2>nul | findstr . >nul 2>nul
if errorlevel 1 goto PULL_NOSTASH
git -C "%SRC%" stash push -m "%STASH_MSG%" >nul 2>nul
if errorlevel 1 goto STASH_FAIL
set "STASHED=1"
echo [INFO] Local changes stashed; restoring them after the update ...
:PULL_NOSTASH
git -C "%SRC%" reset --hard FETCH_HEAD >nul 2>nul
if errorlevel 1 goto RESET_FAIL
if not defined STASHED goto BUILD
git -C "%SRC%" stash pop >nul 2>nul
if errorlevel 1 goto STASH_POP_CONFLICT
echo [OK] Local changes restored on top of the new version.
goto BUILD

:STASH_POP_CONFLICT
echo [WARN] "git stash pop" hit conflicts after the reset. Local changes are
echo        safe: the stash is kept until every conflict is resolved.
set "RESUME_FROM_POP=1"
goto RESUME_START

:STASH_FAIL
echo [ERROR] git stash push failed - refusing "reset --hard" to protect local changes.
git -C "%SRC%" status --porcelain -uno
pause
exit /b 1

:RESET_FAIL
echo [ERROR] git reset --hard failed - update aborted, tree left untouched.
echo         Local changes exist both in the tree and in stash@{0} (just stashed).
echo         To restore the stash later (tree must be clean): git -C source stash pop
pause
exit /b 1

REM ================= conflict recovery: wait, verify, continue =================
:RESUME_START
set "HAD_UU="
git -C "%SRC%" diff --name-only --diff-filter=U 2>nul | findstr . >nul 2>nul
if errorlevel 1 goto RESUME_INTRO
set "HAD_UU=1"
:RESUME_INTRO
echo.
echo [ERROR] Files with unresolved merge conflicts:
git -C "%SRC%" diff --name-only --diff-filter=U
echo.
echo [INFO] Merge BOTH sides, then this script continues by itself.
echo        Tree: %~dp0%SRC%
echo        In a stash-pop conflict: ours = new upstream version,
echo        theirs = your local changes. Helper commands (own terminal):
echo          git -C source diff                         (inspect a conflict)
echo          git -C source checkout --ours -- PATH      (keep upstream side)
echo          git -C source checkout --theirs -- PATH    (keep local side)
echo          git -C source add PATH                     (mark file resolved)
echo.
set /a RESUME_WAIT=0
:RESUME_POLL
set "STALL_REASON="
git -C "%SRC%" diff --name-only --diff-filter=U 2>nul | findstr . >nul 2>nul
if errorlevel 1 goto RESUME_CHECK_MARKERS
set "STALL_REASON=unmerged files remain"
goto RESUME_TICK
:RESUME_CHECK_MARKERS
REM the tree may look merged while markers are still inside (half-finished
REM manual edits) - never build such a tree
git -C "%SRC%" grep -n -E "^(<<<<<<<|>>>>>>>) " -- . >nul 2>nul
if errorlevel 1 goto RESUME_DONE
set "STALL_REASON=conflict markers still present in files"
:RESUME_TICK
set /a RESUME_WAIT+=1
if %RESUME_WAIT% GEQ %RESUME_MAX% goto RESUME_TIMEOUT
set /a "MOD=RESUME_WAIT %% 20"
if %MOD% EQU 0 echo [INFO] Still waiting: %STALL_REASON% ...
ping -n 4 127.0.0.1 >nul
goto RESUME_POLL

:RESUME_DONE
git -C "%SRC%" add -A >nul 2>nul
echo [OK] All conflicts resolved and staged.
REM The auto-stash (if any) is now redundant: its content is fully present
REM in the resolved tree. Drop it only if a conflicted pop really happened
REM (HAD_UU) and the top entry is really our own stash - never risk data.
if not defined HAD_UU goto RESUME_NEXT
set "FIRST_STASH="
for /f "delims=" %%L in ('git -C "%SRC%" stash list 2^>nul') do if not defined FIRST_STASH set "FIRST_STASH=%%L"
if not defined FIRST_STASH goto RESUME_NEXT
echo %FIRST_STASH% | findstr /c:"%STASH_MSG%" >nul 2>nul
if errorlevel 1 goto RESUME_NEXT
git -C "%SRC%" stash drop >nul 2>nul
echo [OK] Dropped the redundant auto-stash.
:RESUME_NEXT
echo.
if defined RESUME_FROM_POP goto BUILD
goto PULL_PHASE

:RESUME_TIMEOUT
echo [ERROR] Gave up waiting for conflict resolution (%RESUME_MAX% polls).
echo         Resolve the files listed above, then simply re-run this script.
pause
exit /b 1

REM ================= first run: clone =================
:CLONE
set "U=%M1%"
set /a TRY=0
:CLONE_LOOP
echo [INFO] Trying to clone: %U%
git clone --depth 1 "%U%" "%SRC%" >nul 2>nul
if not errorlevel 1 goto CLONE_OK
if not exist "%SRC%" goto CLONE_RETRY
REM Clone failed and the target dir exists (non-empty, not a repo): confirm
REM before deleting, then retry the SAME source (a dir problem must not
REM consume a mirror-switch slot).
echo [WARN] "%SRC%" exists but is not a git repository; cloning needs to remove it.
choice /c YN /m "Delete the %SRC% directory (N = exit)"
if errorlevel 2 (
    echo [INFO] Cancelled. Handle "%SRC%" manually, then retry.
    pause
    exit /b 1
)
rmdir /s /q "%SRC%" 2>nul
goto CLONE_LOOP
:CLONE_RETRY
set /a TRY+=1
if %TRY% GTR 3 goto FAIL
if %TRY%==1 set "U=%M2%"
if %TRY%==2 set "U=%M3%"
if %TRY%==3 set "U=%M4%"
echo [INFO] Current remote unreachable, switching mirror: %U%
goto CLONE_LOOP
:CLONE_OK
echo [OK] Cloned successfully.
goto BUILD

REM ================= install dependencies and build =================
:BUILD
REM ---- dependency fingerprint: skip install when pnpm-lock.yaml /
REM      pnpm-workspace.yaml / patches are unchanged and node_modules is
REM      intact (fingerprint stored in Dependency\.deps-stamp). An
REM      unreadable fingerprint falls back to "install". ----
set "STAMP_FILE=%~dp0Dependency\.deps-stamp"
set "CUR_STAMP="
for /f "delims=" %%S in ('node "%~dp0Dependency\scripts\deps-stamp.mjs" "%SRC%" 2^>nul') do set "CUR_STAMP=%%S"
set "OLD_STAMP="
if exist "%STAMP_FILE%" set /p OLD_STAMP=<"%STAMP_FILE%"
set "NEED_INSTALL=1"
if defined CUR_STAMP if defined OLD_STAMP if "%OLD_STAMP%"=="%CUR_STAMP%" if exist "%SRC%\node_modules\.pnpm" set "NEED_INSTALL="
if not defined NEED_INSTALL (
    echo [1/3] Dependency fingerprint unchanged, skipping install ...
    goto AFTER_DEPS
)
echo [1/3] Installing dependencies (single attempt; on failure read the log above) ...
cd /d "%~dp0%SRC%"
call pnpm install --frozen-lockfile
set "EC=%errorlevel%"
if not "%EC%"=="0" (
    echo [ERROR] Dependency install failed, exit code %EC%. Usual causes: network/proxy down, lockfile mismatch.
    set "FAILED=1"
    goto DONE
)
if defined CUR_STAMP >"%STAMP_FILE%" echo %CUR_STAMP%
:AFTER_DEPS
REM Absolute path on purpose: whether or not the install step already left
REM the shell inside source, this must be idempotent - a second relative
REM "cd source" from inside source fails with "path not found".
cd /d "%~dp0%SRC%"
echo [2/3] Building ...
call pnpm run build
if errorlevel 1 (
    echo [INFO] Incremental build failed, usually stale artifacts of the previous
    echo        version; cleaning and rebuilding ...
    call pnpm run clean
    REM since rc.2 clean exits 1 on some dirs - upstream bug, harmless here
    call pnpm run build
    if errorlevel 1 (
        echo [ERROR] Rebuild after clean still failed. Keep the full log above for a bug report.
        set "FAILED=1"
        cd /d "%~dp0"
        goto DONE
    )
)
cd "%~dp0"
echo ==============================================
echo [OK] Update finished.
for /f "delims=" %%i in ('git -C "%SRC%" log -1 --oneline') do echo     Commit: %%i
for /f "delims=" %%V in ('node -p "require('./source/package.json').version"') do echo     Version: %%V
if defined KILLED echo The previously running service was stopped: start it again with start-harness.bat or the desktop shell.
echo ==============================================
goto DONE

:FAIL
echo [ERROR] All remotes are unreachable. Check network/proxy and retry.
set "FAILED=1"
goto DONE

:DONE
cd /d "%~dp0"
pause
REM pass a failure exit code to the caller (pause clears errorlevel, hence FAILED)
if defined FAILED exit /b 1
