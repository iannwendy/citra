"""Tests for the hardened ACL Anthology BibTeX download (handoff § 5 P2)."""

from __future__ import annotations

import urllib.request
from pathlib import Path


def test_truncated_download_is_rejected(tmp_path, monkeypatch) -> None:
    """A partial download (no closing brace) must not be kept."""
    from scripts import import_acl_anthology as mod

    class _FakeResponse:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self._pos = 0

        def read(self, size: int = -1) -> bytes:
            if self._pos >= len(self._payload):
                return b""
            chunk = self._payload[self._pos : self._pos + size]
            self._pos += len(chunk)
            return chunk

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    # Payload mimics a cut-off anthology (last entry missing its braces).
    truncated = b'@inproceedings{a,title = "X",year = "2020"' + b"x" * 4096

    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *a, **k: _FakeResponse(truncated),
    )

    target = tmp_path / "anthology.bib"
    try:
        mod.download_acl_anthology(target)
    except OSError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected truncated download to raise IOError")
    assert not target.exists(), "partial file must be removed"


def test_complete_download_is_kept(tmp_path, monkeypatch) -> None:
    from scripts import import_acl_anthology as mod

    class _FakeResponse:
        def __init__(self, payload: bytes) -> None:
            self._payload = payload
            self._pos = 0

        def read(self, size: int = -1) -> bytes:
            if self._pos >= len(self._payload):
                return b""
            chunk = self._payload[self._pos : self._pos + size]
            self._pos += len(chunk)
            return chunk

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    complete = b'@inproceedings{a,title = "X",year = "2020"}\n'
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda *a, **k: _FakeResponse(complete)
    )
    target = tmp_path / "anthology.bib"
    mod.download_acl_anthology(target)
    assert target.read_bytes() == complete


def test_repository_anthology_is_not_truncated() -> None:
    """The checked-in anthology.bib (if present) must be a complete file."""
    path = Path("data/acl_anthology.bib")
    if not path.is_file():
        return
    tail = path.read_bytes()[-64:].decode("utf-8", errors="replace")
    assert tail.rstrip().endswith("}"), "anthology.bib looks truncated"
