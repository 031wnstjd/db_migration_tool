from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path

import pytest

from app.api.models import JobStartRequest, TableMigrationConfig
from app.services import repository
from app.services.migration_service import _apply_mask, _build_where, _fq, _mask_row, _preview_sql, _quote, MigrationService


def _sqlite_url(path: Path) -> str:
    return f'sqlite:///{path}'


def _init_source_target(source_db: Path, target_db: Path) -> None:
    with sqlite3.connect(source_db) as conn:
        conn.execute(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER,
                created_at TEXT NOT NULL
            )
            '''
        )
        conn.executemany(
            'INSERT INTO users (id, name, age, created_at) VALUES (?, ?, ?, ?)',
            [
                (1, 'alice', 30, '2024-01-01'),
                (2, 'bob', 41, '2024-02-15'),
                (3, 'carol', 35, '2024-03-22'),
            ],
        )
        conn.commit()

    with sqlite3.connect(target_db) as conn:
        conn.execute(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                name TEXT,
                age INTEGER,
                created_at TEXT
            )
            '''
        )
        conn.execute('INSERT INTO users (id, name, age, created_at) VALUES (?, ?, ?, ?)', (1, 'pre_existing', 99, '2024-01-10'))
        conn.commit()


def test_quote_and_qualified_name_helpers() -> None:
    assert _quote('table') == '"table"'
    assert _fq('public', 'users') == '"public"."users"'
    assert _fq(None, 'users') == '"users"'


def test_build_where_with_date_bounds() -> None:
    cfg = TableMigrationConfig(
        source_schema='main',
        source_table='users',
        target_schema='main',
        target_table='users',
        selected_columns=['id', 'created_at'],
        strategy='INSERT',
        date_filter_column='created_at',
        date_from='2024-01-01',
        date_to='2024-01-31',
    )

    binds: dict[str, object] = {}
    where_clause = _build_where(cfg, binds)

    assert where_clause == ' WHERE "created_at" >= :date_from AND "created_at" < :date_to_exclusive'
    assert binds == {'date_from': '2024-01-01', 'date_to_exclusive': '2024-02-01'}


def test_apply_mask_modes() -> None:
    rule_none = type('R', (), {'mode': 'NONE', 'value': None, 'column_name': 'A'})
    rule_null = type('R', (), {'mode': 'NULL', 'value': None, 'column_name': 'A'})
    rule_fixed = type('R', (), {'mode': 'FIXED', 'value': 'x', 'column_name': 'A'})
    rule_hash = type('R', (), {'mode': 'HASH', 'value': None, 'column_name': 'A'})
    rule_partial = type('R', (), {'mode': 'PARTIAL', 'value': None, 'column_name': 'A'})

    assert _apply_mask('value', rule_none) == 'value'
    assert _apply_mask('value', rule_null) is None
    assert _apply_mask('value', rule_fixed) == 'x'
    assert _apply_mask('abc', rule_hash) == hashlib.sha256('abc'.encode()).hexdigest()[:16]
    assert _apply_mask('secret', rule_partial) == 'se**et'


def test_mask_row_is_case_insensitive() -> None:
    row = ('alice', 'bob')
    cols = ['Name', 'EMAIL']
    masks = [type('R', (), {'mode': 'HASH', 'value': None, 'column_name': 'name'})]

    masked = _mask_row(row, cols, masks)
    assert masked[0] == hashlib.sha256('alice'.encode()).hexdigest()[:16]
    assert masked[1] == 'bob'


def test_preview_sql_variants() -> None:
    insert_cfg = TableMigrationConfig(
        source_schema='main',
        source_table='a',
        target_schema='main',
        target_table='b',
        selected_columns=['id', 'name'],
        strategy='INSERT',
    )
    merge_cfg = TableMigrationConfig(
        source_schema='main',
        source_table='a',
        target_schema='main',
        target_table='b',
        selected_columns=['id', 'name', 'age'],
        key_columns=['id'],
        strategy='MERGE',
    )
    delete_cfg = TableMigrationConfig(
        source_schema='main',
        source_table='a',
        target_schema='main',
        target_table='b',
        selected_columns=['id', 'name'],
        key_columns=['id'],
        strategy='DELETE_INSERT',
    )

    assert _preview_sql(insert_cfg)['source_select'] == 'SELECT "id", "name" FROM "main"."a"'
    assert _preview_sql(insert_cfg)['dml_preview'] == 'INSERT INTO "main"."b" ("id", "name") VALUES (...)'
    assert _preview_sql(merge_cfg)['dml_preview'] == 'UPSERT "main"."b" USING KEY ("id")'
    assert _preview_sql(delete_cfg)['dml_preview'] == 'DELETE FROM "main"."b" WHERE "id" = :id; INSERT INTO ...'


def test_start_job_and_dry_run_flow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / 'app.db'
    monkeypatch.setattr(repository, 'DB_PATH', db_file)
    repository.init_db()

    req = JobStartRequest(
        source_db={'url': _sqlite_url(tmp_path / 'source.db')},
        target_db={'url': _sqlite_url(tmp_path / 'target.db')},
        table_configs=[
            TableMigrationConfig(
                source_schema=None,
                source_table='users',
                target_schema=None,
                target_table='users',
                selected_columns=['id'],
                strategy='INSERT',
            )
        ],
        dry_run=True,
    )
    service = MigrationService()
    job_id = service.start_job(req)

    final_job = None
    for _ in range(50):
        candidate = repository.get_job(job_id)
        if candidate is not None and candidate['status'] == 'SUCCESS':
            final_job = candidate
            break
        time.sleep(0.05)

    assert final_job is not None
    service.wait_for_job(job_id, timeout=1.0)
    assert final_job['result_json']['tables'][0]['dry_run'] is True
    assert db_file.exists()


def test_actual_merge_flow_with_sqlite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    job_db = tmp_path / 'jobs.db'
    source_db = tmp_path / 'source.db'
    target_db = tmp_path / 'target.db'
    _init_source_target(source_db, target_db)

    monkeypatch.setattr(repository, 'DB_PATH', job_db)
    repository.init_db()

    req = JobStartRequest(
        source_db={'url': _sqlite_url(source_db)},
        target_db={'url': _sqlite_url(target_db)},
        table_configs=[
            TableMigrationConfig(
                source_table='users',
                target_table='users',
                selected_columns=['id', 'name', 'age', 'created_at'],
                key_columns=['id'],
                strategy='MERGE',
                batch_size=2,
            )
        ],
        dry_run=False,
    )

    service = MigrationService()
    job_id = service.start_job(req)

    final_job = None
    for _ in range(80):
        candidate = repository.get_job(job_id)
        if candidate is not None and candidate['status'] == 'SUCCESS':
            final_job = candidate
            break
        time.sleep(0.05)

    assert final_job is not None
    service.wait_for_job(job_id, timeout=1.0)
    assert final_job['result_json']['tables'][0]['migrated_rows'] == 3

    with sqlite3.connect(target_db) as conn:
        rows = conn.execute('SELECT id, name, age FROM users ORDER BY id').fetchall()

    assert rows == [
        (1, 'alice', 30),
        (2, 'bob', 41),
        (3, 'carol', 35),
    ]
