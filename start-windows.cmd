@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONUTF8=1"
echo 锂电智诊 - 检查本机解释器与项目环境
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys;sys.exit(sys.version_info[:2] not in [(3,11),(3,12),(3,13),(3,14)])" >nul 2>nul
  if not errorlevel 1 (
    ".venv\Scripts\python.exe" scripts\bootstrap.py --start
    goto finished
  )
)
for %%V in (3.13 3.12 3.11 3.14) do (
  py -%%V -c "import sys;print(sys.executable)" >nul 2>nul
  if not errorlevel 1 (
    py -%%V scripts\bootstrap.py --start
    goto finished
  )
)
for %%V in (313 312 311 314) do (
  if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" -c "import sys;print(sys.executable)" >nul 2>nul
    if not errorlevel 1 (
      "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" scripts\bootstrap.py --start
      goto finished
    )
  )
)
for /f "delims=" %%P in ('where python.exe 2^>nul') do (
  echo %%P | findstr /i /c:"WindowsApps" >nul
  if errorlevel 1 (
    "%%P" -c "import sys;sys.exit(sys.version_info[:2] not in [(3,11),(3,12),(3,13),(3,14)])" >nul 2>nul
    if not errorlevel 1 (
      "%%P" scripts\bootstrap.py --start
      goto finished
    )
  )
)
echo.
echo 未找到可以实际启动的 Python 3.11-3.14。
echo 没有删除项目、修改注册表或改变 PowerShell 执行策略。
echo 请安装官方 Python 3.13 后再双击此文件。
echo 使用 WinGet 时可在终端执行：winget install --exact --id Python.Python.3.13 --scope user
echo 官方下载：https://www.python.org/downloads/windows/
:finished
echo.
echo 窗口中的错误不会被跳过。可复制完整错误用于排查。
pause
endlocal
