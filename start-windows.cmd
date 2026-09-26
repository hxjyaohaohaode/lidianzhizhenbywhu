@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please create .venv and install requirements.txt first. See README.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" scripts\start.py
if errorlevel 1 (
  echo Startup failed. Review the error above and docs/DEPLOY.md.
  pause
  exit /b 1
)
