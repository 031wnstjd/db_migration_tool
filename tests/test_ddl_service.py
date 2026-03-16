from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.ddl_service import DdlService


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path}"


def _build_sqlite_ddl_db(db_path: Path) -> str:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX idx_users_created_at ON users(created_at)")
        conn.commit()
    return _sqlite_url(db_path)


def test_extract_table_ddl_for_sqlite(tmp_path: Path) -> None:
    db_url = _build_sqlite_ddl_db(tmp_path / "ddl.db")

    ddl = DdlService().extract_table_ddl(None, None, db_url, None, "users")

    assert ddl["dialect"] == "sqlite"
    assert "CREATE TABLE users" in ddl["table_sql"]
    assert "CREATE INDEX idx_users_created_at" in ddl["index_sql"]
    assert "CREATE TABLE users" in ddl["combined_sql"]
    assert any("Partition metadata is not applicable" in warning for warning in ddl["warnings"])


def test_extract_ddl_route_contract(tmp_path: Path) -> None:
    db_url = _build_sqlite_ddl_db(tmp_path / "route-ddl.db")
    client = TestClient(app)

    for path in ("/api/metadata/ddl", "/api/metadata/ddl/"):
        response = client.post(
            path,
            json={
                "url": db_url,
                "username": "",
                "password": "",
                "table_name": "users",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["dialect"] == "sqlite"
        assert payload["data"]["table_name"] == "users"
        assert "combined_sql" in payload["data"]
