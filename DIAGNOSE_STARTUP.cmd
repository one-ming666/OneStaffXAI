@echo off
cd /d "%~dp0"
echo OneStaff X AI - No secrets are printed below.
where node
where npm
node -v
call npm -v
node scripts\check-deps.mjs
node scripts\check-source.mjs
echo If startup fails, capture the first error. Do not send data/master.key or .env.
pause
