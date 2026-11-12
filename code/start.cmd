@echo off
cd /d "%~dp0"
node supervisor.mjs
echo.
echo Bridge stopped. Press any key to close.
pause >nul
