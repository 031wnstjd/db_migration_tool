from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.db import create_db_engine

DEFAULT_API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8000/api")
DEFAULT_SOURCE_URL = "oracle+oracledb://oracle_source:oracle_source_pass@oracle-free:1521/?service_name=XEPDB1"
DEFAULT_TARGET_URL = "oracle+oracledb://oracle_target:oracle_target_pass@oracle-free:1521/?service_name=XEPDB1"
_IDENTIFIER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]*$")


@dataclass(slots=True)
class OracleSmokeConfig:
    api_base: str
    source_url: str
    target_url: str
    source_username: str | None
    source_password: str | None
    source_schema: str
    target_username: str | None
    target_password: str | None
    target_schema: str
    table_name: str

    @classmethod
    def from_env(cls) -> "OracleSmokeConfig":
        return cls(
            api_base=os.getenv("ORACLE_API_BASE", DEFAULT_API_BASE),
            source_url=os.getenv("ORACLE_SOURCE_URL") or os.getenv("ORACLE_TEST_URL") or DEFAULT_SOURCE_URL,
            target_url=os.getenv("ORACLE_TARGET_URL") or DEFAULT_TARGET_URL,
            source_username=os.getenv("ORACLE_SOURCE_USERNAME") or os.getenv("ORACLE_TEST_USERNAME") or None,
            source_password=os.getenv("ORACLE_SOURCE_PASSWORD") or os.getenv("ORACLE_TEST_PASSWORD") or None,
            source_schema=(os.getenv("ORACLE_SOURCE_SCHEMA") or os.getenv("ORACLE_TEST_SCHEMA") or "ORACLE_SOURCE").upper(),
            target_username=os.getenv("ORACLE_TARGET_USERNAME") or None,
            target_password=os.getenv("ORACLE_TARGET_PASSWORD") or None,
            target_schema=(os.getenv("ORACLE_TARGET_SCHEMA") or "ORACLE_TARGET").upper(),
            table_name=(os.getenv("ORACLE_TARGET_TABLE") or os.getenv("ORACLE_TEST_TABLE") or "USERS").upper(),
        )


