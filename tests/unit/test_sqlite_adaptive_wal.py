from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

import integrity_checker.db.session as session_mod
from integrity_checker.config import get_settings
from integrity_checker.database.local_db import LocalDatabase
from integrity_checker.db.sqlite_tuning import (
    UNSAFE_WAL_FSTYPES,
    apply_sqlite_connection_pragmas,
    detect_sqlite_filesystem_type,
    resolve_sqlite_journal_mode,
)


def test_virtiofs_mount_forces_delete_mode_in_auto():
    fake_mounts = (
        "overlay / overlay rw,relatime 0 0\n"
        "grpcfuse /app/data fuse.grpcfuse rw,nosuid,nodev 0 0\n"
    )
    fstype = detect_sqlite_filesystem_type(Path("/app/data/app.db"), mounts_content=fake_mounts)
    assert fstype == "fuse.grpcfuse"
    assert (
        resolve_sqlite_journal_mode(
            Path("/app/data/app.db"), env_override="AUTO", mounts_content=fake_mounts
        )
        == "DELETE"
    )


def test_linux_ext4_mount_enables_wal_in_auto(tmp_path: Path):
    fake_mounts = "/dev/sda1 / ext4 rw,relatime 0 0\n"
    db_file = tmp_path / "wal_probe.db"
    mode = resolve_sqlite_journal_mode(db_file, env_override="AUTO", mounts_content=fake_mounts)
    assert mode == "WAL"
    with sqlite3.connect(str(db_file)) as conn:
        effective = apply_sqlite_connection_pragmas(conn, mode, mmap_bytes=67108864)
        assert effective.upper() == "WAL"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
        assert conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0] == 1000
        assert conn.execute("PRAGMA mmap_size").fetchone()[0] == 67108864


def test_explicit_env_override_always_wins(tmp_path: Path):
    fake_mounts = "/dev/sda1 / ext4 rw,relatime 0 0\n"
    assert (
        resolve_sqlite_journal_mode(
            tmp_path / "x.db", env_override="DELETE", mounts_content=fake_mounts
        )
        == "DELETE"
    )


def test_octal_escaped_mountpoint_and_longest_prefix_matching():
    fake_mounts = (
        "/dev/sda1 / ext4 rw,relatime 0 0\n"
        "nfs-srv:/export /app/data2 nfs4 rw 0 0\n"
        r"virtiofs /mnt/docker\040bind/data virtiofs rw 0 0" + "\n"
    )
    # /app/data2 must NOT prefix-match /app/data/app.db
    assert (
        detect_sqlite_filesystem_type(Path("/app/data/app.db"), mounts_content=fake_mounts)
        == "ext4"
    )
    # Octal \040 space escape must match "/mnt/docker bind/data/app.db"
    spaced_db = Path("/mnt/docker bind/data/app.db")
    assert detect_sqlite_filesystem_type(spaced_db, mounts_content=fake_mounts) == "virtiofs"
    assert (
        resolve_sqlite_journal_mode(spaced_db, env_override="AUTO", mounts_content=fake_mounts)
        == "DELETE"
    )

    for unsafe_fs in UNSAFE_WAL_FSTYPES:
        mounts = f"dev /data {unsafe_fs} rw 0 0\n"
        assert (
            resolve_sqlite_journal_mode(
                Path("/data/app.db"), env_override="AUTO", mounts_content=mounts
            )
            == "DELETE"
        )


