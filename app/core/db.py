from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import URL, make_url


def _normalize_url(url: str) -> str:
    raw = (url or '').strip()
    if not raw:
        raise ValueError('database url is required')
    if '://' in raw:
        return raw
    if raw.endswith('.db') or raw.startswith('./') or raw.startswith('/'):
        return f'sqlite:///{raw}'
    raise ValueError(
        'database url must include a dialect prefix such as sqlite:///, postgresql+psycopg://, mysql+pymysql://, or oracle+oracledb://'
    )


def get_dialect_name(url: str) -> str:
    parsed = make_url(_normalize_url(url))
    return parsed.get_backend_name()


def build_engine_url(url: str, username: str | None = None, password: str | None = None) -> str:
    normalized = _normalize_url(url)
    parsed = make_url(normalized)
    if parsed.drivername.startswith('sqlite'):
        return parsed.render_as_string(hide_password=False)

    next_url: URL = parsed
    if username and not parsed.username:
        next_url = next_url.set(username=username)
    if password and not parsed.password:
        next_url = next_url.set(password=password)
    return next_url.render_as_string(hide_password=False)


def create_db_engine(url: str, username: str | None = None, password: str | None = None) -> Engine:
    engine_url = build_engine_url(url, username=username, password=password)
    kwargs: dict[str, object] = {'future': True}
    if engine_url.startswith('sqlite'):
        kwargs['connect_args'] = {'check_same_thread': False}
    return create_engine(engine_url, **kwargs)


def quote_identifier(name: str) -> str:
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def qualified_name(schema: str | None, table: str) -> str:
    schema_name = (schema or '').strip()
    if schema_name:
        return f'{quote_identifier(schema_name)}.{quote_identifier(table)}'
    return quote_identifier(table)
