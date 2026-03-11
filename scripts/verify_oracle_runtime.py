from __future__ import annotations

import json
import sys
from pathlib import Path

import oracledb
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.db import build_engine_url, create_db_engine

DEFAULT_URL = "oracle+oracledb://demo_user:demo_pass@dbhost.example.com:1521/?service_name=FREEPDB1"


def main() -> int:
    raw_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    normalized_url = build_engine_url(raw_url)
    parsed = make_url(normalized_url)
    engine = create_db_engine(normalized_url)
    try:
        payload = {
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
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
