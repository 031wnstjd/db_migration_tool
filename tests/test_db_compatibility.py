from __future__ import annotations

import importlib.util

import pytest
from sqlalchemy import create_engine

from app.core.db import build_engine_url, get_dialect_name


def test_mysql_and_oracle_urls_are_recognized() -> None:
    assert get_dialect_name("mysql+pymysql://user:pass@localhost:3306/demo") == "mysql"
    assert get_dialect_name("oracle+oracledb://user:pass@localhost:1521/?service_name=XEPDB1") == "oracle"


def test_mysql_and_oracle_engines_can_be_constructed() -> None:
    mysql_url = build_engine_url("mysql+pymysql://user:pass@localhost:3306/demo")
    oracle_url = build_engine_url("oracle+oracledb://user:pass@localhost:1521/?service_name=XEPDB1")

    if importlib.util.find_spec("pymysql") is None:
        pytest.skip("pymysql is not installed in the active environment")

    mysql_engine = create_engine(mysql_url)
    oracle_engine = create_engine(oracle_url)

    assert mysql_engine.dialect.name == "mysql"
    assert mysql_engine.dialect.driver == "pymysql"
    assert oracle_engine.dialect.name == "oracle"
    assert oracle_engine.dialect.driver == "oracledb"