def _request(api_base: str, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{api_base}{path}"
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read().decode("utf-8") or "{}"
        return json.loads(raw)


def _assert_success(label: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not payload.get("success"):
        raise RuntimeError(f"{label} failed: {json.dumps(payload, ensure_ascii=False)}")
    return payload


def _ident(value: str) -> str:
    normalized = (value or "").strip().upper()
    if not _IDENTIFIER_RE.fullmatch(normalized):
        raise ValueError(f"unsupported identifier: {value!r}")
    return normalized


def _target_summary(config: OracleSmokeConfig, table_name: str) -> dict[str, Any]:
    table_name = _ident(table_name)
    target_schema = _ident(config.target_schema)
    target_engine = create_db_engine(config.target_url, username=config.target_username, password=config.target_password)
    try:
        with target_engine.connect() as conn:
            row_count = conn.execute(text(f"SELECT COUNT(*) FROM {target_schema}.{table_name}")).scalar_one()
            updated_name = conn.execute(text(f"SELECT NAME FROM {target_schema}.{table_name} WHERE ID = 1")).scalar_one()
            sentinel_exists = bool(conn.execute(text(f"SELECT COUNT(*) FROM {target_schema}.{table_name} WHERE ID = 99")).scalar_one())
            migrated_ids = [row[0] for row in conn.execute(text(f"SELECT ID FROM {target_schema}.{table_name} WHERE ID IN (1, 2, 3) ORDER BY ID")).all()]
        return {
            "target_row_count": int(row_count),
            "updated_row_name": str(updated_name),
            "sentinel_row_preserved": sentinel_exists,
            "migrated_ids": migrated_ids,
        }
    finally:
        target_engine.dispose()


def run_live_smoke(config: OracleSmokeConfig | None = None) -> dict[str, Any]:
    config = config or OracleSmokeConfig.from_env()
    source_db = {"url": config.source_url, "username": config.source_username, "password": config.source_password}
    target_db = {"url": config.target_url, "username": config.target_username, "password": config.target_password}

    health = _assert_success("health", _request(config.api_base, "GET", "/health"))
    source_connection = _assert_success("source connection", _request(config.api_base, "POST", "/connections/test", source_db))
    target_connection = _assert_success("target connection", _request(config.api_base, "POST", "/connections/test", target_db))

    target_tables = _assert_success(
        "target table discovery",
        _request(config.api_base, "POST", "/metadata/tables", {**target_db, "schema_name": config.target_schema}),
    )

    tables = _assert_success(
        "table discovery",
        _request(config.api_base, "POST", "/metadata/tables", {**source_db, "schema_name": config.source_schema}),
    )
    table_list = (tables.get("data") or {}).get("tables") or []
    normalized_tables = {str(name).upper(): str(name) for name in table_list}
    source_table_name = normalized_tables.get(config.table_name.upper())
    if not source_table_name:
        raise RuntimeError(f"expected {config.source_schema}.{config.table_name} in tables: {table_list}")

    target_table_list = (target_tables.get("data") or {}).get("tables") or []
    normalized_target_tables = {str(name).upper(): str(name) for name in target_table_list}
    target_table_name = normalized_target_tables.get(config.table_name.upper())
    if not target_table_name:
        raise RuntimeError(f"expected {config.target_schema}.{config.table_name} in target tables: {target_table_list}")

    columns = _assert_success(
        "column discovery",
        _request(
            config.api_base,
            "POST",
            "/metadata/columns",
            {**source_db, "schema_name": config.source_schema, "table_name": config.table_name},
        ),
    )
    ddl = _assert_success(
        "ddl extraction",
        _request(
            config.api_base,
            "POST",
            "/metadata/ddl",
            {**source_db, "schema_name": config.source_schema, "table_name": config.table_name},
        ),
    )
    ddl_data = ddl.get("data") or {}
    column_names = [str(column.get("column_name") or "") for column in ((columns.get("data") or {}).get("columns") or [])]
    normalized_columns = {name.upper(): name for name in column_names}
    selected_columns = [normalized_columns[name] for name in ("ID", "NAME", "AGE", "CREATED_AT") if name in normalized_columns]
    if [name.upper() for name in selected_columns] != ["ID", "NAME", "AGE", "CREATED_AT"]:
        raise RuntimeError(f"unexpected oracle smoke columns: {column_names}")

    job = _assert_success(
        "job start",
        _request(
            config.api_base,
            "POST",
            "/jobs/start",
            {
                "source_db": source_db,
                "target_db": target_db,
                "table_configs": [
                    {
                        "source_schema": config.source_schema,
                        "source_table": source_table_name,
                        "target_schema": config.target_schema,
                        "target_table": target_table_name,
                        "selected_columns": selected_columns,
                        "key_columns": [normalized_columns["ID"]],
                        "strategy": "MERGE",
                        "batch_size": 2,
                    }
                ],
                "dry_run": False,
            },
        ),
    )
    job_id = ((job.get("data") or {}).get("job_id") or "").strip()
    if not job_id:
        raise RuntimeError(f"job id missing: {job}")

    terminal_status: dict[str, Any] | None = None
    for _ in range(120):
        status = _assert_success("job status", _request(config.api_base, "GET", f"/jobs/{job_id}"))
        payload = status.get("data") or {}
        if payload.get("status") in {"SUCCESS", "FAILED", "CANCELLED"}:
            terminal_status = payload
            break
        time.sleep(1)

    if terminal_status is None:
        raise RuntimeError(f"job did not reach a terminal state: {job_id}")
    if terminal_status.get("status") != "SUCCESS":
        raise RuntimeError(f"job failed: {json.dumps(terminal_status, ensure_ascii=False)}")

    table_results = ((terminal_status.get("result") or {}).get("tables") or [{}])[0]
    direct_db = _target_summary(config, target_table_name)
    if not ddl_data.get("table_sql"):
        raise RuntimeError("table_sql missing from Oracle DDL output")
    if not ddl_data.get("partition_sql"):
        raise RuntimeError("partition_sql missing from Oracle DDL output")
    if direct_db["updated_row_name"] != "Alice Oracle":
        raise RuntimeError(f"expected merged ID=1 row to be updated, got {direct_db['updated_row_name']!r}")
    if direct_db["target_row_count"] != 4:
        raise RuntimeError(f"expected 4 target rows after smoke, got {direct_db['target_row_count']}")
    if direct_db["migrated_ids"] != [1, 2, 3]:
        raise RuntimeError(f"expected migrated IDs [1, 2, 3], got {direct_db['migrated_ids']}")
    if not direct_db["sentinel_row_preserved"]:
        raise RuntimeError("expected sentinel target row with ID=99 to remain after MERGE smoke")

    evidence = {
        "config": asdict(config),
        "health_status": ((health.get("data") or {}).get("status")),
        "source_connection": source_connection.get("data") or {},
        "target_connection": target_connection.get("data") or {},
        "discovered_tables": table_list,
        "discovered_target_tables": target_table_list,
        "ddl_warning_codes": ddl_data.get("warning_codes", []),
        "ddl_has_partition_section": bool((ddl_data.get("partition_sql") or "").strip()),
        "job_id": job_id,
        "job_status": terminal_status.get("status"),
        "migrated_rows": table_results.get("migrated_rows"),
        "preview_mode": ((table_results.get("preview") or {}).get("preview_mode")),
        "preview_notes": ((table_results.get("preview") or {}).get("preview_notes") or []),
        **direct_db,
    }
    return evidence


if __name__ == "__main__":
    print(json.dumps(run_live_smoke(), ensure_ascii=False, indent=2))
