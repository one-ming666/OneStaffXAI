@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if not exist "RUN_ONESTAFF_INTERNAL.cmd" goto INCOMPLETE
if not exist "package.json" goto INCOMPLETE
call ".\RUN_ONESTAFF_INTERNAL.cmd"
exit /b
:INCOMPLETE
echo [ERROR] Project files are missing. Extract the entire ZIP first.
echo Right-click the ZIP, choose Extract All, then open the extracted folder.
pause