def test_detect_filesystem_without_proc_mounts_returns_platform(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    import integrity_checker.db.sqlite_tuning as tuning_mod

    monkeypatch.setattr(tuning_mod, "PROC_MOUNTS_PATH", tmp_path / "no_such_proc_mounts")
    assert detect_sqlite_filesystem_type(tmp_path / "app.db") == sys.platform
    assert resolve_sqlite_journal_mode(tmp_path / "app.db", env_override="AUTO") == "WAL"


def test_explicit_modes_and_unknown_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    fake_mounts = "virtiofs / virtiofs rw 0 0\n"
    for valid in ("DELETE", "WAL", "TRUNCATE", "PERSIST", "MEMORY", "OFF"):
        assert (
            resolve_sqlite_journal_mode(
                Path("/app.db"), env_override=f"  {valid.lower()} ", mounts_content=fake_mounts
            )
            == valid
        )
    assert (
        resolve_sqlite_journal_mode(
            Path("/app.db"), env_override="INVALID_MODE", mounts_content="/dev/sda1 / ext4 rw 0 0\n"
        )
        == "DELETE"
    )
    monkeypatch.setenv("SQLITE_JOURNAL_MODE", "")
    assert (
        resolve_sqlite_journal_mode(
            tmp_path / "auto.db", mounts_content="/dev/sda1 / ext4 rw 0 0\n"
        )
        == "WAL"
    )


def test_apply_pragmas_falls_back_to_delete_on_operational_error(tmp_path: Path):
    class _WalRejectingConn:
        def __init__(self, inner: sqlite3.Connection) -> None:
            self._inner = inner

        def execute(self, sql: str, *args: Any, **kwargs: Any) -> sqlite3.Cursor:
            if sql.strip().upper() == "PRAGMA JOURNAL_MODE=WAL":
                raise sqlite3.OperationalError("disk I/O error: WAL shm unsupported")
            return self._inner.execute(sql, *args, **kwargs)

    db_file = tmp_path / "fallback.db"
    with sqlite3.connect(str(db_file)) as raw_conn:
        wrapped = _WalRejectingConn(raw_conn)
        effective = apply_sqlite_connection_pragmas(wrapped, "WAL", mmap_bytes=67108864)
        assert effective == "DELETE"
        assert raw_conn.execute("PRAGMA journal_mode").fetchone()[0].upper() == "DELETE"


def test_session_get_engine_uses_adaptive_wal_and_respects_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    prev_engine = session_mod._engine
    prev_url = session_mod._engine_url
    prev_session_local = session_mod._SessionLocal
    try:
        wal_db = tmp_path / "session_wal.db"
        monkeypatch.delenv("SQLITE_JOURNAL_MODE", raising=False)
        monkeypatch.setenv("DATABASE_URL", f"sqlite:///{wal_db}")
        get_settings.cache_clear()
        session_mod._engine = None
        session_mod._engine_url = None
        session_mod._SessionLocal = None

        engine = session_mod.get_engine()
        with engine.connect() as conn:
            mode = conn.execute(text("PRAGMA journal_mode")).scalar_one()
            busy = conn.execute(text("PRAGMA busy_timeout")).scalar_one()
            autockpt = conn.execute(text("PRAGMA wal_autocheckpoint")).scalar_one()
        assert str(mode).upper() == "WAL"
        assert int(busy) == 30000
        assert int(autockpt) == 1000
        engine.dispose()

        del_db = tmp_path / "session_delete.db"
        monkeypatch.setenv("SQLITE_JOURNAL_MODE", "DELETE")
        monkeypatch.setenv("DATABASE_URL", f"sqlite:///{del_db}")
        get_settings.cache_clear()
        session_mod._engine = None
        session_mod._engine_url = None
        session_mod._SessionLocal = None

        engine_del = session_mod.get_engine()
        with engine_del.connect() as conn:
            mode_del = conn.execute(text("PRAGMA journal_mode")).scalar_one()
        assert str(mode_del).upper() == "DELETE"
        engine_del.dispose()
    finally:
        if session_mod._engine is not None and session_mod._engine is not prev_engine:
            session_mod._engine.dispose()
        session_mod._engine = prev_engine
        session_mod._engine_url = prev_url
        session_mod._SessionLocal = prev_session_local
        get_settings.cache_clear()


def test_local_database_uses_adaptive_wal_and_mmap(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.delenv("SQLITE_JOURNAL_MODE", raising=False)
    wal_papers_db = tmp_path / "local_papers_wal.db"
    db_wal = LocalDatabase(wal_papers_db)
    with db_wal._get_conn() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].upper() == "WAL"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
        assert conn.execute("PRAGMA wal_autocheckpoint").fetchone()[0] == 1000
        assert conn.execute("PRAGMA mmap_size").fetchone()[0] == 67108864

    monkeypatch.setenv("SQLITE_JOURNAL_MODE", "DELETE")
    del_papers_db = tmp_path / "local_papers_delete.db"
    db_del = LocalDatabase(del_papers_db)
    with db_del._get_conn() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].upper() == "DELETE"
