@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Make Python print UTF-8 (the backend banner is in Chinese).
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

rem Prefer the "py" launcher: "python" on PATH may be the 0-byte Microsoft Store stub.
set "PY="
py --version >nul 2>nul
if not errorlevel 1 set "PY=py"
if not defined PY (
  python --version >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo.
  echo [ERROR] No usable Python found.
  echo         Install Python 3.9+ and tick "Add Python to PATH", then run this file again.
  echo.
  pause
  exit /b 1
)

%PY% -c "import flask, requests" >nul 2>nul
if errorlevel 1 (
  echo Installing dependencies: flask, requests ...
  %PY% -m pip install -r "backend\requirements.txt"
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency install failed. Run it manually:
    echo         %PY% -m pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo.
  echo [ERROR] .env not found. Creating one from .env.example ...
  copy /y ".env.example" ".env" >nul
  echo         Fill in ZHIPU_API_KEY, then run this file again.
  echo.
  notepad ".env"
  pause
  exit /b 1
)

echo.
echo Starting AIChat backend at http://127.0.0.1:8000/
echo A browser tab will open. Press Ctrl+C in this window to stop the server.
echo.
start "" http://127.0.0.1:8000/
%PY% backend\app.py

pause