#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_BASE="http://127.0.0.1:8000/api"
TIMEOUT_SECONDS=420
ORACLE_HOST_URL="oracle+oracledb://oracle_source:oracle_source_pass@127.0.0.1:1521/?service_name=XEPDB1"
ORACLE_TARGET_HOST_URL="oracle+oracledb://oracle_target:oracle_target_pass@127.0.0.1:1521/?service_name=XEPDB1"
ORACLE_SOURCE_SERVICE_URL="oracle+oracledb://oracle_source:oracle_source_pass@oracle-free:1521/?service_name=XEPDB1"
ORACLE_TARGET_SERVICE_URL="oracle+oracledb://oracle_target:oracle_target_pass@oracle-free:1521/?service_name=XEPDB1"

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

postgres_smoke_test() {
  echo "[docker] smoke config: source=postgresql+psycopg://test_user:***@postgres:5432/test_db target=postgresql+psycopg://test_user:***@postgres:5432/test_db table=users"
  python3 - "$API_BASE" <<'PY'
import json
import sys
import time
import urllib.request

api_base = sys.argv[1]
source_db = {"url": "postgresql+psycopg://test_user:test_password@postgres:5432/test_db"}
target_db = {"url": "postgresql+psycopg://test_user:test_password@postgres:5432/test_db"}
table_name = "users"

def req(method, path, payload=None):
    url = f"{api_base}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8") or "{}"
        return json.loads(raw)

health = req("GET", "/health")
if not health.get("success"):
    raise RuntimeError(f"health failed: {health}")

connection = req("POST", "/connections/test", source_db)
if not connection.get("success"):
    raise RuntimeError(f"connection test failed: {connection}")
print("[docker] connection dialect:", (connection.get("data") or {}).get("dialect"))

tables = req("POST", "/metadata/tables", {**source_db, "schema_name": "source_schema"})
if not tables.get("success") or table_name not in (tables.get("data") or {}).get("tables", []):
    raise RuntimeError(f"metadata tables failed: {tables}")

columns = req("POST", "/metadata/columns", {**source_db, "schema_name": "source_schema", "table_name": table_name})
if not columns.get("success"):
    raise RuntimeError(f"metadata columns failed: {columns}")

ddl = req("POST", "/metadata/ddl", {**source_db, "schema_name": "source_schema", "table_name": table_name})
if not ddl.get("success"):
    raise RuntimeError(f"ddl extract failed: {ddl}")
ddl_data = ddl.get("data") or {}
print("[docker] ddl warning codes:", ddl_data.get("warning_codes", []))
if not ddl_data.get("table_sql"):
    raise RuntimeError(f"ddl table_sql missing: {ddl}")

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
        payload = status.get("data") or {}
        print("[docker] smoke evidence:", json.dumps({
            "dialect": (connection.get("data") or {}).get("dialect"),
            "job_status": payload.get("status"),
            "ddl_warning_codes": ddl_data.get("warning_codes", []),
            "ddl_has_partition_section": bool((ddl_data.get("partition_sql") or "").strip()),
        }))
        print("[docker] smoke OK")
        raise SystemExit(0)
    time.sleep(1)

raise RuntimeError(f"job did not complete: {job_id}")
PY
}

oracle_runtime_check() {
  echo "[docker] oracle runtime preflight: ${ORACLE_SOURCE_SERVICE_URL/oracle_source_pass/***}"
  compose_run -f docker-compose.yml -f docker-compose.oracle.yml exec -T backend \
    python /workspace/scripts/verify_oracle_runtime.py --connect "$ORACLE_SOURCE_SERVICE_URL"
}

oracle_smoke_test() {
  echo "[docker] oracle smoke config: source=${ORACLE_HOST_URL/oracle_source_pass/***} target=${ORACLE_TARGET_HOST_URL/oracle_target_pass/***}"
  compose_run -f docker-compose.yml -f docker-compose.oracle.yml exec -T backend \
    env \
      ORACLE_API_BASE=http://127.0.0.1:8000/api \
      ORACLE_SOURCE_URL="$ORACLE_SOURCE_SERVICE_URL" \
      ORACLE_SOURCE_SCHEMA=ORACLE_SOURCE \
      ORACLE_TARGET_URL="$ORACLE_TARGET_SERVICE_URL" \
      ORACLE_TARGET_SCHEMA=ORACLE_TARGET \
      ORACLE_TARGET_TABLE=USERS \
      python /workspace/scripts/oracle/live_smoke.py
}

usage() {
  cat <<'USAGE'
Usage:
  # Production
  bash scripts/linux/run_docker.sh prod-up
  bash scripts/linux/run_docker.sh prod-down

  # PostgreSQL dev/test stack
  bash scripts/linux/run_docker.sh test-start
  bash scripts/linux/run_docker.sh test-down
  bash scripts/linux/run_docker.sh test-clean

  # Oracle container verification stack
  bash scripts/linux/run_docker.sh oracle-start
  bash scripts/linux/run_docker.sh oracle-smoke
  bash scripts/linux/run_docker.sh oracle-down
  bash scripts/linux/run_docker.sh oracle-clean
USAGE
}

ensure_docker

case "${1:-}" in
  prod-up)
    echo "[docker] Purpose: Linux production-style stack (backend + frontend)"
    FRONTEND_PORT=3000 compose_run -f docker-compose.yml -f docker-compose.prod.yml up -d --build --force-recreate
    echo "[docker] frontend: http://127.0.0.1:3000"
    echo "[docker] backend:  http://127.0.0.1:8000"
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
    echo "[docker] Purpose: Linux PostgreSQL dev/test stack (postgres + backend + frontend + smoke)"
    FRONTEND_PORT=3001 compose_run -f docker-compose.yml -f docker-compose.test.yml up -d --build --force-recreate postgres backend frontend
    wait_http_ok "$API_BASE/health" "backend health"
    echo "[docker] frontend: http://127.0.0.1:3001"
    echo "[docker] backend:  http://127.0.0.1:8000"
    postgres_smoke_test
    ;;
  oracle-down)
    compose_run -f docker-compose.yml -f docker-compose.oracle.yml down --remove-orphans
    ;;
  oracle-clean)
    compose_run -f docker-compose.yml -f docker-compose.oracle.yml down --rmi local --volumes --remove-orphans
    ;;
  oracle-start)
    echo "[docker] Purpose: Linux Oracle verification stack (oracle + backend + frontend)"
    FRONTEND_PORT=3002 compose_run -f docker-compose.yml -f docker-compose.oracle.yml up -d --build oracle-free backend frontend
    wait_http_ok "$API_BASE/health" "backend health"
    echo "[docker] Oracle local source URL: $ORACLE_HOST_URL"
    echo "[docker] Oracle local target URL: $ORACLE_TARGET_HOST_URL"
    echo "[docker] frontend: http://127.0.0.1:3002"
    echo "[docker] backend:  http://127.0.0.1:8000"
    echo "[docker] Stack is ready. Run 'bash scripts/linux/run_docker.sh oracle-smoke' for verification."
    ;;
  oracle-smoke)
    echo "[docker] Purpose: Linux Oracle verification stack + smoke"
    FRONTEND_PORT=3002 compose_run -f docker-compose.yml -f docker-compose.oracle.yml up -d --build oracle-free backend frontend
    wait_http_ok "$API_BASE/health" "backend health"
    echo "[docker] frontend: http://127.0.0.1:3002"
    echo "[docker] backend:  http://127.0.0.1:8000"
    oracle_runtime_check
    oracle_smoke_test
    ;;
  *)
    usage
    exit 1
    ;;
esac
