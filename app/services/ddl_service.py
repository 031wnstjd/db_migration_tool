from __future__ import annotations

from typing import Any

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.db import create_db_engine, get_dialect_name


def _normalize_sql(sql: str | None) -> str:
    return (sql or "").strip()


def _combine_sections(sections: dict[str, Any]) -> str:
    ordered = [
        sections.get("table_sql", ""),
        sections.get("index_sql", ""),
        sections.get("constraint_sql", ""),
        sections.get("partition_sql", ""),
    ]
    return "\n\n".join(chunk for chunk in ordered if _normalize_sql(chunk))


def _mysql_qualified(schema: str | None, table_name: str) -> str:
    parts = [part for part in [(schema or "").strip(), table_name] if part]
    return ".".join(f"`{part.replace('`', '``')}`" for part in parts)


class DdlService:
    def extract_table_ddl(
        self,
        username: str | None,
        password: str | None,
        url: str,
        schema: str | None,
        table_name: str,
    ) -> dict[str, Any]:
        engine = create_db_engine(url, username=username, password=password)
        try:
            with engine.connect() as conn:
                dialect = engine.dialect.name
                sections = self._extract_by_dialect(conn, dialect, schema, table_name)
                sections["dialect"] = dialect
                sections["schema"] = (schema or "").strip() or None
                sections["table_name"] = table_name
                sections["combined_sql"] = _combine_sections(sections)
                return sections
        finally:
            engine.dispose()

    def _extract_by_dialect(self, conn: Connection, dialect: str, schema: str | None, table_name: str) -> dict[str, Any]:
        if dialect == "oracle":
            return self._extract_oracle(conn, schema, table_name)
        if dialect == "mysql":
            return self._extract_mysql(conn, schema, table_name)
        if dialect == "sqlite":
            return self._extract_sqlite(conn, table_name)
        if dialect == "postgresql":
            return self._extract_postgresql(conn, schema, table_name)
        return self._extract_generic(conn, schema, table_name)

    def _reflect_table(self, conn: Connection, schema: str | None, table_name: str) -> Table:
        metadata = MetaData()
        return Table(table_name, metadata, schema=(schema or "").strip() or None, autoload_with=conn)

    def _table_sql_from_reflection(self, conn: Connection, schema: str | None, table_name: str) -> tuple[Table, str]:
        table = self._reflect_table(conn, schema, table_name)
        sql = str(CreateTable(table).compile(dialect=conn.dialect))
        return table, _normalize_sql(sql)

    def _extract_generic(self, conn: Connection, schema: str | None, table_name: str) -> dict[str, Any]:
        warnings: list[str] = []
        table, table_sql = self._table_sql_from_reflection(conn, schema, table_name)
        index_sql = self._compile_indexes(table, conn.dialect)
        return {
            "table_sql": table_sql,
            "index_sql": index_sql,
            "constraint_sql": "",
            "partition_sql": "",
            "warnings": warnings,
        }

    def _extract_sqlite(self, conn: Connection, table_name: str) -> dict[str, Any]:
        warnings: list[str] = []
        row = conn.execute(
            text("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
            {"table_name": table_name},
        ).scalar_one_or_none()
        if row is None:
            raise ValueError(f"table not found: {table_name}")

        index_rows = conn.execute(
            text(
                """
                SELECT sql
                FROM sqlite_master
                WHERE type = 'index'
                  AND tbl_name = :table_name
                  AND sql IS NOT NULL
                ORDER BY name
                """
            ),
            {"table_name": table_name},
        ).scalars()
        index_sql = "\n\n".join(_normalize_sql(sql) for sql in index_rows if _normalize_sql(sql))
        return {
            "table_sql": _normalize_sql(row),
            "index_sql": index_sql,
            "constraint_sql": "",
            "partition_sql": "",
            "warnings": warnings + ["Partition metadata is not applicable for SQLite."],
        }

    def _extract_mysql(self, conn: Connection, schema: str | None, table_name: str) -> dict[str, Any]:
        warnings: list[str] = []
        qualified = _mysql_qualified(schema, table_name)
        try:
            create_row = conn.exec_driver_sql(f"SHOW CREATE TABLE {qualified}").first()
        except Exception as exc:
            raise ValueError(f"failed to load MySQL DDL for {qualified}: {exc}") from exc

        if create_row is None:
            raise ValueError(f"table not found: {qualified}")

        create_sql = _normalize_sql(create_row[1] if len(create_row) > 1 else "")
        table = self._reflect_table(conn, schema, table_name)
        index_sql = self._compile_indexes(table, conn.dialect)
        partition_sql = "\n".join(line for line in create_sql.splitlines() if "PARTITION" in line.upper())
        if not partition_sql:
            warnings.append("No MySQL partition clause detected for this table.")
        return {
            "table_sql": create_sql,
            "index_sql": index_sql,
            "constraint_sql": "",
            "partition_sql": _normalize_sql(partition_sql),
            "warnings": warnings,
        }

    def _extract_postgresql(self, conn: Connection, schema: str | None, table_name: str) -> dict[str, Any]:
        warnings: list[str] = []
        normalized_schema = (schema or "").strip() or "public"
        table, table_sql = self._table_sql_from_reflection(conn, normalized_schema, table_name)

        index_rows = conn.execute(
            text(
                """
                SELECT indexdef
                FROM pg_indexes
                WHERE schemaname = :schema_name
                  AND tablename = :table_name
                ORDER BY indexname
                """
            ),
            {"schema_name": normalized_schema, "table_name": table_name},
        ).scalars()
        index_sql = "\n\n".join(_normalize_sql(sql) for sql in index_rows if _normalize_sql(sql))

        constraint_rows = conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(c.oid, true)
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = :schema_name
                  AND t.relname = :table_name
                ORDER BY c.conname
                """
            ),
            {"schema_name": normalized_schema, "table_name": table_name},
        ).scalars()
        constraint_sql = "\n".join(_normalize_sql(sql) for sql in constraint_rows if _normalize_sql(sql))

        partition_key = conn.execute(
            text(
                """
                SELECT pg_get_partkeydef(c.oid)
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
                WHERE n.nspname = :schema_name
                  AND c.relname = :table_name
                """
            ),
            {"schema_name": normalized_schema, "table_name": table_name},
        ).scalar_one_or_none()
        partition_children = conn.execute(
            text(
                """
                SELECT child.relname AS partition_name,
                       pg_get_expr(child.relpartbound, child.oid) AS partition_bound
                FROM pg_inherits i
                JOIN pg_class parent ON parent.oid = i.inhparent
                JOIN pg_class child ON child.oid = i.inhrelid
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                WHERE n.nspname = :schema_name
                  AND parent.relname = :table_name
                ORDER BY child.relname
                """
            ),
            {"schema_name": normalized_schema, "table_name": table_name},
        ).mappings().all()

        partition_lines: list[str] = []
        if partition_key:
            partition_lines.append(f"PARTITION BY {partition_key}")
        for child in partition_children:
            bound = _normalize_sql(str(child.get("partition_bound") or ""))
            partition_lines.append(f"{child['partition_name']}: {bound}")

        partition_sql = "\n".join(line for line in partition_lines if line)
        if not partition_sql:
            warnings.append("No PostgreSQL partition definition detected for this table.")

        return {
            "table_sql": table_sql,
            "index_sql": index_sql or self._compile_indexes(table, conn.dialect),
            "constraint_sql": constraint_sql,
            "partition_sql": _normalize_sql(partition_sql),
            "warnings": warnings,
        }

    def _extract_oracle(self, conn: Connection, schema: str | None, table_name: str) -> dict[str, Any]:
        warnings: list[str] = []
        owner = ((schema or "").strip() or conn.execute(text("SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM dual")).scalar_one()).upper()
        table_name_upper = table_name.upper()

        def fetch_clob(query: str, params: dict[str, Any]) -> str:
            value = conn.execute(text(query), params).scalar_one_or_none()
            if value is None:
                return ""
            if hasattr(value, "read"):
                return _normalize_sql(value.read())
            return _normalize_sql(str(value))

        table_sql = fetch_clob(
            "SELECT DBMS_METADATA.GET_DDL('TABLE', :table_name, :owner) FROM dual",
            {"table_name": table_name_upper, "owner": owner},
        )
        if not table_sql:
            raise ValueError(f"table not found or Oracle metadata unavailable: {owner}.{table_name_upper}")

        try:
            index_sql = fetch_clob(
                "SELECT DBMS_METADATA.GET_DEPENDENT_DDL('INDEX', :table_name, :owner) FROM dual",
                {"table_name": table_name_upper, "owner": owner},
            )
        except Exception as exc:
            index_sql = ""
            warnings.append(f"Oracle index DDL unavailable: {exc}")

        constraint_chunks: list[str] = []
        for ddl_type in ("CONSTRAINT", "REF_CONSTRAINT"):
            try:
                chunk = fetch_clob(
                    f"SELECT DBMS_METADATA.GET_DEPENDENT_DDL('{ddl_type}', :table_name, :owner) FROM dual",
                    {"table_name": table_name_upper, "owner": owner},
                )
                if chunk:
                    constraint_chunks.append(chunk)
            except Exception as exc:
                warnings.append(f"Oracle {ddl_type} DDL unavailable: {exc}")

        partition_sql = table_sql if "PARTITION" in table_sql.upper() else ""
        if not partition_sql:
            warnings.append("No Oracle partition clause detected in table DDL.")

        return {
            "table_sql": table_sql,
            "index_sql": index_sql,
            "constraint_sql": "\n\n".join(chunk for chunk in constraint_chunks if chunk),
            "partition_sql": partition_sql,
            "warnings": warnings,
        }

    @staticmethod
    def _compile_indexes(table: Table, dialect: Any) -> str:
        statements = []
        for index in sorted(table.indexes, key=lambda idx: idx.name or ""):
            statements.append(_normalize_sql(str(CreateIndex(index).compile(dialect=dialect))))
        return "\n\n".join(statement for statement in statements if statement)


def ddl_support_summary(url: str) -> dict[str, str]:
    dialect = get_dialect_name(url)
    if dialect == "oracle":
        return {"dialect": "oracle", "driver_hint": "oracle+oracledb://", "notes": "Uses DBMS_METADATA when privileges allow."}
    if dialect == "mysql":
        return {"dialect": "mysql", "driver_hint": "mysql+pymysql://", "notes": "Uses SHOW CREATE TABLE plus reflected index metadata."}
    if dialect == "postgresql":
        return {"dialect": "postgresql", "driver_hint": "postgresql+psycopg://", "notes": "Uses reflected table DDL plus pg_catalog metadata."}
    return {"dialect": dialect, "driver_hint": f"{dialect}://", "notes": "Uses generic reflected DDL where possible."}
