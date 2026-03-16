from __future__ import annotations

import hashlib
import logging
import threading
import time
import uuid
from datetime import date, timedelta
from typing import Any

from sqlalchemy import Column, MetaData, String, Table, and_, bindparam, delete, insert, select, update
from sqlalchemy.dialects import mysql, oracle, postgresql, sqlite
from sqlalchemy.exc import NoSuchTableError

from app.api.models import ColumnMaskRule, JobStartRequest, TableMigrationConfig
from app.core.db import create_db_engine, get_dialect_name, qualified_name, quote_identifier
from app.services import repository

logger = logging.getLogger(__name__)


def _quote(name: str) -> str:
    return quote_identifier(name)


def _fq(schema: str | None, table: str) -> str:
    return qualified_name(schema, table)


def _build_where(cfg: TableMigrationConfig, binds: dict[str, Any]) -> str:
    clauses: list[str] = []
    if cfg.date_filter_column and cfg.date_from:
        clauses.append(f'{_quote(cfg.date_filter_column)} >= :date_from')
        binds['date_from'] = cfg.date_from
    if cfg.date_filter_column and cfg.date_to:
        exclusive_to = date.fromisoformat(cfg.date_to) + timedelta(days=1)
        clauses.append(f'{_quote(cfg.date_filter_column)} < :date_to_exclusive')
        binds['date_to_exclusive'] = exclusive_to.isoformat()
    return (' WHERE ' + ' AND '.join(clauses)) if clauses else ''


def _apply_mask(val: Any, rule: ColumnMaskRule) -> Any:
    if rule.mode == 'NONE':
        return val
    if rule.mode == 'NULL':
        return None
    if rule.mode == 'FIXED':
        return rule.value
    if rule.mode == 'HASH':
        if val is None:
            return None
        return hashlib.sha256(str(val).encode()).hexdigest()[:16]
    if rule.mode == 'PARTIAL':
        if val is None:
            return None
        s = str(val)
        if len(s) <= 4:
            return '*' * len(s)
        return s[:2] + '*' * (len(s) - 4) + s[-2:]
    return val


def _mask_row(row: tuple[Any, ...], columns: list[str], masks: list[ColumnMaskRule]) -> tuple[Any, ...]:
    by_name = {m.column_name.upper(): m for m in masks}
    out = []
    for idx, col in enumerate(columns):
        rule = by_name.get(col.upper())
        out.append(_apply_mask(row[idx], rule) if rule else row[idx])
    return tuple(out)


def _preview_dialect(url: str | None):
    dialect_name = get_dialect_name(url or 'sqlite://') if url else 'sqlite'
    if dialect_name == 'oracle':
        return oracle.dialect()
    if dialect_name == 'mysql':
        return mysql.dialect()
    if dialect_name == 'postgresql':
        return postgresql.dialect()
    return sqlite.dialect()


def _preview_table(schema: str | None, table_name: str, columns: list[str]) -> Table:
    metadata = MetaData()
    unique_columns = list(dict.fromkeys(columns))
    return Table(table_name, metadata, *[Column(column_name, String()) for column_name in unique_columns], schema=(schema or '').strip() or None)


def _preview_sql(cfg: TableMigrationConfig, source_url: str | None = None, target_url: str | None = None) -> dict[str, str]:
    selected = cfg.selected_columns
    source_columns = selected + ([cfg.date_filter_column] if cfg.date_filter_column else [])
    target_columns = list(dict.fromkeys(selected + cfg.key_columns))
    source_table = _preview_table(cfg.source_schema, cfg.source_table, source_columns)
    target_table = _preview_table(cfg.target_schema, cfg.target_table, target_columns)

    source_stmt = select(*[source_table.c[column_name] for column_name in selected])
    if cfg.date_filter_column and cfg.date_from:
        source_stmt = source_stmt.where(source_table.c[cfg.date_filter_column] >= bindparam('date_from'))
    if cfg.date_filter_column and cfg.date_to:
        source_stmt = source_stmt.where(source_table.c[cfg.date_filter_column] < bindparam('date_to_exclusive'))
    if cfg.row_limit:
        source_stmt = source_stmt.limit(cfg.row_limit)

    source_select = str(source_stmt.compile(dialect=_preview_dialect(source_url)))
    insert_stmt = insert(target_table).values({column_name: bindparam(column_name) for column_name in selected})

    if cfg.strategy == 'INSERT':
        dml = str(insert_stmt.compile(dialect=_preview_dialect(target_url)))
    elif cfg.strategy == 'DELETE_INSERT':
        delete_stmt = delete(target_table).where(and_(*[target_table.c[key] == bindparam(key) for key in cfg.key_columns]))
        dml = '\n'.join(
            [
                str(delete_stmt.compile(dialect=_preview_dialect(target_url))),
                str(insert_stmt.compile(dialect=_preview_dialect(target_url))),
            ]
        )
    else:
        update_values = {column_name: bindparam(column_name) for column_name in selected if column_name not in cfg.key_columns}
        update_stmt = update(target_table).where(and_(*[target_table.c[key] == bindparam(key) for key in cfg.key_columns])).values(
            **update_values
        )
        dml = '\n'.join(
            [
                str(update_stmt.compile(dialect=_preview_dialect(target_url))),
                '-- if update affected 0 rows, run INSERT fallback',
                str(insert_stmt.compile(dialect=_preview_dialect(target_url))),
            ]
        )

    return {'source_select': source_select.strip(), 'dml_preview': dml.strip()}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _resolve_table(conn: Any, schema: str | None, table_name: str) -> Table:
    metadata = MetaData()
    try:
        return Table(table_name, metadata, schema=(schema or '').strip() or None, autoload_with=conn)
    except NoSuchTableError as exc:
        raise ValueError(f'table not found: {_fq(schema, table_name)}') from exc


