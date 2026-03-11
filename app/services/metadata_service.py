from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import inspect, text

from app.core.db import create_db_engine


class MetadataService:
    def test_connection(self, username: str | None, password: str | None, url: str) -> dict[str, Any]:
        engine = create_db_engine(url, username=username, password=password)
        try:
            with engine.connect() as conn:
                conn.execute(text('SELECT 1'))
            return {
                'db_name': engine.url.database or engine.dialect.name,
                'dialect': engine.dialect.name,
                'server_time': datetime.now(timezone.utc).isoformat(),
            }
        finally:
            engine.dispose()

    def get_tables(self, username: str | None, password: str | None, url: str, schema: str | None = None) -> list[str]:
        engine = create_db_engine(url, username=username, password=password)
        try:
            inspector = inspect(engine)
            return sorted(inspector.get_table_names(schema=self._schema_arg(schema)))
        finally:
            engine.dispose()

    def get_columns(
        self,
        username: str | None,
        password: str | None,
        url: str,
        schema: str | None,
        table_name: str,
    ) -> list[dict[str, Any]]:
        engine = create_db_engine(url, username=username, password=password)
        try:
            inspector = inspect(engine)
            rows = inspector.get_columns(table_name, schema=self._schema_arg(schema))
            output: list[dict[str, Any]] = []
            for index, row in enumerate(rows, start=1):
                col_type = row.get('type')
                output.append(
                    {
                        'column_name': str(row.get('name', '')),
                        'data_type': str(col_type),
                        'nullable': 'Y' if row.get('nullable', True) else 'N',
                        'data_length': getattr(col_type, 'length', None),
                        'data_precision': getattr(col_type, 'precision', None),
                        'data_scale': getattr(col_type, 'scale', None),
                        'column_id': index,
                    }
                )
            return output
        finally:
            engine.dispose()

    def get_primary_keys(
        self,
        username: str | None,
        password: str | None,
        url: str,
        schema: str | None,
        table_name: str,
    ) -> list[str]:
        engine = create_db_engine(url, username=username, password=password)
        try:
            inspector = inspect(engine)
            pk = inspector.get_pk_constraint(table_name, schema=self._schema_arg(schema))
            return list(pk.get('constrained_columns') or [])
        finally:
            engine.dispose()

    def get_date_columns(
        self,
        username: str | None,
        password: str | None,
        url: str,
        schema: str | None,
        table_name: str,
    ) -> list[str]:
        columns = self.get_columns(username, password, url, schema, table_name)
        date_columns: list[str] = []
        for column in columns:
            data_type = (column.get('data_type') or '').upper()
            column_name = str(column.get('column_name') or '').lower()
            if any(token in data_type for token in ('DATE', 'TIME', 'TIMESTAMP')) or column_name.endswith('_at') or column_name.endswith('_date'):
                date_columns.append(column['column_name'])
        return date_columns

    @staticmethod
    def _schema_arg(schema: str | None) -> str | None:
        normalized = (schema or '').strip()
        return normalized or None
