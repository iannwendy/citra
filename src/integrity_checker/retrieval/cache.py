"""Deprecated compatibility cache.

The production retrieval path now uses ``data/local_papers.db`` and does not
instantiate this class.  It remains intentionally small so older integrations
and tests that inject a cache object continue to work while migrating.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any


class DiskCache:
    """TTL JSON cache compatible with the pre-v1.3 injection API."""

    def __init__(
        self,
        cache_dir: Path,
        ttl_seconds: int = 86400,
        enabled: bool = True,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.ttl_seconds = ttl_seconds
        self.enabled = enabled
        if enabled:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _key_to_path(self, key: str) -> Path:
        safe = "".join(char if char.isalnum() else "_" for char in key)[:120]
        return self.cache_dir / f"{safe}.json"

    def get(self, key: str) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        path = self._key_to_path(key)
        if not path.is_file() or time.time() - path.stat().st_mtime > self.ttl_seconds:
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def set(self, key: str, value: dict[str, Any]) -> None:
        if not self.enabled:
            return
        path = self._key_to_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_text(
                json.dumps(value, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
            temp_path.replace(path)
        finally:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
