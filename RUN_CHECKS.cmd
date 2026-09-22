@echo off
cd /d "%~dp0"
node scripts\check-source.mjs
call npm run test:offline
echo Offline tests do not call your real accounts.
echo Use npm run test:integration after dependencies are installed.
pause
