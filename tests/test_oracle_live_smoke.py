from __future__ import annotations

import os
import re
import time
from pathlib import Path

import pytest
from sqlalchemy import text

from app.api.models import DBConfig, JobStartRequest, TableMigrationConfig
from app.core.db import create_db_engine
from app.services import repository
from app.services.ddl_service import DdlService
from app.services.metadata_service import MetadataService
from app.services.migration_service import MigrationService, _preview_sql

pytestmark = pytest.mark.oracle_live

_IDENTIFIER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]*$")


def _ident(value: str) -> str:
    normalized = (value or "").strip().upper()
    if not _IDENTIFIER_RE.fullmatch(normalized):
        raise ValueError(f"unsupported identifier: {value!r}")
    return normalized


def _oracle_env() -> dict[str, object]:
    source_url = os.getenv("ORACLE_SOURCE_URL") or os.getenv("ORACLE_TEST_URL")
    target_url = os.getenv("ORACLE_TARGET_URL") or os.getenv("ORACLE_TEST_TARGET_URL") or source_url
    table_name = os.getenv("ORACLE_TEST_TABLE") or os.getenv("ORACLE_TARGET_TABLE") or "USERS"
    if not source_url or not target_url or not table_name:
        pytest.skip("ORACLE_SOURCE_URL/ORACLE_TEST_URL and ORACLE_TEST_TABLE are required for oracle_live smoke")

    return {
        "source_url": source_url,
        "target_url": target_url,
        "source_username": os.getenv("ORACLE_SOURCE_USERNAME") or os.getenv("ORACLE_TEST_USERNAME") or None,
        "source_password": os.getenv("ORACLE_SOURCE_PASSWORD") or os.getenv("ORACLE_TEST_PASSWORD") or None,
        "source_schema": _ident(os.getenv("ORACLE_SOURCE_SCHEMA") or os.getenv("ORACLE_TEST_SCHEMA") or "ORACLE_SOURCE"),
        "target_username": os.getenv("ORACLE_TARGET_USERNAME") or None,
        "target_password": os.getenv("ORACLE_TARGET_PASSWORD") or None,
        "target_schema": _ident(os.getenv("ORACLE_TARGET_SCHEMA") or "ORACLE_TARGET"),
        "table_name": _ident(table_name),
        "expected_target_count": int(os.getenv("ORACLE_EXPECT_TARGET_COUNT", "4")),
        "expected_updated_name": os.getenv("ORACLE_EXPECT_UPDATED_NAME", "Alice Oracle"),
        "expected_ids": [int(value) for value in os.getenv("ORACLE_EXPECT_TARGET_IDS", "1,2,3").split(",") if value],
    }


def test_oracle_live_connection_metadata_migration_and_preview(tmp_path: Path) -> None:
    env = _oracle_env()
    metadata = MetadataService()
    ddl_service = DdlService()
    migration_service = MigrationService()

    source_connection = metadata.test_connection(env["source_username"], env["source_password"], env["source_url"])
    target_connection = metadata.test_connection(env["target_username"], env["target_password"], env["target_url"])
    assert source_connection["dialect"] == "oracle"
    assert target_connection["dialect"] == "oracle"

    source_tables = metadata.get_tables(env["source_username"], env["source_password"], env["source_url"], env["source_schema"])
    target_tables = metadata.get_tables(env["target_username"], env["target_password"], env["target_url"], env["target_schema"])
    source_table_name = next((table for table in source_tables if table.upper() == env["table_name"]), None)
    target_table_name = next((table for table in target_tables if table.upper() == env["table_name"]), None)
    assert source_table_name is not None
    assert target_table_name is not None

    columns = metadata.get_columns(env["source_username"], env["source_password"], env["source_url"], env["source_schema"], env["table_name"])
    assert columns

    ddl = ddl_service.extract_table_ddl(env["source_username"], env["source_password"], env["source_url"], env["source_schema"], env["table_name"])
    assert ddl["dialect"] == "oracle"
    assert ddl["table_name"] == env["table_name"]
    assert ddl["table_sql"]
    assert ddl["partition_sql"]
    assert "warning_codes" in ddl

    available_columns = [str(column["column_name"]) for column in columns]
    normalized_columns = {name.upper(): name for name in available_columns}
    selected_columns = [normalized_columns[name] for name in ("ID", "NAME", "AGE", "CREATED_AT") if name in normalized_columns] or available_columns[: min(4, len(available_columns))]
    key_columns = [normalized_columns.get("ID", selected_columns[0])]
    preview = _preview_sql(
        TableMigrationConfig(
            source_schema=env["source_schema"],
            source_table=source_table_name,
            target_schema=env["target_schema"],
            target_table=target_table_name,
            selected_columns=selected_columns,
            key_columns=key_columns,
            strategy="MERGE",
        ),
        env["source_url"],
        env["target_url"],
    )
    assert preview["source_select"]
    assert preview["dml_preview"]
    assert preview["preview_mode"] == "compiled_sql_with_notes"
    assert any("UPDATE then INSERT fallback" in note for note in preview["preview_notes"])

    # Actual Oracle migration is exercised by scripts/oracle/live_smoke.py against the running backend stack.

