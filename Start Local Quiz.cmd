@echo off
cd /d "%~dp0"
echo Starting Classroom Live at http://localhost:3000
echo Keep this window open while using the quiz. Press Ctrl+C to stop.
call npm.cmd run dev
pause
