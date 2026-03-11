from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

DB_PATH = Path("data/app.db")
_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                dry_run INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                request_json TEXT NOT NULL,
                result_json TEXT,
                logs_json TEXT NOT NULL,
                cancel_requested INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        # Backward compatibility for existing databases without cancel flag.
        columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
        if "cancel_requested" not in columns:
            conn.execute("ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def create_job(job_id: str, dry_run: bool, request_payload: dict[str, Any]) -> None:
    payload = json.dumps(request_payload, ensure_ascii=False)
    with _LOCK, _connect() as conn:
        conn.execute(
            """
            INSERT INTO jobs(job_id, status, progress, dry_run, created_at, updated_at, request_json, logs_json, cancel_requested)
            VALUES(?, 'PENDING', 0, ?, datetime('now'), datetime('now'), ?, '[]', 0)
            """,
            (job_id, 1 if dry_run else 0, payload),
        )
        conn.commit()


def update_job(job_id: str, *, status: str | None = None, progress: int | None = None,
               result: dict[str, Any] | None = None, append_log: str | None = None) -> None:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT logs_json FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row is None:
            return
        logs = json.loads(row[0])
        if append_log:
            logs.append(append_log)
        result_json = json.dumps(result, ensure_ascii=False) if result is not None else None
        current = conn.execute(
            "SELECT status, progress, result_json FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        next_status = status or current[0]
        next_progress = progress if progress is not None else current[1]
        next_result = result_json if result is not None else current[2]
        conn.execute(
            """
            UPDATE jobs
               SET status = ?, progress = ?, result_json = ?, logs_json = ?, updated_at = datetime('now')
             WHERE job_id = ?
            """,
            (next_status, next_progress, next_result, json.dumps(logs, ensure_ascii=False), job_id),
        )
        conn.commit()


def request_cancel(job_id: str) -> bool:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT status FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return False

        status = row[0]
        if status in {"SUCCESS", "FAILED", "CANCELLED"}:
            return False

        next_status = "CANCEL_REQUESTED" if status in {"RUNNING", "PENDING"} else status
        conn.execute(
            """
            UPDATE jobs
               SET cancel_requested = 1,
                   status = ?,
                   updated_at = datetime('now')
             WHERE job_id = ?
            """,
            (next_status, job_id),
        )
        conn.commit()
        return True


def is_cancelled(job_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT cancel_requested, status FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return False
        cancel_requested, status = row
        return bool(cancel_requested) or status in {"CANCEL_REQUESTED", "CANCELLED"}


def get_job(job_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["dry_run"] = bool(d["dry_run"])
        d["cancel_requested"] = bool(d["cancel_requested"])
        d["request_json"] = json.loads(d["request_json"])
        d["result_json"] = json.loads(d["result_json"]) if d["result_json"] else None
        d["logs_json"] = json.loads(d["logs_json"])
        return d


def list_jobs(limit: int = 20) -> list[dict[str, Any]]:
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["dry_run"] = bool(d["dry_run"])
            d["cancel_requested"] = bool(d["cancel_requested"])
            d["request_json"] = json.loads(d["request_json"])
            d["result_json"] = json.loads(d["result_json"]) if d["result_json"] else None
            d["logs_json"] = json.loads(d["logs_json"])
            result.append(d)
        return result
