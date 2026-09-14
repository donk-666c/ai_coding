@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 优先用 py 启动器：PATH 上的 python 可能是 Windows 商店的占位符（0 字节）
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py") else (set "PY=python")

%PY% --version >nul 2>nul
if not %errorlevel%==0 (
  echo [错误] 没找到可用的 Python，请先安装 Python 3.9+ 并勾选 Add to PATH。
  pause
  exit /b 1
)

%PY% -c "import flask, requests" >nul 2>nul
if not %errorlevel%==0 (
  echo 正在安装依赖 flask / requests ...
  %PY% -m pip install -r backend\requirements.txt
  if not %errorlevel%==0 (
    echo [错误] 依赖安装失败。可手动执行：%PY% -m pip install -r backend\requirements.txt
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo [提示] 没有找到 .env，正在从 .env.example 复制一份...
  copy /y ".env.example" ".env" >nul
  echo        请填入 ZHIPU_API_KEY 后重新运行本脚本。
  notepad ".env"
  pause
  exit /b 1
)

echo 正在启动 AIChat 后端，稍后会自动打开浏览器...
start "" http://127.0.0.1:8000/
%PY% backend\app.py

pause
