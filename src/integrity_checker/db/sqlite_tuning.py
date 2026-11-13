"""Adaptive SQLite journal mode & connection PRAGMA tuning.

Automatically enables WAL mode on native filesystems (ext4, xfs, apfs/darwin,
btrfs, tmpfs, overlay, etc.) while safely degrading to DELETE mode on Docker
host bind-mount / network filesystems (VirtioFS, 9p, osxfs, grpcfuse, NFS,
CIFS/SMB, SSHFS) where POSIX shared-memory locks (``-shm``) can corrupt WAL.
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

PROC_MOUNTS_PATH = Path("/proc/mounts")

UNSAFE_WAL_FSTYPES: frozenset[str] = frozenset(
    {
        "virtiofs",
        "9p",
        "fuse.osxfs",
        "fuse.grpcfuse",
        "nfs",
        "nfs4",
        "cifs",
        "smb3",
        "fuse.sshfs",
    }
)

VALID_JOURNAL_MODES: frozenset[str] = frozenset(
    {"DELETE", "WAL", "TRUNCATE", "PERSIST", "MEMORY", "OFF"}
)

_OCTAL_ESCAPE_RE = re.compile(r"\\([0-7]{3})")


def _unescape_mount_path(raw_mount: str) -> str:
    """Decode octal escapes (e.g. ``\\040`` -> space) in ``/proc/mounts`` paths."""
    return _OCTAL_ESCAPE_RE.sub(lambda match: chr(int(match.group(1), 8)), raw_mount)


def _path_matches_mountpoint(target_path: str, mountpoint: str) -> bool:
    """Return True if ``target_path`` resides at or beneath ``mountpoint``."""
    if mountpoint == "/":
        return target_path.startswith("/")
    return target_path == mountpoint or target_path.startswith(f"{mountpoint}/")


def detect_sqlite_filesystem_type(db_path: Path, mounts_content: str | None = None) -> str:
    """Detect filesystem type backing ``db_path`` from ``/proc/mounts`` or OS platform."""
    path_obj = Path(db_path)
    if mounts_content is None:
        if not PROC_MOUNTS_PATH.exists():
            return sys.platform
        try:
            mounts_text = PROC_MOUNTS_PATH.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return sys.platform
        target_path = str(path_obj.resolve(strict=False))
    else:
        mounts_text = mounts_content
        target_path = str(path_obj)

    best_fstype: str | None = None
    best_prefix_len = -1

    for raw_line in mounts_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 3:
            continue
        mountpoint = _unescape_mount_path(parts[1]).rstrip("/") or "/"
        fstype = parts[2]
        if _path_matches_mountpoint(target_path, mountpoint) and len(mountpoint) >= best_prefix_len:
            best_prefix_len = len(mountpoint)
            best_fstype = fstype

    return best_fstype if best_fstype is not None else sys.platform


def resolve_sqlite_journal_mode(
    db_path: Path,
    env_override: str | None = None,
    mounts_content: str | None = None,
) -> str:
    """Resolve effective SQLite journal mode from explicit override or adaptive AUTO."""
    raw_mode = (
        env_override if env_override is not None else os.getenv("SQLITE_JOURNAL_MODE", "AUTO")
    )
    mode = raw_mode.strip().upper() or "AUTO"

    if mode != "AUTO":
        return mode if mode in VALID_JOURNAL_MODES else "DELETE"

    fstype = detect_sqlite_filesystem_type(Path(db_path), mounts_content=mounts_content).lower()
    if fstype in UNSAFE_WAL_FSTYPES:
        return "DELETE"
    return "WAL"


def _exec_pragma(conn: Any, sql: str) -> Any:
    """Execute a PRAGMA on a sqlite3 connection or PEP-249 DBAPI wrapper and return first row."""
    if hasattr(conn, "execute"):
        cur = conn.execute(sql)
        return cur.fetchone() if cur is not None and hasattr(cur, "fetchone") else None
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        return cursor.fetchone()
    finally:
        cursor.close()


def apply_sqlite_connection_pragmas(
    conn: Any,
    journal_mode: str,
    *,
    mmap_bytes: int = 0,
) -> str:
    """Apply SQLite concurrency/performance PRAGMAs with safe DELETE fallback on OperationalError."""
    requested_mode = journal_mode.strip().upper()
    if requested_mode not in VALID_JOURNAL_MODES:
        requested_mode = "DELETE"

    _exec_pragma(conn, "PRAGMA busy_timeout=30000")
    _exec_pragma(conn, "PRAGMA synchronous=NORMAL")

    try:
        row = _exec_pragma(conn, f"PRAGMA journal_mode={requested_mode}")
        effective_mode = str(row[0]).strip().upper() if row and row[0] else requested_mode
    except sqlite3.OperationalError:
        try:
            row = _exec_pragma(conn, "PRAGMA journal_mode=DELETE")
            effective_mode = str(row[0]).strip().upper() if row and row[0] else "DELETE"
        except sqlite3.OperationalError:
            effective_mode = "DELETE"

    if effective_mode == "WAL":
        _exec_pragma(conn, "PRAGMA wal_autocheckpoint=1000")
        if mmap_bytes > 0:
            _exec_pragma(conn, f"PRAGMA mmap_size={int(mmap_bytes)}")

    return effective_mode
