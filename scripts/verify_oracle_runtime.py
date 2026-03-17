from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import oracledb
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.db import build_engine_url, create_db_engine

DEFAULT_URL = "oracle+oracledb://oracle_source:oracle_source_pass@127.0.0.1:1521/?service_name=XEPDB1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify the local Oracle python runtime and optionally run SELECT 1 FROM dual.")
    parser.add_argument("url", nargs="?", default=os.getenv("ORACLE_TEST_URL", DEFAULT_URL))
    parser.add_argument("--connect", action="store_true", help="Open a live connection and run SELECT 1 FROM dual.")
    return parser.parse_args()


def _connection_payload(engine: Any) -> dict[str, Any]:
    with engine.connect() as conn:
        probe = conn.execute(text("SELECT 1 FROM dual")).scalar_one()
        service_name = conn.execute(text("SELECT SYS_CONTEXT('USERENV', 'SERVICE_NAME') FROM dual")).scalar_one()
        session_user = conn.execute(text("SELECT USER FROM dual")).scalar_one()
    return {
        "connect_ok": True,
        "probe_result": int(probe),
        "service_name": str(service_name),
        "session_user": str(session_user),
    }


def main() -> int:
    args = parse_args()
    raw_url = args.url
    normalized_url = build_engine_url(raw_url)
    parsed = make_url(normalized_url)
    engine = create_db_engine(normalized_url)
    try:
        payload: dict[str, Any] = {
            "ok": True,
            "driver": "oracledb",
            "oracledb_version": getattr(oracledb, "__version__", "unknown"),
            "sqlalchemy_drivername": parsed.drivername,
            "database": parsed.database,
            "host": parsed.host,
            "port": parsed.port,
            "normalized_url": parsed.render_as_string(hide_password=True),
            "engine_drivername": engine.url.drivername,
            "thin_mode_default": True,
            "url_source": "argv" if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ("env" if os.getenv("ORACLE_TEST_URL") else "default"),
            "local_compose_hint": {
                "source_url": DEFAULT_URL,
                "target_url": "oracle+oracledb://oracle_target:oracle_target_pass@127.0.0.1:1521/?service_name=XEPDB1",
            },
        }
        if args.connect:
            payload["connection"] = _connection_payload(engine)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
