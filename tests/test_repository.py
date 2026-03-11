from __future__ import annotations

from pathlib import Path

import pytest

from app.services import repository


def test_create_and_get_job_roundtrip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(repository, "DB_PATH", tmp_path / "jobs.db")
    repository.init_db()

    job_id = "job-123"
    repository.create_job(job_id, dry_run=True, request_payload={"k": "v"})

    job = repository.get_job(job_id)
    assert job is not None
    assert job["job_id"] == job_id
    assert job["status"] == "PENDING"
    assert job["dry_run"] is True
    assert job["progress"] == 0
    assert job["request_json"] == {"k": "v"}
    assert job["result_json"] is None
    assert job["logs_json"] == []


def test_update_job_writes_logs_and_result(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(repository, "DB_PATH", tmp_path / "jobs.db")
    repository.init_db()

    job_id = "job-456"
    repository.create_job(job_id, dry_run=False, request_payload={})

    repository.update_job(job_id, status="RUNNING", progress=10, append_log="step 1")
    repository.update_job(job_id, append_log="step 2", result={"ok": True})

    job = repository.get_job(job_id)
    assert job is not None
    assert job["status"] == "RUNNING"
    assert job["progress"] == 10
    assert job["logs_json"] == ["step 1", "step 2"]
    assert job["result_json"] == {"ok": True}


def test_cancel_and_list_jobs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(repository, "DB_PATH", tmp_path / "jobs.db")
    repository.init_db()

    first = "job-1"
    second = "job-2"
    repository.create_job(first, dry_run=True, request_payload={})
    repository.create_job(second, dry_run=True, request_payload={})

    assert repository.request_cancel(first) is True
    assert repository.request_cancel("missing") is False

    assert repository.is_cancelled(first) is True
    assert repository.is_cancelled(second) is False

    jobs = repository.list_jobs(limit=10)
    assert set(j["job_id"] for j in jobs[:2]) == {first, second}
    repository.update_job(second, status="SUCCESS", progress=100, append_log="done")
    assert repository.request_cancel(second) is False

