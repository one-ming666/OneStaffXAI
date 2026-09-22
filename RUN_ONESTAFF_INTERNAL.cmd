@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OneStaff X AI - Startup Console

set "LOG=%~dp0startup_diagnostic.txt"
>"%LOG%" echo OneStaff X AI startup diagnostic
>>"%LOG%" echo DateTime: %DATE% %TIME%
>>"%LOG%" echo Project: %CD%

echo ============================================================
echo OneStaff X AI 2026.9.19 - Fresh Safe Startup
echo This window will stay open if anything goes wrong.
echo Project: %CD%
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NO_NODE
for /f "delims=" %%V in ('node -v') do set "NODEVER=%%V"
echo [OK] Node %NODEVER%
>>"%LOG%" echo Node: %NODEVER%
where node >>"%LOG%" 2>&1

node -e "process.exit((Number(process.versions.node.split('.')[0])>22||(Number(process.versions.node.split('.')[0])===22&&Number(process.versions.node.split('.')[1])>=13))?0:1)" >nul 2>&1
if errorlevel 1 goto OLD_NODE

where npm >nul 2>nul
if errorlevel 1 goto NO_NPM
for /f "delims=" %%V in ('npm -v') do set "NPMVER=%%V"
echo [OK] npm %NPMVER%
>>"%LOG%" echo npm: %NPMVER%
where npm >>"%LOG%" 2>&1

if not exist "package.json" goto NO_PACKAGE
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul 2>&1

node scripts\check-deps.mjs >nul 2>&1
if errorlevel 1 goto INSTALL_DEPS
goto START_SERVER

:INSTALL_DEPS
echo.
echo [INFO] Dependencies are missing or incomplete.
echo [INFO] Installing dependencies now. Keep this window open.
echo [INFO] This can take several minutes on the first run.
echo.
>>"%LOG%" echo Dependencies: missing or incomplete
if exist "package-lock.json" (
  call npm ci --ignore-scripts --no-audit --no-fund
) else (
  call npm install --ignore-scripts --no-audit --no-fund
)
if errorlevel 1 goto INSTALL_FAILED

echo.
node scripts\check-deps.mjs
if errorlevel 1 goto INSTALL_FAILED
echo [OK] Dependencies installed and verified.
>>"%LOG%" echo Dependencies: installed successfully

goto START_SERVER

:START_SERVER
echo.
echo ============================================================
echo Starting OneStaff X AI...
echo Browser address: http://127.0.0.1:3000
echo Demo unlock code: 1314
echo Do NOT close this console while using the platform.
echo ============================================================
echo.
>>"%LOG%" echo StartServer: %DATE% %TIME%

REM Open the browser manually at the printed address after the server is ready.
echo Open your browser at http://127.0.0.1:3000 after the ready message.
node --env-file-if-exists=.env server/index.js
set "RC=%ERRORLEVEL%"

echo.
echo ============================================================
echo Server stopped. Exit code: %RC%
echo If you did not close it yourself, copy startup_diagnostic.txt
echo or send a screenshot of this window.
echo ============================================================
>>"%LOG%" echo ServerExitCode: %RC%
goto HOLD

:NO_NODE
echo.
echo [ERROR] Node.js was not found.
echo Install a supported Node.js version (22.13 or later), then run START_ONESTAFF.cmd again.
>>"%LOG%" echo ERROR: Node.js not found
goto HOLD

:OLD_NODE
echo.
echo [ERROR] Node.js is too old: %NODEVER%
echo Install a supported Node.js version (22.13 or later).
>>"%LOG%" echo ERROR: Node.js too old - %NODEVER%
goto HOLD

:NO_NPM
echo.
echo [ERROR] npm was not found although Node.js exists.
echo Reinstall Node.js and make sure npm is selected.
>>"%LOG%" echo ERROR: npm not found
goto HOLD

:NO_PACKAGE
echo.
echo [ERROR] package.json was not found.
echo You may be running the launcher from the wrong folder or an incomplete extraction.
>>"%LOG%" echo ERROR: package.json missing
goto HOLD

:INSTALL_FAILED
echo.
echo ============================================================
echo [ERROR] Dependency installation failed.
echo 1. Check your internet connection.
echo 2. Make sure no antivirus is deleting node_modules.
echo 3. Try again by running START_ONESTAFF.cmd.
echo 4. If it still fails, send a screenshot of the FIRST red error above.
echo ============================================================
>>"%LOG%" echo ERROR: npm ci failed with %ERRORLEVEL%
goto HOLD

:HOLD
echo.
echo Diagnostic file: %LOG%
echo You can close this window manually after reading the message.
echo.
pause
endlocal
