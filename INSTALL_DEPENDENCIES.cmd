@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 goto FAILED
if exist package-lock.json (
 call npm ci --ignore-scripts --no-audit --no-fund
) else (
 call npm install --ignore-scripts --no-audit --no-fund
)
if errorlevel 1 goto FAILED
node scripts\check-deps.mjs
goto DONE
:FAILED
echo [ERROR] Installation failed. Read the first error above.
:DONE
pause
