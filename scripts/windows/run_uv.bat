@echo off
setlocal

echo [windows] Purpose: local Windows development via uv + npm
echo [windows] This script starts backend and frontend directly on Windows.
echo [windows] Docker-based workflows are handled by scripts/linux/run_docker.sh on Linux.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"

pushd "%REPO_ROOT%" || goto :fail

where uv >nul 2>&1
if errorlevel 1 (
  echo [windows] `uv` was not found in PATH.
  goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [windows] `npm` was not found in PATH.
  goto :fail
)

uv sync
if errorlevel 1 goto :fail

echo [windows] Backend URL:  http://127.0.0.1:8000
echo [windows] Frontend URL: http://127.0.0.1:3000

start "db-migrator-backend" cmd /k "cd /d ""%REPO_ROOT%"" && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000"
if errorlevel 1 goto :fail

pushd "%REPO_ROOT%\frontend" || goto :fail

if /I "%FORCE_FRONTEND_INSTALL%"=="1" goto :install_frontend
if exist "node_modules\next\package.json" goto :skip_frontend_install

:install_frontend
if exist package-lock.json (
  echo [windows] Installing frontend dependencies via npm ci --no-audit --no-fund
  call npm ci --no-audit --no-fund
) else (
  echo [windows] Installing frontend dependencies via npm install --no-audit --no-fund
  call npm install --no-audit --no-fund
)
if errorlevel 1 goto :fail
goto :start_frontend

:skip_frontend_install
echo [windows] Existing frontend node_modules detected. Skipping install.
echo [windows] Set FORCE_FRONTEND_INSTALL=1 to force reinstall.

:start_frontend
echo [windows] Starting frontend dev server
call npm run dev
if errorlevel 1 goto :fail

popd
popd
endlocal
exit /b 0

:fail
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" set "EXIT_CODE=1"
echo [windows] Startup failed with exit code %EXIT_CODE%.
popd 2>nul
popd 2>nul
endlocal & exit /b %EXIT_CODE%
