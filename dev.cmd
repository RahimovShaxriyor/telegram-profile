@echo off
rem Development mode: backend with TPAM_DEV=1 + Vite dev server with hot reload (two windows).
chcp 65001 >nul
cd /d "%~dp0"
start "TPAM backend" cmd /k "cd backend && set TPAM_DEV=1&& set TPAM_OPEN_BROWSER=0&& uv run tpam"
start "TPAM frontend" cmd /k "cd frontend && npm run dev"
echo Open the "Dev-режим (Vite)" link printed in the backend window.