def _resolve_columns(table: Table, requested: list[str]) -> list[tuple[str, Any]]:
    resolved: list[tuple[str, Any]] = []
    for name in requested:
        column = next((col for col in table.columns if col.name.upper() == name.upper()), None)
        if column is None:
            raise ValueError(f'column not found: {table.fullname}.{name}')
        resolved.append((name, column))
    return resolved


def _mask_mapping(row: dict[str, Any], columns: list[str], masks: list[ColumnMaskRule]) -> dict[str, Any]:
    by_name = {m.column_name.upper(): m for m in masks}
    return {
        column: _apply_mask(row[column], by_name[column.upper()]) if column.upper() in by_name else row[column]
        for column in columns
    }


class MigrationService:
    def __init__(self) -> None:
        self._threads: dict[str, threading.Thread] = {}

    def start_job(self, request: JobStartRequest) -> str:
        job_id = str(uuid.uuid4())
        job_db_path = repository.DB_PATH
        repository.create_job(job_id, request.dry_run, request.model_dump(by_alias=True))
        thread = threading.Thread(target=self._run_job, args=(job_id, request, job_db_path), daemon=True)
        self._threads[job_id] = thread
        thread.start()
        return job_id

    def wait_for_job(self, job_id: str, timeout: float | None = None) -> None:
        thread = self._threads.get(job_id)
        if thread is not None:
            thread.join(timeout=timeout)

    def _run_job(self, job_id: str, request: JobStartRequest, job_db_path: Any) -> None:
        with repository.use_db_path(job_db_path):
            repository.update_job(job_id, status='RUNNING', progress=1, append_log='Job started')
            try:
                total_tables = max(1, len(request.table_configs))
                summaries = []
                for index, cfg in enumerate(request.table_configs, start=1):
                    if repository.is_cancelled(job_id):
                        repository.update_job(job_id, status='CANCELLED', append_log='Job cancelled before processing table')
                        return

                    repository.update_job(
                        job_id,
                        append_log=f'Processing {_fq(cfg.source_schema, cfg.source_table)} -> {_fq(cfg.target_schema, cfg.target_table)}',
                    )
                    summary = self._run_single_table(job_id, request, cfg)
                    summaries.append(summary)
                    if summary.get('cancelled'):
                        repository.update_job(
                            job_id,
                            status='CANCELLED',
                            result={'tables': summaries},
                            append_log=f'Job cancelled during table {index}/{total_tables}',
                        )
                        return
                    progress = int(index / total_tables * 100)
                    repository.update_job(job_id, progress=progress, append_log=f'Completed table {index}/{total_tables}')
                repository.update_job(job_id, status='SUCCESS', progress=100, result={'tables': summaries}, append_log='Job finished successfully')
            except Exception as exc:
                logger.exception('Job failed: %s', job_id)
                repository.update_job(job_id, status='FAILED', append_log=f'Failed: {exc}', result={'error': str(exc)})
            finally:
                self._threads.pop(job_id, None)

    def _run_single_table(self, job_id: str, request: JobStartRequest, cfg: TableMigrationConfig) -> dict[str, Any]:
        preview = _preview_sql(cfg, request.source_db.url, request.target_db.url)
        source_label = _fq(cfg.source_schema, cfg.source_table)
        target_label = _fq(cfg.target_schema, cfg.target_table)

        if repository.is_cancelled(job_id):
            return {
                'table': source_label,
                'target': target_label,
                'strategy': cfg.strategy,
                'dry_run': False,
                'preview': preview,
                'migrated_rows': 0,
                'cancelled': True,
            }

        if request.dry_run:
            time.sleep(0.05)
            return {
                'table': source_label,
                'target': target_label,
                'strategy': cfg.strategy,
                'dry_run': True,
                'preview': preview,
                'migrated_rows': 0,
                'cancelled': False,
            }

        if not cfg.selected_columns:
            raise ValueError('selected_columns is empty')
        if cfg.strategy in {'MERGE', 'DELETE_INSERT'} and not cfg.key_columns:
            raise ValueError(f'{cfg.strategy} requires key_columns')

        source_engine = create_db_engine(request.source_db.url, username=request.source_db.username, password=request.source_db.password)
        target_engine = create_db_engine(request.target_db.url, username=request.target_db.username, password=request.target_db.password)
        total_rows = 0
        try:
            with source_engine.connect() as src_conn, target_engine.connect() as tgt_conn:
                source_table = _resolve_table(src_conn, cfg.source_schema, cfg.source_table)
                target_table = _resolve_table(tgt_conn, cfg.target_schema, cfg.target_table)

                source_columns = _resolve_columns(source_table, cfg.selected_columns)
                target_columns = _resolve_columns(target_table, cfg.selected_columns)
                target_name_map = {requested: column.name for requested, column in target_columns}
                target_key_columns = [target_name_map[key] for key in cfg.key_columns]

                date_column = None
                if cfg.date_filter_column:
                    date_column = _resolve_columns(source_table, [cfg.date_filter_column])[0][1]

                if cfg.truncate_before_load:
                    repository.update_job(job_id, append_log=f'CLEAR {target_label}')
                    tgt_conn.execute(delete(target_table))
                    tgt_conn.commit()

                select_columns = [column.label(requested) for requested, column in source_columns]
                stmt = select(*select_columns)
                if date_column is not None and cfg.date_from:
                    stmt = stmt.where(date_column >= _parse_date(cfg.date_from))
                if date_column is not None and cfg.date_to:
                    stmt = stmt.where(date_column < (_parse_date(cfg.date_to) + timedelta(days=1)))
                if cfg.row_limit:
                    stmt = stmt.limit(cfg.row_limit)

                repository.update_job(job_id, append_log=f'Fetch SQL: {preview["source_select"]}')
                result = src_conn.execution_options(stream_results=True).execute(stmt).mappings()

                while True:
                    if repository.is_cancelled(job_id):
                        repository.update_job(job_id, append_log='Cancellation requested; stopping table migration')
                        return {
                            'table': source_label,
                            'target': target_label,
                            'strategy': cfg.strategy,
                            'dry_run': False,
                            'preview': preview,
                            'migrated_rows': total_rows,
                            'cancelled': True,
                        }

                    rows = result.fetchmany(cfg.batch_size)
                    if not rows:
                        break

                    masked_rows = [_mask_mapping(dict(row), cfg.selected_columns, cfg.masks) for row in rows]
                    target_rows = [
                        {target_name_map[column]: row[column] for column in cfg.selected_columns}
                        for row in masked_rows
                    ]
                    self._apply_batch(tgt_conn, target_table, cfg.strategy, target_rows, target_key_columns)
                    total_rows += len(target_rows)
                    tgt_conn.commit()
                    repository.update_job(job_id, append_log=f'Committed batch, rows={total_rows}')

                    if repository.is_cancelled(job_id):
                        repository.update_job(job_id, append_log='Cancellation requested; stopping after batch')
                        return {
                            'table': source_label,
                            'target': target_label,
                            'strategy': cfg.strategy,
                            'dry_run': False,
                            'preview': preview,
                            'migrated_rows': total_rows,
                            'cancelled': True,
                        }
        finally:
            source_engine.dispose()
            target_engine.dispose()

        return {
            'table': source_label,
            'target': target_label,
            'strategy': cfg.strategy,
            'dry_run': False,
            'preview': preview,
            'migrated_rows': total_rows,
            'cancelled': False,
        }

    def _apply_batch(
        self,
        tgt_conn: Any,
        target_table: Table,
        strategy: str,
        rows: list[dict[str, Any]],
        key_columns: list[str],
    ) -> None:
        if not rows:
            return

        if strategy == 'INSERT':
            tgt_conn.execute(insert(target_table), rows)
            return

        if strategy == 'DELETE_INSERT':
            for row in rows:
                criteria = and_(*[target_table.c[key] == row[key] for key in key_columns])
                tgt_conn.execute(delete(target_table).where(criteria))
            tgt_conn.execute(insert(target_table), rows)
            return

        update_columns = [column.name for column in target_table.columns if column.name in rows[0] and column.name not in key_columns]
        if not update_columns:
            raise ValueError('MERGE requires at least one non-key column')

        for row in rows:
            criteria = and_(*[target_table.c[key] == row[key] for key in key_columns])
            update_values = {column: row[column] for column in update_columns}
            result = tgt_conn.execute(update(target_table).where(criteria).values(**update_values))
            if result.rowcount == 0:
                tgt_conn.execute(insert(target_table).values(**row))
