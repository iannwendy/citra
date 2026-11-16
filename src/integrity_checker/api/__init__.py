"""FastAPI backend."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI

    from integrity_checker.api.main import create_app as create_app

    app: FastAPI

__all__ = ["app", "create_app"]


def __getattr__(name: str) -> Any:
    if name in ("app", "create_app"):
        from integrity_checker.api import main as _main

        return getattr(_main, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
