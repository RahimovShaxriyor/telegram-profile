@echo off
rem TPAM launcher: installs dependencies on first run, builds the UI and starts the local server.
rem Usage: start.cmd            - normal start
rem        start.cmd --rebuild  - rebuild the web interface first (after updating the code)
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where uv >nul 2>nul || (
  echo [TPAM] uv is not installed. Run: winget install --id astral-sh.uv -e
  exit /b 1
)
where npm >nul 2>nul || (
  echo [TPAM] Node.js is not installed. Run: winget install --id OpenJS.NodeJS.LTS -e
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo [TPAM] Installing interface dependencies...
  pushd frontend && call npm ci --no-audit --no-fund || (popd & exit /b 1)
  popd
)
set "REBUILD="
if /i "%~1"=="--rebuild" set "REBUILD=1"
if not exist "frontend\dist\index.html" set "REBUILD=1"
if defined REBUILD (
  echo [TPAM] Building the web interface...
  pushd frontend && call npm run build || (popd & exit /b 1)
  popd
)

cd backend
uv run tpam
