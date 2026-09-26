@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Please install the development requirements in .venv first.
  pause
  exit /b 1
)
echo This will run tests and push a NEW branch using your existing Git login.
echo It never force-pushes main. No API keys are read or requested.
choice /M "Publish now"
if errorlevel 2 exit /b 0
".venv\Scripts\python.exe" scripts\publish.py --confirm
if errorlevel 1 echo Publish failed. Check the error above. Do not assume the remote was updated.
pause
