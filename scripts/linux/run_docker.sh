#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_BASE="http://127.0.0.1:8000/api"
TIMEOUT_SECONDS=90

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not installed or not in PATH" >&2
    exit 1
  fi

  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    echo "error: docker compose command is not available" >&2
    exit 1
  fi
}

compose_run() {
  (
    cd "$PROJECT_ROOT" &&
      "${COMPOSE[@]}" "$@"
  )
}

wait_http_ok() {
  local url="$1"
  local label="$2"
  local waited=0
  while (( waited < TIMEOUT_SECONDS )); do
    if curl -sf "$url" >/dev/null; then
      echo "[docker] OK ${label}"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "[docker] ERROR: timeout waiting for ${label}: ${url}" >&2
  return 1
}

smoke_test() {
  echo "[docker] smoke config: source=postgresql+psycopg://test_user:***@postgres:5432/test_db target=postgresql+psycopg://test_user:***@postgres:5432/test_db table=users"
  python3 - "$API_BASE" <<'PY'
import json
import sys
import time
import urllib.request

api_base = sys.argv[1]
source_db = {"url": "postgresql+psycopg://test_user:test_password@postgres:5432/test_db", "username": "test_user", "password": "test_password"}
target_db = {"url": "postgresql+psycopg://test_user:test_password@postgres:5432/test_db", "username": "test_user", "password": "test_password"}
table_name = "users"

def req(method, path, payload=None):
    url = f"{api_base}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8") or "{}"
        return json.loads(raw)

health = req("GET", "/health")
if not health.get("success"):
    raise RuntimeError(f"health failed: {health}")

tables = req("POST", "/metadata/tables", {**source_db, "schema_name": "source_schema"})
if not tables.get("success") or table_name not in (tables.get("data") or {}).get("tables", []):
    raise RuntimeError(f"metadata tables failed: {tables}")

columns = req("POST", "/metadata/columns", {**source_db, "schema_name": "source_schema", "table_name": table_name})
if not columns.get("success"):
    raise RuntimeError(f"metadata columns failed: {columns}")

job = req(
    "POST",
    "/jobs/start",
    {
        "source_db": source_db,
        "target_db": target_db,
        "table_configs": [
            {
                "source_schema": "source_schema",
                "source_table": table_name,
                "target_schema": "target_schema",
                "target_table": table_name,
                "selected_columns": ["id", "name", "age", "created_at"],
                "key_columns": ["id"],
                "strategy": "MERGE",
                "batch_size": 2,
            }
        ],
        "dry_run": False,
    },
)
if not job.get("success"):
    raise RuntimeError(f"job start failed: {job}")

job_id = job["data"]["job_id"]
for _ in range(30):
    status = req("GET", f"/jobs/{job_id}")
    if status.get("success") and (status.get("data") or {}).get("status") == "SUCCESS":
        print("[docker] smoke OK")
        raise SystemExit(0)
    time.sleep(1)

raise RuntimeError(f"job did not complete: {job_id}")
PY
}

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/linux/run_docker.sh prod-up
  bash scripts/linux/run_docker.sh prod-down
  bash scripts/linux/run_docker.sh test-start
  bash scripts/linux/run_docker.sh test-down
  bash scripts/linux/run_docker.sh test-clean
USAGE
}

ensure_docker

case "${1:-}" in
  prod-up)
    compose_run -f docker-compose.yml -f docker-compose.prod.yml up -d --build --force-recreate
    ;;
  prod-down)
    compose_run -f docker-compose.yml -f docker-compose.prod.yml down
    ;;
  test-down)
    compose_run -f docker-compose.yml -f docker-compose.test.yml down --remove-orphans
    ;;
  test-clean)
    compose_run -f docker-compose.yml -f docker-compose.test.yml down --rmi local --volumes --remove-orphans
    ;;
  test-start)
    compose_run -f docker-compose.yml -f docker-compose.test.yml up -d --build --force-recreate
    wait_http_ok "$API_BASE/health" "backend health"
    smoke_test
    ;;
  *)
    usage
    exit 1
    ;;
esac
