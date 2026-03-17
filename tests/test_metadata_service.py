from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.metadata_service import MetadataService


def _build_sqlite_db(db_path: Path) -> str:
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            '''
        )
        conn.commit()
    return f'sqlite:///{db_path}'


def test_metadata_service_reads_sqlite_schema(tmp_path: Path) -> None:
    db_url = _build_sqlite_db(tmp_path / 'meta.db')
    service = MetadataService()

    conn = service.test_connection(None, None, db_url)
    assert conn['dialect'] == 'sqlite'

    tables = service.get_tables(None, None, db_url)
    assert tables == ['users']

    columns = service.get_columns(None, None, db_url, None, 'users')
    assert [column['column_name'] for column in columns] == ['id', 'name', 'created_at']

    primary_keys = service.get_primary_keys(None, None, db_url, None, 'users')
    assert primary_keys == ['id']

    date_columns = service.get_date_columns(None, None, db_url, None, 'users')
    assert date_columns == ['created_at']


def test_probe_sql_is_dialect_safe() -> None:
    service = MetadataService()
    assert service._probe_sql('postgresql') == 'SELECT 1'
    assert service._probe_sql('oracle') == 'SELECT 1 FROM dual'


def test_connection_route_returns_structured_validation_error() -> None:
    client = TestClient(app)
    response = client.post('/api/connections/test', json={'url': '', 'username': '', 'password': ''})

    assert response.status_code == 200
    payload = response.json()
    assert payload['success'] is False
    assert payload['errors'][0]['code'] == 'VALIDATION_ERROR'
