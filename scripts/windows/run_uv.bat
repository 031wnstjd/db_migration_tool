@echo off
echo [windows] Starting uv-based local run (backend + frontend)
echo [windows] Docker scripts are intentionally not provided on Windows in this project.
uv sync
start cmd /k uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
cd /d frontend
npm install
npm run dev
